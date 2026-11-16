import path from 'node:path';
import crypto from 'node:crypto';
import {AvitoError} from './errors.mjs';
import {readJson,writeJson,ensurePrivateDir,withLock} from './storage.mjs';
export function sessionFile(stateDir){const value=process.env.AVITO_SESSION_FILE;if(value){if(!path.isAbsolute(value))throw new AvitoError('SESSION_PATH_ABSOLUTE_REQUIRED');return path.normalize(value);}return path.join(stateDir,'session.json');}
export async function saveVerifiedSession(input,stateDir,{expectedProfileId,fetchImpl,source='owner-provided cookie bundle',beforeCommit}={}){
 const profile=String(expectedProfileId??input?.profile_id??input?.expected_profile_id??'');
 if(!profile||!Array.isArray(input?.cookies)||!input.cookies.length)throw new AvitoError('SESSION_FORMAT_INVALID');
 if(expectedProfileId&&input.expected_profile_id&&String(input.expected_profile_id)!==profile)throw new AvitoError('PROFILE_MISMATCH');
 const cookies=input.cookies.filter(c=>{const d=String(c.domain||'').replace(/^\./,'');return d==='avito.ru'||d.endsWith('.avito.ru');});
 if(!cookies.length||cookies.some(c=>typeof c.name!=='string'||typeof c.value!=='string'||!c.name||/[;\r\n]/.test(c.name)||/[\r\n]/.test(c.value)))throw new AvitoError('SESSION_FORMAT_INVALID');
 await ensurePrivateDir(stateDir);
 return withLock(path.join(stateDir,'locks','session.lock'),async()=>{
  const destination=sessionFile(stateDir),old=await readJson(destination,{optional:true,privateFile:true});if(old&&old.profile_id!==profile)throw new AvitoError('STATE_BOUND_TO_ANOTHER_PROFILE');
  const bundle={schema_version:1,binding_id:old?.binding_id??crypto.randomUUID(),profile_id:profile,cookies,imported_at:new Date().toISOString(),source,timezone:old?.timezone??'Europe/Moscow'};
  const {Transport}=await import('./transport.mjs');const transport=new Transport(bundle,{stateDir,...fetchImpl?{fetchImpl}:{}});const checked=await transport.request('/web/1/profiles/list?limit=3&withEntities=true');const current=checked.result?.profiles?.find(p=>p.isCurrent);if(String(current?.profileId)!==profile)throw new AvitoError('PROFILE_MISMATCH');
  await writeJson(destination,bundle,{beforeCommit});return {imported:true,verified:true,profile_id:profile,binding_id:bundle.binding_id,cookie_count:cookies.length};
 });
}
export async function importSession(source,stateDir,options={}){return saveVerifiedSession(await readJson(source,{privateFile:true}),stateDir,options);}
export async function loadSession(stateDir){const s=await readJson(sessionFile(stateDir),{privateFile:true});if(s.schema_version!==1||!s.binding_id||!s.profile_id||!Array.isArray(s.cookies))throw new AvitoError('SESSION_FORMAT_INVALID');return s;}
