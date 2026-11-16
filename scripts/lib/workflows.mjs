import {prepareEdit,applyEdit,verifyEditOperation,withdrawReasons,withdraw,verifyWithdrawOperation} from './lifecycle.mjs';
import fs from 'node:fs/promises';import {AvitoError} from './errors.mjs';import {ownItems,inbox,history,prepareMessage,sendMessage,verifyMessage} from './messages.mjs';import {Operations} from './operations.mjs';
import {prepareSale,publishSale,verifySale,enforceDelivery,deliveryState} from './publishing.mjs';
import {readJson} from './storage.mjs';
import {findCategories,categorySchema,fieldOptions} from './categories.mjs';
export async function dispatch({command,sub,opts,stateDir,client}){
 if(command==='edit'&&sub==='prepare')return prepareEdit(client,stateDir,{id:opts.item,description:await fs.readFile(opts['text-file'],'utf8'),intent:opts.intent});
 if(command==='edit'&&sub==='apply')return applyEdit(client,stateDir,opts.operation);
 if(command==='edit'&&sub==='verify')return verifyEditOperation(client,stateDir,opts.operation);
 if(command==='withdraw'&&sub==='reasons')return {item_id:opts.item,reasons:await withdrawReasons(client,opts.item)};
 if(command==='withdraw'&&sub==='run')return withdraw(client,stateDir,{id:opts.item,intent:opts.intent});
 if(command==='withdraw'&&sub==='verify')return verifyWithdrawOperation(client,stateDir,opts.operation);
 if(command==='sell'&&sub==='prepare')return prepareSale(client,stateDir,await readJson(opts.spec));
 if(command==='sell'&&sub==='verify')return verifySale(client,stateDir,opts.operation);
 if(command==='sell'&&sub==='publish')return publishSale(client,stateDir,opts.operation);
 if(command==='delivery'&&sub==='get'){const d=await client.delivery(Number(opts.item));return {item_id:opts.item,services:d.services.map(x=>({type:x.type,enabled:x.enabled,available:x.available}))};}
 if(command==='delivery'&&sub==='set'){if(typeof opts.intent!=='string'||!opts.intent.trim())throw new AvitoError('INTENT_REQUIRED');if(!['true','false'].includes(opts.enabled))throw new AvitoError('BOOLEAN_REQUIRED');const ops=new Operations(stateDir,client.session.profile_id);const op=await ops.prepare('delivery',{item_id:String(opts.item)},{item_id:String(opts.item),enabled:opts.enabled==='true'},{dedupeKey:{item:opts.item,enabled:opts.enabled,intent:opts.intent??'single-request'}});const result=await ops.run(op.id,async()=>({item_id:opts.item,...await enforceDelivery(client,Number(opts.item),opts.enabled==='true')}),{kind:'delivery',preflight:async()=>{await client.ownItem(Number(opts.item));}});const active=deliveryState(await client.delivery(Number(opts.item))).filter(x=>x.enabled).map(x=>x.type);if(JSON.stringify(active)!==JSON.stringify(result.enabled))throw new AvitoError('OPERATION_SUPERSEDED',{operation_id:op.id,current_enabled:active});return result;}
 if(command==='category'&&sub==='find')return findCategories(client,stateDir,opts.query,{rootCategoryId:Number(opts.root??0)});
 if(command==='category'&&sub==='schema')return categorySchema(client,stateDir,opts.id,{title:opts.title});
 if(command==='category'&&sub==='option')return fieldOptions(client,stateDir,opts.id,opts.field,opts.query);
 if(command==='own'&&sub==='list'){const r=await ownItems(client,{activeOnly:opts.status!=='all'});return {...r,items:r.items.map(x=>({id:String(x.id),title:x.title,price_rub:x.price,is_active:x.isActive,status_id:x.statusId,url:new URL(x.urlPath,'https://www.avito.ru').origin+new URL(x.urlPath,'https://www.avito.ru').pathname}))};}
 if(command==='inbox'&&sub==='list')return inbox(client,stateDir,{itemIds:typeof opts.items==='string'?opts.items.split(','):undefined});
 if(command==='chat'&&sub==='read'){await client.identity();const thread=await client.rpc('avito.getChatById.v3',{channelId:opts.id});const h=await history(client,opts.id);return {chat_id:opts.id,item_id:String(thread.context?.value?.id),...h};}
 if(command==='message'&&sub==='prepare'){if(typeof opts['text-file']!=='string')throw new AvitoError('TEXT_FILE_REQUIRED');const text=await fs.readFile(opts['text-file'],'utf8');return prepareMessage(client,stateDir,{itemId:opts.item,chatId:opts.chat,text:text.trim(),intent:opts.intent});}
 if(command==='message'&&sub==='verify')return verifyMessage(client,stateDir,opts.operation);
 if(command==='message'&&sub==='send')return sendMessage(client,stateDir,opts.operation);
 if(command==='operation'&&sub==='status'){const op=await new Operations(stateDir,client.session.profile_id).get(opts.id);return {id:op.id,kind:op.kind,status:op.status,scope:op.scope,attempts:op.attempts,error:op.error??null,observation:op.observation??null,result:op.result??null};}
 throw new AvitoError('COMMAND_NOT_SUPPORTED');
}
