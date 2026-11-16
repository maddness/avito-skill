import './isolate-state.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {Operations} from '../scripts/lib/operations.mjs';
import {publishSale,verifySale} from '../scripts/lib/publishing.mjs';
import {sendMessage,verifyMessage,inbox,history} from '../scripts/lib/messages.mjs';
import {applyEdit,verifyEditOperation,verifyWithdrawOperation} from '../scripts/lib/lifecycle.mjs';
for(const[name,run,wrongKind]of [['sell publish',publishSale,'message'],['sell verify',verifySale,'message'],['message send',sendMessage,'publish'],['message verify',verifyMessage,'publish'],['edit apply',applyEdit,'message'],['edit verify',verifyEditOperation,'message'],['withdraw verify',verifyWithdrawOperation,'message']]){
 test(`${name} rejects an already completed operation of another kind`,async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'avito-kind-'));try{const ops=new Operations(dir,'9'),op=await ops.prepare(wrongKind,{item_id:'123'},{text:'Fixture'},{dedupeKey:name});await ops.run(op.id,async()=>({message_id:'fixture-message',delivered:true}));await assert.rejects(run({session:{profile_id:'9'}},dir,op.id),{code:'OPERATION_KIND_MISMATCH'});}finally{await fs.rm(dir,{recursive:true,force:true});}});
}
function partialClient(){let page=0;return {session:{profile_id:'9'},identity:async()=>({profile_id:'9'}),bodyItems:async()=>[{id:123,title:'Fixture',originalUserId:'9',isActive:true}],rpc:async method=>{if(method==='avito.getChats.v5')return {hasMore:false,channels:[{channelId:'C',context:{value:{id:123}},info:{name:'Fixture'}}]};if(method==='messenger.history.v2'){const offset=page++*50;return {items:Array.from({length:50},(_,i)=>({id:'m'+(offset+i),channelId:'C',type:'text',uid:'viewer',originalUid:'9',fromUid:'buyer',created:(17947760000000000n-BigInt(offset+i)).toString(),body:{text:'Fixture '+(offset+i)},isRead:false}))};}throw Error('Unexpected fixture RPC');}};}
test('partial history keeps chronological order at the page budget',async()=>{const r=await history(partialClient(),'C',{maxPages:1});assert.equal(r.complete,false);assert.equal(r.messages.at(-1).id,'m0');});
test('partial inbox reports the newest observed incoming message',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'avito-inbox-'));try{const r=await inbox(partialClient(),dir,{itemIds:['123']});assert.equal(r.complete,false);assert.equal(r.checkpoint_advanced,false);assert.equal(r.chats[0].last_incoming.id,'m0');assert.equal(r.chats[0].awaiting_reply,null);}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('running an individual test cannot read or replace the caller session override',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'avito-env-test-'));try{const sentinel=path.join(dir,'caller-session.json');const content=JSON.stringify({schema_version:1,binding_id:'outside-test-fixture',profile_id:'TEST_PROFILE',cookies:[{name:'fixture',value:'SYNTHETIC_OUTSIDE_SESSION',domain:'.avito.ru',path:'/'}]});await fs.writeFile(sentinel,content,{mode:0o600});const file=fileURLToPath(new URL('./core-boundaries.test.mjs',import.meta.url));const r=spawnSync(process.execPath,['--test','--test-name-pattern=session import is private and does not return cookie values',file],{env:{AVITO_SESSION_FILE:sentinel},encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(await fs.readFile(sentinel,'utf8'),content);}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('offline tests also work from a checkout path containing spaces', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'avito paths '));
 try {
  const checkout = path.join(dir, 'checkout with spaces');
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const project = path.join(checkout, 'avito');
  const tests = path.join(project, 'tests');
  await fs.mkdir(tests, { recursive: true });
  for (const name of ['SKILL.md', 'LICENSE', 'scripts', 'references', 'assets']) {
   await fs.cp(path.join(repo, name), path.join(project, name), { recursive: true });
  }
  for (const name of ['core-boundaries.test.mjs', 'isolate-state.mjs']) {
   await fs.copyFile(fileURLToPath(new URL('./' + name, import.meta.url)), path.join(tests, name));
  }
  const r = spawnSync(process.execPath, [
   '--test', '--test-name-pattern=session import is private and does not return cookie values',
   path.join(tests, 'core-boundaries.test.mjs'),
  ], { env: {}, encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
 } finally {
  await fs.rm(dir, { recursive: true, force: true });
 }
});
