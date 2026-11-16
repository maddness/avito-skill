import path from 'node:path';
import {AvitoError} from './errors.mjs';
import {readJson,writeJson,withLock,sleep} from './storage.mjs';
import {loadSession,saveVerifiedSession,sessionFile} from './session.mjs';
import {Client} from './client.mjs';
import {AuthBrowser} from './auth-browser.mjs';
import {observeAuthDOM,authAction,installLinkCapture,validateVerificationURL} from './auth-observer.mjs';
import {createAuthUI,publicOrigin} from './auth-ui.mjs';
import {Pacer} from './transport.mjs';
const copy={
 starting:['Открываем браузер','Подожди несколько секунд.'],
 signout:['Готово к повторному входу','Выйди из аккаунта в окне Авито. После этого помощник откроет форму входа.'],
 credentials:['Войди в Авито','Введи логин и пароль прямо в окне Авито.'],
 sms:['Введи SMS-код','Код вводится в поле Авито. Отправлять его в чат не нужно.'],
 captcha:['Пройди капчу','Нажми нужные части изображения и подтверди результат в окне Авито.'],
 video:['Авито запросило видеопроверку','Ищем предложенную Авито ссылку для проверки на телефоне. Можно продолжить шаги в окне Авито.'],
 video_consent:['Подтверди условия проверки','Прочитай и подтверди согласия в окне Авито. После этого продолжим.'],
 video_link:['Ссылка для телефона готова','Открой проверку на телефоне с камерой. Исходное окно Авито оставь открытым.'],
 waiting_video:['Ожидаем завершения проверки','Пройди проверку на телефоне. Если Авито попросит, нажми «Продолжить» в исходном окне.'],
 profile:['Выбери профиль','Уточни, с каким профилем должен работать скилл.'],
 profile_switch:['Переключи профиль в Авито','Открой нужный профиль в самом Авито. Помощник проверит его перед сохранением.'],
 verifying:['Проверяем подключение','Проверяем доступ отдельным HTTP-запросом.'],
 page:['Продолжи вход в окне Авито','Помощник ждёт завершения входа. При необходимости нажми «Я завершил шаг — проверить».'],
 challenge:['Авито пока не подтвердило доступ','Продолжи штатную проверку в браузере. Сессия ещё не заменена.'],
 ready:['Авито подключено','Сессия проверена и сохранена. Теперь можно пользоваться скиллом.'],
 cancelled:['Подключение приостановлено','Браузер и прежняя сохранённая сессия оставлены на месте.'],
 timeout:['Время ожидания закончилось','Браузер и прежняя сессия сохранены. Повтори auth login, чтобы продолжить.']
};
export function safeAuthStatus(state){return {schema_version:1,stage:state.stage,verification_link_available:!!state.verification_url,profile_id:state.profile_id??null,updated_at:new Date().toISOString()};}
export async function authLogin(stateDir,opts={},deps={}){
 const emit=deps.emit??(()=>{}),pause=deps.sleep??sleep,now=deps.now??Date.now;
 const force=opts['force-login']==='true',timeout=Number(opts['timeout-seconds']??900),port=Number(opts.port??0);
 if(!Number.isInteger(timeout)||timeout<10||timeout>3600||!Number.isInteger(port)||port<0||port>65535)throw new AvitoError('AUTH_ARGUMENT_INVALID');
 if(opts['force-login']&&!['true','false'].includes(opts['force-login'])||opts['no-sandbox']&&!['true','false'].includes(opts['no-sandbox']))throw new AvitoError('BOOLEAN_REQUIRED');
 const proxy=publicOrigin(opts['public-origin']);if(proxy&&!opts['viewer-url'])throw new AvitoError('REMOTE_VIEWER_REQUIRED');
 if(opts['viewer-url']){let u;try{u=new URL(opts['viewer-url']);}catch{throw new AvitoError('VIEWER_URL_INVALID');}if(u.protocol!=='https:'||u.username||u.password)throw new AvitoError('VIEWER_URL_INVALID');}
 let old;try{old=await loadSession(stateDir);}catch(e){if(e.code!=='FILE_NOT_FOUND')throw e;}
 const bound=String(opts.profile??old?.profile_id??'');if(old&&bound!==old.profile_id)throw new AvitoError('STATE_BOUND_TO_ANOTHER_PROFILE');
 if(old&&!force){try{const c=new Client(old,{stateDir,...deps.fetchImpl?{fetchImpl:deps.fetchImpl}:{}}),id=await c.identity();return {...id,already_connected:true,verified:true,session_file:sessionFile(stateDir)};}catch(e){if(!['AUTH_REQUIRED','ACCESS_OR_CHALLENGE','PROFILE_MISMATCH'].includes(e.code))throw e;}}
 return withLock(path.join(stateDir,'locks','auth.lock'),async()=>{
  const browser=await (deps.browserFactory??AuthBrowser.open)(stateDir,{cdpURL:opts['cdp-url'],pageId:opts['page-id'],browserPath:opts['browser-path'],noSandbox:opts['no-sandbox']==='true'});
  let state={stage:'starting',title:copy.starting[0],message:copy.starting[1],viewer_url:opts['viewer-url']??null,verification_url:null,profiles:[]};let cancelled=false,wake=false,selected=bound||null,seenGuest=false,lastIdentity=-Infinity,lastStage=null,lastAction=null,lastActionAt=0,identity={status:0,profiles:[]},ui,done=false;
  const setState=async(stage,extra={})=>{const text=copy[stage]??copy.page;state={...state,...extra,stage,title:text[0],message:extra.message??text[1]};if(stage!==lastStage){lastStage=stage;await writeJson(path.join(stateDir,'auth-status.json'),safeAuthStatus(state));emit({event:'auth.stage',stage,verification_link_available:!!state.verification_url});}};
  const interrupt=()=>{cancelled=true;};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{
   ui=await (deps.uiFactory??createAuthUI)({port,proxyOrigin:proxy,getState:()=>state,onAction:async input=>{
    if(done)throw new AvitoError('AUTH_FINISHED');
    if(input.action==='cancel'){cancelled=true;return;}
    if(input.action==='open'){await browser.activate();return;}
    if(input.action==='continue'){wake=true;return;}
    if(input.action==='profile'){if(!state.profiles.some(p=>p.id===input.value))throw new AvitoError('PROFILE_INVALID');if(bound&&input.value!==bound)throw new AvitoError('STATE_BOUND_TO_ANOTHER_PROFILE');selected=input.value;wake=true;return;}
    if(input.action==='link'){if(!['video','video_consent','video_link','waiting_video'].includes(state.stage))throw new AvitoError('VIDEO_NOT_ACTIVE');const url=validateVerificationURL(input.value);if(!url)throw new AvitoError('VERIFICATION_LINK_INVALID');state.verification_url=url;wake=true;}
   }});
   emit({event:'auth.ready',ui_url:ui.url,mode:opts['cdp-url']?'explicit-browser-attachment':'local-browser',force_login:force});
   const contexts=()=>[null,...[...(browser.contexts?.values()??[])].filter(c=>c.auxData?.isDefault&&c.origin!=='https://www.avito.ru'&&/^https:\/\/[a-z0-9.-]+\.avito\.ru$/.test(c.origin)).map(c=>c.id)];
   // Clipboard capture is limited to an explicit Avito "copy link" action.
   if(browser.cdp){await browser.cdp.send('Runtime.addBinding',{name:'__avitoAuthLink'},browser.sessionId);await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installLinkCapture.toString()})();`},browser.sessionId);}
   const deadline=now()+timeout*1000,pacer=new Pacer();let observations=0,previousObservedStage=null;
   while(now()<deadline&&!cancelled){
    let observation,observationContext;const rank={page:0,credentials:1,video:2,sms:3,captcha:4};try{for(const contextId of contexts()){const v=await browser.evaluate(observeAuthDOM,[],contextId);if(v?.is_avito&&(!observation||(rank[v.stage]??5)>(rank[observation.stage]??5))){observation=v;observationContext=contextId;}if(v?.is_avito)try{await browser.evaluate(installLinkCapture,[],contextId);}catch{}}}catch(e){if(['BROWSER_DISCONNECTED','BROWSER_CONNECTION_FAILED'].includes(e.code))throw e;await pause(800);continue;}
    observations++;if(!observation){await setState('page');await pause(1200);continue;}
    const requested=wake;wake=false;
    if(requested||now()-lastIdentity>6000){lastIdentity=now();await pacer.between(true);try{identity=await browser.identity();}catch{identity={status:0,profiles:[]};}if(identity.status===401)seenGuest=true;}
    const current=identity.profiles?.find(p=>p.is_current);
    if(current&&force&&!seenGuest){await setState('signout');await pause(1200);continue;}
    if(current&&(!force||seenGuest)&&observation.stage==='page'){
     if(!selected&&identity.profiles.length>1){await setState('profile',{profiles:identity.profiles});await pause(1200);continue;}
     selected??=current.id;if(current.id!==selected){await setState('profile_switch',{profiles:identity.profiles,profile_id:selected});await pause(1200);continue;}
     await setState('verifying',{verification_url:null,profile_id:current.id});
     try{const cookies=await browser.cookies();const saved=await saveVerifiedSession({profile_id:current.id,cookies},stateDir,{expectedProfileId:selected,fetchImpl:deps.fetchImpl,source:'verified interactive browser login',beforeCommit:()=>{if(cancelled)throw new AvitoError('AUTH_CANCELLED',{session_preserved:true});if(now()>=deadline)throw new AvitoError('AUTH_TIMEOUT',{session_preserved:true});}});done=true;await setState('ready',{profile_id:current.id,message:'Подключён профиль «'+current.name+'». Сессия проверена и сохранена.',verification_url:null});await pause(1800);return {...saved,name:current.name,session_file:sessionFile(stateDir),fresh_login_observed:seenGuest,observations};}
     catch(e){if(['AUTH_REQUIRED','ACCESS_OR_CHALLENGE','PROFILE_MISMATCH'].includes(e.code)){identity={status:0,profiles:[]};lastIdentity=now();await setState('challenge',{verification_url:null});await pause(3000);continue;}throw e;}
    }
    let stage=observation.stage;
    if(stage==='video'){
     const urls=[...(observation.verification_urls??[]),browser.lastCopy].map(validateVerificationURL).filter(Boolean);browser.lastCopy=null;
     if(urls.length===1)state.verification_url=urls[0];
     if(observation.consent_required)stage='video_consent';else if(state.verification_url)stage='waiting_video';
    }else if(['credentials','sms','captcha'].includes(stage)){state.verification_url=null;}
    if(previousObservedStage!==stage){lastAction=null;previousObservedStage=stage;}
    await setState(stage);
    const kind=stage==='page'&&identity.status===401?'open-login':stage==='video'&&!observation.consent_required?(observation.has_transfer?'video-transfer':'video-next'):requested&&stage==='waiting_video'?'video-next':null;
    const actionKey=kind+':'+stage+':'+(observation.video_step??'');
    if(kind&&(lastAction!==actionKey||requested)&&now()-lastActionAt>900){const action=await browser.evaluate(authAction,[kind,observation.video_step],observationContext);if(action?.clicked){lastAction=actionKey;lastActionAt=now();}else if(requested)lastAction=null;}
    if(stage!==lastStage)lastAction=null;
    await pause(1200);
   }
   done=true;await setState(cancelled?'cancelled':'timeout',{verification_url:null});await pause(1800);throw new AvitoError(cancelled?'AUTH_CANCELLED':'AUTH_TIMEOUT',{session_preserved:true});
  }catch(e){if(!done&&['AUTH_CANCELLED','AUTH_TIMEOUT'].includes(e.code)){done=true;await setState(e.code==='AUTH_CANCELLED'?'cancelled':'timeout',{verification_url:null});await pause(1800);}throw e;}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);await browser.disconnect().catch(()=>{});if(ui)await ui.close();}
 });
}
export async function authStatus(stateDir){return await readJson(path.join(stateDir,'auth-status.json'),{privateFile:true,optional:true})??{stage:'not_started'};}
