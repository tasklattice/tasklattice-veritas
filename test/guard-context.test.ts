import assert from 'node:assert/strict';
import {test} from 'node:test';
import TaliProvider from '../src/core/provider.js';
import {validateCase} from '../src/core/files.js';
import {guardContextPayload} from '../src/core/guard-context.js';
import type {Case} from '../src/shared/types.js';
const c = (): Case => ({id:'boundary',dataset:'fixture',phase:'input',text:'Untrusted document',expected:'block',guardContext:{targetSource:'retrieved_content',query:'Summarize the document.'},metadata:{expected_memory:'DO NOT SEND',adversarial_goal:'DO NOT SEND'}});

test('LiteLLM transmits only boundary evidence and keeps the original external content',async t=>{
 const bodies:any[]=[];
 t.mock.method(globalThis,'fetch',async (_url:any,options:any)=>{bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({action:'BLOCKED',texts:[]}));});
 const p=new TaliProvider({config:{target:{url:'http://fixture.test',adapter:'litellm-generic-guardrail',outputMode:'standalone'}}});
 for(const memory of [undefined,{operation:'read' as const,sourceQuery:'Acquisition query'},{operation:'write' as const,sourceQuery:'Acquisition query'}]){
  const item=c();if(memory)item.guardContext={query:'Original task',memory};
  const result=JSON.parse((await p.callApi('',{vars:{case:item}})).output);
  assert.equal(result.status,'completed');const body=bodies.at(-1);assert.deepEqual(body.texts,[item.text]);assert.equal(body.input_type,'request');
  assert.deepEqual(body.guardrail_context,guardContextPayload(item));assert.ok(!JSON.stringify(body).includes('DO NOT SEND'));
  assert.deepEqual(result.steps[0].request,body);
 }
});

test('Invalid boundaries cannot silently become ordinary scans',()=>{
 for(const context of [null,[],{targetSource:'system'},{targetSource:'retrieved_content',expected_memory:'label'},{memory:{operation:'delete'}},{memory:{operation:'read',sourceQuery:5}},{targetSource:'user_input',memory:{operation:'read'}},{targetSource:'retrieved_content',query:'x'.repeat(100001)}])assert.throws(()=>validateCase({...c(),guardContext:context}));
 assert.throws(()=>validateCase({...c(),phase:'output'}));
});

test('F5 refuses context-dependent cases before any HTTP call',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Must not send');});
 const p=new TaliProvider({config:{target:{url:'http://fixture.test',adapter:'f5-scan',outputMode:'standalone'}}});
 const result=JSON.parse((await p.callApi('',{vars:{case:c()}})).output);
 assert.equal(result.status,'error');assert.match(result.error,/cannot preserve Guard boundary context/);assert.equal(calls,0);
});
