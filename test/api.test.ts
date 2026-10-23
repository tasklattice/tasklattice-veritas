import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../src/server/main.js';
import { datasets, targets, saveTarget } from '../src/server/store.js';
import { root, json, lines } from '../src/core/files.js';
import { importDataset } from '../src/core/datasets.js';
import { startMock } from '../scripts/mock-endpoint.js';

test('API enforces local origin, uses discovered resources and produces full run artifacts',async()=>{
 const name='api-test-'+randomUUID().slice(0,8),data=join(root,'data',name),source=join(root,'data',name+'.jsonl');const mock=await startMock();
 const {app,store}=await buildServer({ui:false});const headers={host:'localhost:38100'};let id='';
 try{
  mkdirSync(join(root,'data'),{recursive:true});
  const fixture=lines<any>(join(root,'examples/endpoint-smoke.jsonl'));fixture[0].expected='block';
  writeFileSync(source,fixture.map(c=>JSON.stringify(c)).join('\n')+'\n');
  await importDataset({dataset:'veritas',file:source,out:data,limit:0});
  const created=await app.inject({method:'POST',url:'/api/endpoints',headers,payload:{name,endpoint:{adapter:'f5-scan',url:mock.f5Url}}});assert.equal(created.statusCode,200,created.body);
  const d=datasets().find(d=>d.path===data)!,t=targets().find(t=>t.name===name)!;
  assert.equal((await app.inject({url:'/api/runs',headers:{host:'evil.test'}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/runs',headers:{...headers,origin:'http://evil.test'}})).statusCode,403);
  const invalid=await app.inject({method:'POST',url:'/api/runs',headers,payload:{datasetId:'../../etc',targetId:t.id}});assert.equal(invalid.statusCode,400);
  const cards=(await app.inject({url:'/api/datasets',headers})).json().items;
  assert.ok(cards.every((c:any)=>c.source!=='local'));
  const selections=(await app.inject({url:'/api/dataset-selections',headers})).json().items;assert.ok(selections.some((v:any)=>v.id===d.id));
  assert.equal(cards.filter((c:any)=>c.id==='wildjailbreak').length,1);
  const endpoint=(await app.inject({url:'/api/endpoints',headers})).json().items.find((e:any)=>e.id===t.id);
  assert.equal(endpoint.endpoint.adapter,'f5-scan');assert.equal(endpoint.target,undefined);
  const wrong=await app.inject({method:'POST',url:'/api/runs',headers,payload:{datasetId:'wildjailbreak',selectionId:d.id,endpointId:t.id,repeat:1,concurrency:2}});
  assert.equal(wrong.statusCode,400);assert.equal(mock.requests.length,0);
  const missingEndpoint=await app.inject({method:'POST',url:'/api/runs',headers,payload:{datasetId:'wildjailbreak',endpointId:'missing',repeat:1,concurrency:2,limit:2}});assert.equal(missingEndpoint.statusCode,400);assert.equal(mock.requests.length,0);
  const result=await app.inject({method:'POST',url:'/api/runs',headers,payload:{datasetId:'endpoint-smoke',selectionId:d.id,endpointId:t.id,repeat:1,concurrency:2,evidence:'synthetic-local-demo'}});assert.equal(result.statusCode,202,result.body);id=result.json().id;
  const deadline=Date.now()+20000;while(Date.now()<deadline){const r=store.detail(id).run;if(!['preparing','running','scoring','queued'].includes(r.status))break;await new Promise(r=>setTimeout(r,30));}
  const detail=await app.inject({url:'/api/runs/'+id,headers});assert.equal(detail.json().run.status,'completed');assert.equal(detail.json().run.datasetId,'endpoint-smoke');assert.equal(detail.json().run.endpointId,t.id);assert.equal(detail.json().report.summary.completed,6);
  const path=store.directory(id);assert.ok(existsSync(join(path,'attempts.jsonl')));assert.ok(!existsSync(join(path,'evaluation')));
  const attempts=await app.inject({url:'/api/runs/'+id+'/attempts',headers});assert.equal(attempts.json().items.length,6);assert.equal(attempts.json().allTotal,6);
  const mismatch=await app.inject({url:'/api/runs/'+id+'/attempts?filter=unexpected&limit=1',headers});assert.equal(mismatch.json().total,1);assert.equal(mismatch.json().items.length,1);assert.equal(mismatch.json().items[0].grade.pass,false);
  const after=await app.inject({url:'/api/runs/'+id+'/attempts?filter=unexpected&offset=1&limit=1',headers});assert.equal(after.json().total,1);assert.equal(after.json().items.length,0);assert.equal(attempts.json().items.filter((a:any)=>a.grade.pass).length,5);
  assert.equal((await app.inject({url:'/api/runs/'+id+'/files/snapshot.json',headers})).statusCode,404);
  const csv=await app.inject({url:'/api/runs/'+id+'/files/results.csv',headers});assert.equal(csv.statusCode,200);assert.match(csv.body,/case_id/);
  assert.equal(store.list().filter(r=>r.id===id).length,1);
 }finally{await app.close();await mock.close();if(id){const p=store.directory(id);rmSync(p,{recursive:true,force:true});rmSync(join(root,'data/jobs',id+'.json'),{force:true});}rmSync(data,{recursive:true,force:true});rmSync(source,{force:true});rmSync(join(root,'data/targets',name+'.json'),{force:true});}
});

test('API cancellation preserves partial evidence and cancels queued jobs without sending them',async()=>{
 const name='cancel-test-'+randomUUID().slice(0,8),data=join(root,'data',name),source=join(root,'data',name+'.jsonl');
 mkdirSync(join(root,'data'),{recursive:true});writeFileSync(source,Array.from({length:12},(_,i)=>JSON.stringify({id:String(i),dataset:'fixture',phase:'input',text:'[SLOW]',expected:'allow'})).join('\n')+'\n');
 const mock=await startMock(),{app,store}=await buildServer({ui:false});const ids:string[]=[];
 try{
  await importDataset({dataset:'veritas',file:source,out:data});const t=saveTarget({name,target:{adapter:'f5-scan',url:mock.f5Url}}),d=datasets().find(d=>d.path===data)!;
  const request={datasetId:d.id,targetId:t.id,repeat:1,concurrency:2,evidence:'synthetic-local-demo' as const};
  ids.push(store.enqueue(request).id);ids.push(store.enqueue(request).id);assert.equal(store.detail(ids[1]).run.adapter,'f5-scan');assert.equal(store.detail(ids[1]).run.evidence,'synthetic-local-demo');store.cancel(ids[1]);
  const deadline=Date.now()+10000;while(mock.requests.length===0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));store.cancel(ids[0]);
  while(ids.some(id=>['preparing','running','scoring','queued'].includes(store.detail(id).run.status))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
  assert.ok(ids.every(id=>store.detail(id).run.status==='cancelled'));assert.ok(mock.requests.length<12);assert.ok(existsSync(join(store.directory(ids[0]),'report.json')));assert.ok(store.detail(ids[0]).report!.summary.coverage<1);
 }finally{await app.close();await mock.close();for(const id of ids){rmSync(store.directory(id),{recursive:true,force:true});rmSync(join(root,'data/jobs',id+'.json'),{force:true});}rmSync(data,{recursive:true,force:true});rmSync(source,{force:true});rmSync(join(root,'data/targets',name+'.json'),{force:true});}
});
