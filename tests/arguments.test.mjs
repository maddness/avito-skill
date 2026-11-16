import './isolate-state.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {validateArguments as check} from '../scripts/lib/arguments.mjs';
test('mutation cannot silently ignore an unsupported argument',()=>assert.throws(()=>check('sell','publish',{operation:'x',paid:'true'}),/UNKNOWN_ARGUMENT/));
test('missing value and unsupported status fail before session read',()=>{assert.throws(()=>check('withdraw','run',{item:true,intent:'r'}),/ARGUMENT_VALUE_REQUIRED/);assert.throws(()=>check('own','list',{status:'deleted'}),/STATUS_INVALID/);});
test('target and stable request reference are required',()=>{assert.throws(()=>check('message','prepare',{'text-file':'x',intent:'r'}),/TARGET_REQUIRED/);assert.throws(()=>check('delivery','set',{item:'1',enabled:'false'}),/ARGUMENT_REQUIRED/);});
test('unknown financial command fails without touching state',()=>assert.throws(()=>check('payment','run',{}),/COMMAND_NOT_SUPPORTED/));
test('supported prepare can carry a scope cross-check',()=>assert.doesNotThrow(()=>check('message','prepare',{item:'1',chat:'C','text-file':'x',intent:'r'})));
