import {AvitoError} from './errors.mjs';
const specs={
 'auth login':['cdp-url page-id browser-path port public-origin viewer-url force-login timeout-seconds no-sandbox profile',[]], 'auth status':['',[]],
 'session import':['file profile',['file']], 'session status':['',[]],
 'cities find':['query',['query']], 'search run':['query city city-id page',['query','city']], 'search next':['cursor',['cursor']], 'item view':['id url',[]],
 'own list':['status',[]], 'inbox list':['items',[]], 'chat read':['id',['id']],
 'message prepare':['item chat text-file intent',['text-file','intent']], 'message send':['operation',['operation']], 'message verify':['operation',['operation']],
 'category find':['query root',['query']], 'category schema':['id title',['id']], 'category option':['id field query',['id','field','query']],
 'sell prepare':['spec',['spec']], 'sell publish':['operation',['operation']], 'sell verify':['operation',['operation']],
 'edit prepare':['item text-file intent',['item','text-file','intent']], 'edit apply':['operation',['operation']], 'edit verify':['operation',['operation']],
 'delivery get':['item',['item']], 'delivery set':['item enabled intent',['item','enabled','intent']],
 'withdraw reasons':['item',['item']], 'withdraw run':['item intent',['item','intent']], 'withdraw verify':['operation',['operation']], 'operation status':['id',['id']]
};
export function validateArguments(command,sub,opts){const key=command+' '+sub,spec=specs[key];if(!spec)throw new AvitoError('COMMAND_NOT_SUPPORTED');const allowed=new Set([...spec[0].split(' '),'state-dir','output']);for(const[k,v]of Object.entries(opts)){if(!allowed.has(k))throw new AvitoError('UNKNOWN_ARGUMENT',{argument:k});if(typeof v!=='string'||!v.trim())throw new AvitoError('ARGUMENT_VALUE_REQUIRED',{argument:k});}for(const k of spec[1])if(!opts[k])throw new AvitoError('ARGUMENT_REQUIRED',{argument:k});if(key==='item view'&&!opts.id&&!opts.url||key==='message prepare'&&!opts.item&&!opts.chat)throw new AvitoError('TARGET_REQUIRED');if(key==='own list'&&opts.status&&!['all','active'].includes(opts.status))throw new AvitoError('STATUS_INVALID');}
