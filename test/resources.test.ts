import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildServer} from '../src/server/main.js';
import {buildRowIndex,readRowPage,readRow} from '../src/server/dataset-viewer.js';
import {importDataset} from '../src/core/datasets.js';
import {sourcePath} from '../src/core/raw.js';
import {root,json,hash} from '../src/core/files.js';
import {datasets,getTarget,deleteTarget} from '../src/server/store.js';
import {startMock} from '../scripts/mock-endpoint.js';
const headers={host:'localhost:38100'};

test('Source row index pages/searches original records, preserves full values and nested UTF-8, and validates bounds',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'veritas-viewer-')),file=join(dir,'rows.jsonl'),db=join(dir,'index.sqlite');
 try{
  const rows=Array.from({length:57},(_,i)=>({id:i,text:i===25?'测试中文 '.repeat(200):'Example '+i,label:i%2?'unsafe':'safe',nested:{special:'50%_literal',values:[i]}}));
  writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');await buildRowIndex(db,[file]);
  const first=readRowPage(db);assert.equal(first.items.length,25);assert.equal(first.total,57);assert.equal(first.items[0].index,0);assert.equal(first.items.at(-1)!.index,24);
  const second=readRowPage(db,{offset:'25',limit:'25'});assert.equal(second.items[0].index,25);assert.equal(second.items.at(-1)!.index,49);assert.deepEqual(second.items[0].truncatedFields,['text']);assert.ok(second.items[0].values.text.length<410);
  assert.deepEqual(readRow(db,'25').data,rows[25]);assert.equal(readRowPage(db,{offset:'50',limit:'25'}).items.length,7);
  const found=readRowPage(db,{search:'UNSAFE',offset:'2',limit:'3'});assert.equal(found.total,28);assert.equal(found.allTotal,57);assert.deepEqual(found.items.map(i=>i.index),[5,7,9]);
  assert.equal(readRowPage(db,{search:'50%_literal'}).total,57);assert.equal(readRowPage(db,{search:"' OR 1=1 --"}).total,0);assert.equal(readRowPage(db,{search:'测试中文'}).total,1);
  assert.throws(()=>readRow(db,'57'),/not found/);
  for(const query of [{offset:'-1'},{offset:'1.2'},{limit:'101'},{limit:'0'},{limit:'NaN'},{search:'a'.repeat(201)}])assert.throws(()=>readRowPage(db,query));
  assert.equal(statSync(db).mode&0o777,0o600);
  writeFileSync(join(dir,'nested.json'),JSON.stringify({Insult:[{prompt:'中文',label:null}],Other:[{prompt:'Other'}]}));await buildRowIndex(join(dir,'nested.sqlite'),[join(dir,'nested.json')],'Insult');assert.equal(readRowPage(join(dir,'nested.sqlite')).total,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Target and Report deletion removes files permanently while preserving queued snapshots and assigning fresh recreated IDs',async()=>{
 const name='crud-test-'+randomUUID().slice(0,8),source=join(root,'data',name+'.jsonl'),data=join(root,'data',name),mockA=await startMock(),mockB=await startMock(),{app,store}=await buildServer({ui:false});
 const ids:string[]=[],paths=new Map<string,string>(),targetIds:string[]=[];
 const active=()=>store.list().filter(r=>ids.includes(r.id)&&['running','queued'].includes(r.status));
 try{
  mkdirSync(join(root,'data'),{recursive:true});writeFileSync(source,Array.from({length:6},(_,i)=>JSON.stringify({id:String(i),dataset:'crud-fixture',phase:'input',text:'[SLOW] Safe',expected:'allow'})).join('\n')+'\n');await importDataset({dataset:'veritas',file:source,out:data});const selection=datasets().find(d=>d.path===data)!;
  const created=await app.inject({method:'POST',url:'/api/targets',headers,payload:{name,target:{adapter:'f5-scan',url:mockA.f5Url,timeoutMs:1234}}});assert.equal(created.statusCode,200,created.body);
  const targetId=created.json().item.id,version=created.json().item.version;targetIds.push(targetId);
  assert.ok(version);for(const key of ['path','original','state','deletedAt'])assert.equal(created.json().item[key],undefined);
  assert.equal((await app.inject({method:'POST',url:'/api/targets',headers,payload:{name,target:{url:mockA.url}}})).statusCode,409);
  const request={datasetId:'crud-fixture',selectionId:selection.id,targetId,repeat:1,concurrency:1,evidence:'synthetic-local-demo'};
  for(let i=0;i<2;i++){const response=await app.inject({method:'POST',url:'/api/runs',headers,payload:request});assert.equal(response.statusCode,202,response.body);const id=response.json().id;ids.push(id);paths.set(id,store.directory(id));}
  assert.equal((await app.inject({method:'DELETE',url:'/api/runs/'+ids[1],headers})).statusCode,409);
  const updated=await app.inject({method:'PUT',url:'/api/targets/'+targetId,headers,payload:{name:name+'-renamed',version,target:{url:mockB.url,adapter:'litellm-generic-guardrail',outputMode:'standalone',timeoutMs:2345}}});assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().item.id,targetId);
  assert.equal((await app.inject({method:'PUT',url:'/api/targets/'+targetId,headers,payload:{name,version,target:{url:mockA.url}}})).statusCode,409);
  const reused=await app.inject({method:'POST',url:'/api/targets',headers,payload:{name,target:{adapter:'f5-scan',url:mockA.f5Url}}});assert.equal(reused.statusCode,200,reused.body);targetIds.push(reused.json().item.id);assert.notEqual(reused.json().item.id,targetId);deleteTarget(reused.json().item.id);
  const stored=getTarget(targetId),removed=await app.inject({method:'DELETE',url:'/api/targets/'+targetId,headers});assert.equal(removed.json().deleted,targetId);
  assert.equal(existsSync(stored.original),false);assert.equal(existsSync(stored.state),false);
  assert.equal((await app.inject({url:'/api/targets/'+targetId,headers})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/api/targets/'+targetId+'/restore',headers,payload:{}})).statusCode,404);
  assert.ok(!(await app.inject({url:'/api/targets?includeDeleted=true',headers})).json().items.some((t:any)=>t.id===targetId));
  assert.equal((await app.inject({method:'POST',url:'/api/runs',headers,payload:request})).statusCode,400);
  const deadline=Date.now()+20000;while(active().length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
  assert.equal(mockA.requests.length,12);assert.equal(mockB.requests.length,0);assert.equal(store.detail(ids[1]).run.status,'completed');
  const detail=(await app.inject({url:'/api/runs/'+ids[1],headers})).json();assert.equal(detail.configuration.target.url,mockA.f5Url);assert.equal(detail.configuration.concurrency,1);assert.equal(detail.run.targetName,name);assert.equal(detail.run.path,undefined);
  const attempts=(await app.inject({url:'/api/runs/'+ids[1]+'/attempts',headers})).json().items;
  const check=(await app.inject({url:'/api/runs/'+ids[1]+'/attempts/'+attempts[0].attemptId,headers})).json();assert.equal(check.sample.text,'[SLOW] Safe');assert.equal(check.attempt.grade.pass,true);
  const keptArtifact=join(paths.get(ids[0])!,'report.json'),digest=hash(readFileSync(keptArtifact));
  const deleted=await app.inject({method:'DELETE',url:'/api/runs/'+ids[1],headers});assert.equal(deleted.json().deleted,ids[1]);
  assert.equal(existsSync(paths.get(ids[1])!),false);for(const dir of ['jobs','job-targets','deleted-reports'])assert.equal(existsSync(join(root,'data',dir,ids[1]+'.json')),false);
  assert.ok(!(await app.inject({url:'/api/runs?includeDeleted=true',headers})).json().items.some((r:any)=>r.id===ids[1]));
  for(const suffix of ['', '/attempts','/files/results.csv'])assert.equal((await app.inject({url:'/api/runs/'+ids[1]+suffix,headers})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/api/runs/'+ids[1]+'/restore',headers,payload:{}})).statusCode,404);assert.equal(hash(readFileSync(keptArtifact)),digest);
  const recreated=await app.inject({method:'POST',url:'/api/targets',headers,payload:{name:name+'-renamed',target:{url:mockB.url,adapter:'litellm-generic-guardrail',outputMode:'standalone'}}});assert.equal(recreated.statusCode,200,recreated.body);
  const newId=recreated.json().item.id;targetIds.push(newId);assert.notEqual(newId,targetId);
  const latest=await app.inject({method:'POST',url:'/api/runs',headers,payload:{...request,targetId:newId}});assert.equal(latest.statusCode,202,latest.body);ids.push(latest.json().id);paths.set(ids[2],store.directory(ids[2]));
  while(active().length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));assert.equal(mockB.requests.length,6);assert.equal(store.detail(ids[2]).configuration!.target!.adapter,'litellm-generic-guardrail');
  const baselineTarget=await app.inject({method:'POST',url:'/api/targets',headers,payload:{name:name+'-baseline',target:{adapter:'f5-scan',url:mockA.f5Url}}});assert.equal(baselineTarget.statusCode,200,baselineTarget.body);targetIds.push(baselineTarget.json().item.id);
  const comparison=await app.inject({method:'POST',url:'/api/runs',headers,payload:{...request,targetId:baselineTarget.json().item.id,baselineId:ids[0],gate:{maxAccuracyDrop:0}}});assert.equal(comparison.statusCode,202,comparison.body);ids.push(comparison.json().id);paths.set(ids[3],store.directory(ids[3]));
  assert.equal((await app.inject({method:'DELETE',url:'/api/runs/'+ids[0],headers})).statusCode,409);
  while(active().length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));assert.equal(store.detail(ids[3]).run.status,'completed');assert.equal((await app.inject({method:'DELETE',url:'/api/runs/'+ids[0],headers})).statusCode,200);
  assert.equal((await app.inject({method:'DELETE',url:'/api/targets/not-found',headers})).statusCode,404);assert.equal((await app.inject({method:'DELETE',url:'/api/runs/not-found',headers})).statusCode,404);
 }finally{
  store.close();const deadline=Date.now()+5000;while(active().length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));await app.close();await mockA.close();await mockB.close();
  for(const id of ids){const path=paths.get(id);if(path)rmSync(path,{recursive:true,force:true});for(const dir of ['jobs','job-targets','deleted-reports'])rmSync(join(root,'data',dir,id+'.json'),{force:true});}
  for(const id of targetIds)try{deleteTarget(id);}catch{}
  rmSync(source,{force:true});rmSync(data,{recursive:true,force:true});
 }
});

test('Dataset viewer API reads the pinned original rows, supports splits/categories and rejects paths and invalid pagination', {skip:!existsSync(sourcePath('wildjailbreak','eval/eval.tsv'))},async()=>{
 const {app}=await buildServer({ui:false});
 try{
  const metadata=(await app.inject({url:'/api/datasets/wildjailbreak/viewer',headers})).json();assert.equal(metadata.scopes[0].config,'eval');assert.equal(metadata.scopes[0].split,'train');assert.ok(metadata.scopes[0].available);
  let response;const deadline=Date.now()+15000;
  do{response=await app.inject({url:'/api/datasets/wildjailbreak/rows?config=eval&split=train&offset=25&limit=25',headers});assert.ok([200,202].includes(response.statusCode),response.body);if(response.statusCode===202)await new Promise(r=>setTimeout(r,25));}while(response.statusCode===202&&Date.now()<deadline);
  const page=response.json();assert.equal(page.status,'ready');assert.equal(page.items.length,25);assert.equal(page.items[0].index,25);assert.ok(page.allTotal>50);assert.ok(page.columns.some((c:any)=>c.name==='adversarial'));
  const row=await app.inject({url:'/api/datasets/wildjailbreak/rows/25?config=eval&split=train',headers});assert.equal(row.statusCode,200);assert.equal(row.json().index,25);assert.equal(typeof row.json().data.adversarial,'string');
  for(const query of ['config=../../etc','split=unknown','offset=-1','limit=1000','field=absent','offset=NaN'])assert.equal((await app.inject({url:'/api/datasets/wildjailbreak/rows?'+query,headers})).statusCode,400);
  assert.equal((await app.inject({url:'/api/datasets/unknown/viewer',headers})).statusCode,404);
 }finally{await app.close();}
});

test('Historical Report details preserve their saved summary and identify unavailable per-check grading',async()=>{
 const name='historical-crud-'+randomUUID().slice(0,8),id=Buffer.from(name).toString('base64url'),dir=join(root,'runs',name),{app}=await buildServer({ui:false});
 try{
  mkdirSync(dir,{recursive:true});const sample={id:'legacy-case',dataset:'legacy-fixture',phase:'input',text:'Safe historical text',expected:'block'};
  writeFileSync(join(dir,'snapshot.json'),JSON.stringify({schemaVersion:2,createdAt:new Date().toISOString(),scorer:'historical-scorer',scorerHash:'original-implementation',target:{adapter:'f5-scan',url:'http://127.0.0.1:38101/legacy'},cases:[sample],repeat:1,concurrency:1}));
  writeFileSync(join(dir,'report.json'),JSON.stringify({schemaVersion:2,summary:{completed:1,passed:0,failed:1,accuracy:0},caveats:[]}));
  writeFileSync(join(dir,'attempts.jsonl'),JSON.stringify({attemptId:'legacy-attempt',caseId:sample.id,dataset:sample.dataset,phase:'input',status:'completed',action:'allow',steps:[]})+'\n');
  const detail=await app.inject({url:'/api/runs/'+id,headers});assert.equal(detail.statusCode,200);assert.equal(detail.json().configuration.gradesAvailable,false);assert.equal(detail.json().report.summary.failed,1);
  const evidence=(await app.inject({url:'/api/runs/'+id+'/attempts/legacy-attempt',headers})).json();assert.equal(evidence.sample.expected,'block');assert.equal(evidence.attempt.action,'allow');assert.equal(evidence.attempt.grade,undefined);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('Production assets added after server startup are served, and missing assets cannot become HTML',async()=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
 const dir=join(root,'dist/web'),assets=join(dir,'assets'),filename='crud-asset-'+randomUUID()+'.txt',path=join(assets,filename),hadDir=existsSync(dir),hadAssets=existsSync(assets),hadIndex=existsSync(join(dir,'index.html'));
 mkdirSync(assets,{recursive:true});if(!hadIndex)writeFileSync(join(dir,'index.html'),'<!doctype html><title>Veritas</title>');
 let app:Awaited<ReturnType<typeof buildServer>>['app']|undefined;
 try{
  app=(await buildServer()).app;await app.ready();writeFileSync(path,'newly-built-asset');
  const response=await app.inject({url:'/assets/'+filename,headers});assert.equal(response.statusCode,200);assert.equal(response.body,'newly-built-asset');
  assert.equal((await app.inject({url:'/assets/missing-'+filename,headers})).statusCode,404);assert.equal((await app.inject({url:'/api/unknown',headers})).statusCode,404);
  assert.equal((await app.inject({url:'/api/datasets',headers})).statusCode,200);
 }finally{await app?.close();if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;rmSync(path,{force:true});if(!hadIndex)rmSync(join(dir,'index.html'),{force:true});if(!hadAssets)rmSync(assets,{recursive:true,force:true});if(!hadDir)rmSync(dir,{recursive:true,force:true});}
});
