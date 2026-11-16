import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {AvitoError} from './errors.mjs';
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function defaultStateDir(){return path.join(process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local','state'),'avito');}
export async function ensurePrivateDir(dir){await fs.mkdir(dir,{recursive:true,mode:0o700});const st=await fs.lstat(dir);if(st.isSymbolicLink()||!st.isDirectory())throw new AvitoError('UNSAFE_STATE_DIRECTORY');if(process.getuid&&st.uid!==process.getuid())throw new AvitoError('STATE_OWNER_MISMATCH');await fs.chmod(dir,0o700);}
export async function readJson(file,{optional=false,privateFile=false}={}){
 try{const st=await fs.lstat(file);if(st.isSymbolicLink()||!st.isFile())throw new AvitoError('UNSAFE_STATE_FILE');if(privateFile&&process.platform!=='win32'&&(st.mode&0o077))throw new AvitoError('SECRET_FILE_PERMISSIONS',{required:'0600'});const data=await fs.readFile(file,'utf8');try{return JSON.parse(data);}catch{throw new AvitoError('STATE_CORRUPT');}}
 catch(e){if(optional&&e.code==='ENOENT')return null;if(e instanceof AvitoError)throw e;throw new AvitoError(e.code==='ENOENT'?'FILE_NOT_FOUND':'STATE_IO_ERROR');}
}
export async function writeJson(file,data,{beforeCommit}={}){await ensurePrivateDir(path.dirname(file));const temp=file+'.'+crypto.randomUUID()+'.tmp';let handle;try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(data,null,2));await handle.sync();await handle.close();handle=null;if(beforeCommit)beforeCommit();await fs.rename(temp,file);try{const dir=await fs.open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}}catch{}}catch(e){if(handle)await handle.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});throw e;}}

export async function withLock(file,callback,{timeout=15000}={}){
 await ensurePrivateDir(path.dirname(file));const start=Date.now();let handle;
 // Existence is the lock. PID values are diagnostic only: separate agent exec
 // cells may live in different PID namespaces while sharing the filesystem.
 while(!handle){
  try{handle=await fs.open(file,'wx',0o600);await handle.writeFile(JSON.stringify({pid_hint:process.pid,created_at:Date.now()}));await handle.sync();}
  catch(e){if(e.code!=='EEXIST')throw new AvitoError('LOCK_IO_ERROR');if(Date.now()-start>=timeout)throw new AvitoError('BUSY',{retryable:true,manual_recovery_if_orphaned:true});await sleep(75);}
 }
 try{return await callback();}finally{await handle.close();await fs.unlink(file);}
}
