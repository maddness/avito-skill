#!/usr/bin/env node
import {validateArguments} from './lib/arguments.mjs';
import path from 'node:path';import fs from 'node:fs/promises';
import {AvitoError,safeError} from './lib/errors.mjs';import {defaultStateDir,writeJson,readJson} from './lib/storage.mjs';import {importSession,loadSession} from './lib/session.mjs';import {Client} from './lib/client.mjs';import {cities,search,item} from './lib/search.mjs';
const argv=process.argv.slice(2),command=argv.shift();let sub=argv[0]&&!argv[0].startsWith('--')?argv.shift():null;const opts={};let client;
try{
 for(let i=0;i<argv.length;i++){const k=argv[i];if(!/^--[a-z][a-z-]*$/.test(k)||opts[k.slice(2)]!==undefined)throw new AvitoError('INVALID_ARGUMENTS');if(!argv[i+1]||argv[i+1].startsWith('--'))opts[k.slice(2)]=true;else opts[k.slice(2)]=argv[++i];}
 const stateDir=path.resolve(typeof opts['state-dir']==='string'?opts['state-dir']:defaultStateDir());
 if(!command||command==='help'||opts.help){console.log(JSON.stringify({name:'avito',runtime:'Node.js 22+',commands:[
 'auth login [--browser-path FILE] [--force-login true] [--profile ID]','auth status',
 'session import --file FILE [--profile ID]','session status',
 'cities find --query CITY','search run --query TEXT --city CITY [--city-id ID]','search next --cursor UUID','item view --id ID | --url URL',
 'own list [--status all]','inbox list [--items ID,ID]','chat read --id CHAT',
 'message prepare --item ID | --chat CHAT --text-file FILE --intent REQUEST_REF','message send --operation UUID','message verify --operation UUID',
 'category find --query TEXT [--root ID]','category schema --id CHOICE [--title TEXT]','category option --id CHOICE --field ID --query TEXT',
 'sell prepare --spec FILE','sell publish --operation UUID','sell verify --operation UUID',
 'edit prepare --item ID --text-file FILE --intent REQUEST_REF','edit apply --operation UUID','edit verify --operation UUID',
 'delivery get --item ID','delivery set --item ID --enabled true|false --intent REQUEST_REF',
 'withdraw reasons --item ID','withdraw run --item ID --intent REQUEST_REF','withdraw verify --operation UUID',
 'operation status --id UUID'],global:['--state-dir PRIVATE_DIR','--output PRIVATE_JSON'],prohibited:['payments','checkout','purchase','card/balance','paid promotion']}));process.exit(0);}
 if(Number(process.versions.node.split('.')[0])<22)throw new AvitoError('NODE_22_REQUIRED');
 validateArguments(command,sub,opts);
 let result;
 if(command==='auth'){const {authLogin,authStatus}=await import('./lib/auth.mjs');result=sub==='login'?await authLogin(stateDir,opts,{emit:event=>console.log(JSON.stringify({ok:true,...event}))}):await authStatus(stateDir);}
 else if(command==='session'&&sub==='import')result=await importSession(opts.file,stateDir,{expectedProfileId:opts.profile});
 else{
  client=new Client(await loadSession(stateDir),{stateDir});
  if(command==='session'&&sub==='status')result={...await client.identity(),source:'live-http',credentials_exposed:false};
  else if(command==='cities'&&sub==='find')result={cities:await cities(client,opts.query)};
  else if(command==='search'&&['run','next'].includes(sub))result=await search(client,stateDir,{query:opts.query,city:opts.city,cityId:opts['city-id'],page:opts.page?Number(opts.page):1,cursor:opts.cursor});
  else if(command==='item'&&sub==='view')result=await item(client,stateDir,{id:opts.id,url:opts.url});
  else{const {dispatch}=await import('./lib/workflows.mjs');result=await dispatch({command,sub,opts,stateDir,client});}
 }
 if(opts.output)await writeJson(path.resolve(opts.output),result);
 const trace=client?.transport.trace??[];if(trace.length)await writeJson(path.join(stateDir,'last-trace.json'),trace);
 console.log(JSON.stringify({ok:true,command:[command,sub].filter(Boolean).join(' '),result,http_calls:trace.length}));
}catch(e){console.log(JSON.stringify(safeError(e)));process.exitCode=1;}
