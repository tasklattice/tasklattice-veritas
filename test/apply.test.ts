import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildServer} from '../src/server/main.js';
import {datasets,saveTarget} from '../src/server/store.js';
import {prepareEvaluationDataset} from '../src/server/prepare-evaluation.js';
import {sourcePath} from '../src/core/raw.js';
import {root,json} from '../src/core/files.js';
import {startMock} from '../scripts/mock-endpoint.js';

test('Apply validates Dataset scope and counts before reading source files',async()=>{
 const base={datasetId:'wildjailbreak',endpointId:'test',repeat:1,concurrency:2};
 await assert.rejects(prepareEvaluationDataset({...base,config:'unknown'}),/No matching/);
 await assert.rejects(prepareEvaluationDataset({...base,limit:0}),/positive integer/);
 await assert.rejects(prepareEvaluationDataset({...base,phase:'bad' as any}),/direction/);
});

test('Apply converts pinned WildJailbreak directly, executes checks and filters failures before pagination',
 {skip:!existsSync(sourcePath('wildjailbreak','eval/eval.tsv'))},async()=>{
 const name='apply-test-'+randomUUID().slice(0,8),mock=await startMock(),{app,store}=await buildServer({ui:false}),headers={host:'localhost:38100'};let id='',selectionPath='';
 try{
  const endpoint=saveTarget({name,target:{adapter:'f5-scan',url:mock.f5Url}});
  const created=await app.inject({method:'POST',url:'/api/runs',headers,payload:{datasetId:'wildjailbreak',endpointId:endpoint.id,limit:4,repeat:2,concurrency:2,evidence:'synthetic-local-demo'}});
  assert.equal(created.statusCode,202,created.body);id=created.json().id;
  const deadline=Date.now()+20000;while(Date.now()<deadline&&['preparing','running','scoring','queued'].includes(store.detail(id).run.status))await new Promise(r=>setTimeout(r,30));
  const detail=store.detail(id);assert.equal(detail.run.status,'completed');assert.equal(detail.run.datasetId,'wildjailbreak');assert.equal(detail.run.endpointId,endpoint.id);
  assert.equal(detail.report!.summary.completed,8);assert.equal(mock.requests.length,8);
  selectionPath=datasets().find(d=>d.id===detail.run.selectionId)!.path;
  const snapshot=json(join(store.directory(id),'snapshot.json'));assert.ok(snapshot.manifest.revision);assert.equal(snapshot.manifest.source,'https://huggingface.co/datasets/allenai/wildjailbreak');assert.equal(snapshot.cases.length,4);
  const filtered=await app.inject({url:'/api/runs/'+id+'/attempts?filter=unexpected&limit=1',headers});assert.equal(filtered.statusCode,200);assert.equal(filtered.json().total,detail.report!.summary.failed);assert.equal(filtered.json().allTotal,8);assert.equal(filtered.json().items.length,Math.min(1,detail.report!.summary.failed));assert.ok(filtered.json().items.every((a:any)=>a.grade.pass===false));
  assert.equal((await app.inject({url:'/api/runs/'+id+'/attempts?filter=error',headers})).json().total,0);
  assert.equal((await app.inject({url:'/api/runs/'+id+'/attempts?filter=unknown',headers})).statusCode,400);
  const csv=await app.inject({url:'/api/runs/'+id+'/files/results.csv',headers});assert.match(csv.headers['content-type']!,/text\/csv/);assert.equal(csv.body.trim().split('\n').length,9);
 }finally{
  await app.close();await mock.close();if(id){rmSync(store.directory(id),{recursive:true,force:true});rmSync(join(root,'data/jobs',id+'.json'),{force:true});}
  if(selectionPath)rmSync(selectionPath,{recursive:true,force:true});rmSync(join(root,'data/targets',name+'.json'),{force:true});
 }
});
