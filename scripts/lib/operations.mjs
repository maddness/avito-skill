import path from 'node:path';import crypto from 'node:crypto';import {AvitoError} from './errors.mjs';import {readJson,writeJson,withLock} from './storage.mjs';
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
export const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export class Operations{
 constructor(stateDir,profileId){this.dir=stateDir;this.profileId=String(profileId);}
 file(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new AvitoError('OPERATION_ID_INVALID');return path.join(this.dir,'operations',id+'.json');}
 async get(id){const op=await readJson(this.file(id),{privateFile:true});if(op.profile_id!==this.profileId)throw new AvitoError('PROFILE_MISMATCH');return op;}
 async prepare(kind,scope,payload,{dedupeKey}={}){
  return withLock(path.join(this.dir,'locks','operations-index.lock'),async()=>{
   const indexFile=path.join(this.dir,'operations','index.json');const index=await readJson(indexFile,{optional:true,privateFile:true})??{by_key:{},by_target:{}};
   const key=hash({profile:this.profileId,kind,dedupeKey:dedupeKey??{scope,payload}}),target=hash({profile:this.profileId,kind,target:scope.target_ref??scope.source_asset_id??scope.chat_id??scope.item_id??scope.draft_id??scope});
   if(index.by_key[key])return this.get(index.by_key[key]);
   for(const id of index.by_target[target]??[]){const prev=await this.get(id);if(['submitting','unknown'].includes(prev.status))throw new AvitoError('RECONCILE_REQUIRED',{operation_id:id});if(kind==='publish'&&prev.status==='succeeded')throw new AvitoError('ALREADY_PUBLISHED',{operation_id:id,item_id:prev.result?.item_id});}
   const op={schema_version:1,id:crypto.randomUUID(),kind,profile_id:this.profileId,scope,target_key:target,payload,payload_hash:hash(payload),status:'prepared',created_at:new Date().toISOString(),attempts:0};
   await writeJson(this.file(op.id),op);index.by_key[key]=op.id;index.by_target[target]=[...(index.by_target[target]??[]),op.id];await writeJson(indexFile,index);return op;
  });
 }
 async run(id,effect,{preflight,kind}={}){
  return withLock(path.join(this.dir,'locks','writer.lock'),async()=>{
   const op=await this.get(id);if(kind&&op.kind!==kind)throw new AvitoError('OPERATION_KIND_MISMATCH');if(hash(op.payload)!==op.payload_hash)throw new AvitoError('PAYLOAD_CHANGED');
   if(op.status==='succeeded')return {already_completed:true,...op.result,operation_id:op.id};
   if(op.status!=='prepared')throw new AvitoError('RECONCILE_REQUIRED',{operation_id:op.id,status:op.status});
   const target=op.target_key??hash({profile:this.profileId,kind:op.kind,target:op.scope.target_ref??op.scope.source_asset_id??op.scope.chat_id??op.scope.item_id??op.scope.draft_id??op.scope});
   const index=await readJson(path.join(this.dir,'operations','index.json'),{privateFile:true});
   for(const peerId of index.by_target[target]??[]){if(peerId===op.id)continue;const peer=await this.get(peerId);if(['submitting','unknown'].includes(peer.status))throw new AvitoError('RECONCILE_REQUIRED',{operation_id:peerId});if(op.kind==='publish'&&peer.status==='succeeded')throw new AvitoError('ALREADY_PUBLISHED',{operation_id:peerId,item_id:peer.result?.item_id});}
   if(preflight)await preflight(op);
   op.status='submitting';op.attempts++;op.attempted_at=new Date().toISOString();await writeJson(this.file(id),op);
   const checkpoint=async observation=>{op.observation=observation;await writeJson(this.file(id),op);};
   try{const result=await effect(op,checkpoint);op.status='succeeded';op.result=result;op.completed_at=new Date().toISOString();await writeJson(this.file(id),op);return {...result,operation_id:op.id};}
   catch(e){op.status=e instanceof AvitoError&&e.details?.confirmed_no_effect?'rejected':'unknown';op.error={code:e instanceof AvitoError?e.code:'EXECUTION_ERROR'};await writeJson(this.file(id),op);if(e instanceof AvitoError)throw e;throw new AvitoError('OUTCOME_UNKNOWN',{operation_id:op.id});}
  });
 }
 async reconcile(id,verify,{kind}={}){return withLock(path.join(this.dir,'locks','writer.lock'),async()=>{const op=await this.get(id);if(kind&&op.kind!==kind)throw new AvitoError('OPERATION_KIND_MISMATCH');if(!['unknown','submitting'].includes(op.status))return {status:op.status,result:op.result??null};const result=await verify(op);if(result){op.status='succeeded';op.result=result;op.reconciled_at=new Date().toISOString();await writeJson(this.file(id),op);}return {status:op.status,result:op.result??null};});}
}
