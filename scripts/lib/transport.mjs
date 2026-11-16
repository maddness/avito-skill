import path from 'node:path';import {AvitoError} from './errors.mjs';import {withLock,readJson,writeJson,sleep} from './storage.mjs';
export class Pacer{
 constructor({random=Math.random,sleep:pause=sleep}={}){this.random=random;this.sleep=pause;this.started=false;}
 async between(force=false){const before=this.started;this.started=true;if(!before&&!force)return 0;const ms=Math.max(300,Math.min(600,300+Math.floor(this.random()*301)));await this.sleep(ms);return ms;}
}
export function parseLossless(text){let out='',i=0;while(i<text.length){const c=text[i];if(c==='"'){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}out+=text.slice(start,i);continue;}if(c==='-'||/[0-9]/.test(c)){const m=text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(m){const n=m[0];out+=!/[.eE]/.test(n)&&!Number.isSafeInteger(Number(n))?JSON.stringify(n):n;i+=n.length;continue;}}out+=c;i++;}return JSON.parse(out);}
export function encodeRpc(method,params,id){return JSON.stringify({jsonrpc:'2.0',id,method,params}).replace(/("(?:before|after|offsetTimestamp)":)"(\d+)"/g,'$1$2');}
export function cookieHeader(cookies,url,now=Date.now()/1000){const u=new URL(url);return cookies.filter(c=>{const raw=c.domain||'',d=raw.replace(/^\./,''),host=raw.startsWith('.')?(u.hostname===d||u.hostname.endsWith('.'+d)):u.hostname===d,p=c.path||'/';return host&&(u.pathname===p||u.pathname.startsWith(p.endsWith('/')?p:p+'/'))&&(!c.secure||u.protocol==='https:')&&(!(c.expires>0)||c.expires>now);}).sort((a,b)=>(b.path?.length||1)-(a.path?.length||1)).map(c=>c.name+'='+c.value).join('; ');}
const allowed=[
 ['GET',/^\/web\/1\/js\/items$/],['GET',/^\/web\/1\/slocations$/],['GET',/^\/web\/3\/location\/suggest\/by_query$/],['GET',/^\/web\/1\/coords\/by_address$/],
 ['GET',/^\/[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_~-]+_\d+$/],
 ['POST',/^\/web\/1\/serp\/profile\/items$/],['GET',/^\/web\/1\/profiles\/list$/],['POST',/^\/web\/1\/socket\/fallback$/],
 ['POST',/^\/item-add\/(load|submit)\/v2$/],['POST',/^\/item-edit\/(load|submit)\/v2$/],['POST',/^\/web\/4\/fees\/\d+\/methods$/],['GET',/^\/web\/1\/items\/close-reasons$/],['POST',/^\/web\/1\/profile\/items\/close$/],['POST',/^\/web\/1\/item-edit\/navigation$/],['POST',/^\/web\/2\/item-edit\/layout(?:\/filter)?$/],
 ['POST',/^\/web\/1\/publish\/categories\/suggest\/byTitle$/],['POST',/^\/web\/1\/images\/upload$/],['POST',/^\/js\/v2\/geo\/position$/],
 ['POST',/^\/web\/2\/item\/defaultContactMethod$/],['POST',/^\/web\/2\/item\/draft\/(save|delete)$/],['POST',/^\/web\/4\/fees\/methods$/],
 ['POST',/^\/web\/1\/delivery\/conditions\/\d+\/(seller|buyer)$/],['POST',/^\/web\/1\/delivery\/item\/toggles\/\d+$/]
];
export class Transport{
 constructor(session,{stateDir=null,pacer=new Pacer(),fetchImpl=fetch}={}){this.session=session;this.stateDir=stateDir;this.pacer=pacer;this.fetch=fetchImpl;this.queue=Promise.resolve();this.trace=[];}
 request(url,options={}){const run=()=>this.#request(url,options);const result=this.queue.then(run,run);this.queue=result.catch(()=>{});return result;}
 async #request(url,{method='GET',json,form,raw,contentType,check=true,expect='json'}={}){
  const u=new URL(url,'https://www.avito.ru');
  if(u.origin!=='https://www.avito.ru'||!allowed.some(([m,r])=>m===method&&r.test(u.pathname)))throw new AvitoError('ENDPOINT_NOT_ALLOWED');
  const execute=async()=>{
   let last=null;if(this.stateDir)last=await readJson(path.join(this.stateDir,'network.json'),{optional:true,privateFile:true});
   if(last?.cooldown_until>Date.now())throw new AvitoError('RATE_LIMITED',{retry_after_seconds:Math.ceil((last.cooldown_until-Date.now())/1000)});
   const delay=await this.pacer.between(!!last);const headers={cookie:cookieHeader(this.session.cookies,u.href)};let body;
   if(json!==undefined){headers['content-type']='application/json';body=JSON.stringify(json);}if(form!==undefined){body=form;if(form instanceof URLSearchParams)headers['content-type']='application/x-www-form-urlencoded';}
   if(raw!==undefined){body=raw;headers['content-type']=contentType||'application/json';}
   const entry={path:u.pathname,method,delay_ms:delay,started_at:Date.now()};let cooldown=0;
   try{
    const r=await this.fetch(u.href,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(20000)});entry.status=r.status;
    if(r.status>=300&&r.status<400)throw new AvitoError('REDIRECT_BLOCKED');if(r.status===401)throw new AvitoError('AUTH_REQUIRED');if(r.status===403)throw new AvitoError('ACCESS_OR_CHALLENGE');
    if(r.status===429){const h=r.headers.get('retry-after');const seconds=/^\d+$/.test(h||'')?Number(h):h?Math.max(1,Math.ceil((Date.parse(h)-Date.now())/1000)):60;cooldown=Date.now()+seconds*1000;throw new AvitoError('RATE_LIMITED',{retry_after_seconds:seconds});}
    const text=await r.text();if(expect==='text'){if(!r.ok)throw new AvitoError('HTTP_ERROR',{status:r.status});return text;}
    let data;try{data=parseLossless(text);}catch{throw new AvitoError('NON_JSON_RESPONSE',{status:r.status});}
    if(!r.ok)throw new AvitoError('HTTP_ERROR',{status:r.status});
    if(check&&data.error)throw new AvitoError('RPC_ERROR',{rpc_code:data.error.code});
    if(check&&typeof data.status==='string'&&!['ok','success'].includes(data.status))throw new AvitoError('API_'+data.status.toUpperCase().replace(/-/g,'_'),{fields:Object.keys(data.result?.messages||{})});
    return data;
   }catch(e){entry.error=e instanceof AvitoError?e.code:'NETWORK_ERROR';if(e instanceof AvitoError)throw e;throw new AvitoError('NETWORK_ERROR',{outcome_unknown:method!=='GET'});}
   finally{entry.completed_at=Date.now();this.trace.push(entry);if(this.stateDir)await writeJson(path.join(this.stateDir,'network.json'),{completed_at:entry.completed_at,...cooldown?{cooldown_until:cooldown}:{}});}
  };
  return this.stateDir?withLock(path.join(this.stateDir,'locks','network.lock'),execute):execute();
 }
}
