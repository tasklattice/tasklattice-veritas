import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildServer} from '../src/server/main.js';
import {root} from '../src/core/files.js';
import {reportExecutionStatus,reportThresholdPolicy,thresholdValue} from '../web/report-model.js';
import {gateReport} from '../src/core/gates.js';

test('Execution completion is independent of scoring thresholds and decision mismatches',()=>{
  const run={status:'completed' as const,summary:{accuracy:.71875,coverage:1},gate:{pass:false,failures:[{metric:'minAccuracy',threshold:1,actual:.71875}]}};
  assert.equal(reportExecutionStatus(run).label,'Completed');
  assert.equal(reportExecutionStatus({...run,status:'failed'}).label,'Execution failed');
  assert.equal(reportExecutionStatus({...run,status:'interrupted'}).label,'Interrupted');
  assert.equal(reportExecutionStatus({...run,status:'cancelled'}).label,'Cancelled');
  assert.equal(reportExecutionStatus({...run,status:'scoring'}).label,'Scoring');
});

test('Built-in thresholds preserve the original gate verdict and explain the failing metric',()=>{
  const summary={accuracy:.71875,coverage:1,latencyMs:{p95:1720}},gate=gateReport({summary});
  assert.deepEqual(gate,{pass:false,failures:[{metric:'minAccuracy',threshold:1,actual:.71875}]});
  const policy=reportThresholdPolicy({summary,gate},{gate:{}});
  assert.equal(policy.source,'Veritas defaults');
  assert.deepEqual(policy.rows.map(r=>[r.key,r.threshold,r.actual,r.origin,r.result]),[
    ['minCoverage',1,1,'Veritas default','Met'],['minAccuracy',1,.71875,'Veritas default','Not met'],
  ]);
});

test('Saved custom thresholds identify overrides, keep defaults and use the saved baseline comparison',()=>{
  const summary={accuracy:.9,coverage:1,latencyMs:{p95:650}},configured={minAccuracy:.8,maxP95Ms:500,maxAccuracyDrop:.05},comparison={accuracyDrop:.02};
  const gate=gateReport({summary},configured,comparison),policy=reportThresholdPolicy({summary,gate},{gate:configured,comparison});
  assert.equal(policy.source,'Saved test configuration');
  assert.equal(policy.rows.find(r=>r.key==='minCoverage')!.origin,'Veritas default');
  assert.equal(policy.rows.find(r=>r.key==='minAccuracy')!.origin,'Saved test');
  assert.equal(policy.rows.find(r=>r.key==='minAccuracy')!.result,'Met');
  assert.equal(policy.rows.find(r=>r.key==='maxP95Ms')!.result,'Not met');
  assert.equal(policy.rows.find(r=>r.key==='maxAccuracyDrop')!.actual,.02);
  assert.equal(thresholdValue('maxAccuracyDrop',.02),'2.0 pp');
  assert.equal(thresholdValue('maxP95Ms',650),'650 ms');
});

test('Offline scoring uses its own default policy instead of inheriting original custom or baseline thresholds',()=>{
  const summary={accuracy:.9,coverage:1,latencyMs:{p95:1}},gate=gateReport({summary});
  const policy=reportThresholdPolicy({summary,gate},{gate:{minAccuracy:.5,maxP95Ms:10,maxAccuracyDrop:.1},comparison:{accuracyDrop:0}},true);
  assert.equal(policy.source,'Veritas defaults · offline scoring');
  assert.deepEqual(policy.rows.map(r=>r.key),['minCoverage','minAccuracy']);
  assert.equal(policy.rows.find(r=>r.key==='minAccuracy')!.result,'Not met');
});

test('Historical reports never invent a default policy or an author when original thresholds were not saved',()=>{
  const policy=reportThresholdPolicy({summary:{accuracy:.7},gate:{pass:false,failures:[{metric:'minAccuracy',threshold:.8,actual:.7}]}},{});
  assert.equal(policy.known,false);
  assert.equal(policy.source,'Historical policy not recorded');
  assert.deepEqual(policy.rows.map(r=>[r.key,r.threshold,r.origin]),[['minAccuracy',.8,'Saved verdict']]);
  assert.deepEqual(reportThresholdPolicy({},null).rows,[]);
  assert.ok(reportThresholdPolicy({},{gate:{}}).rows.every(r=>r.result==='Unavailable'));
});

test('Assessment metadata retains unavailable measurements and grade-integrity failures',()=>{
  const summary={accuracy:null,coverage:1,latencyMs:{p95:null}},gate=gateReport({summary});
  gate.failures.push({metric:'engineConsistency',reason:'Missing recorded grades'});gate.pass=false;
  const policy=reportThresholdPolicy({summary,gate},{gate:{}});
  assert.equal(policy.rows.find(r=>r.key==='minAccuracy')!.actual,null);
  assert.equal(policy.rows.find(r=>r.key==='minAccuracy')!.result,'Not met');
  assert.equal(policy.otherFailures[0].reason,'Missing recorded grades');
  assert.equal(thresholdValue('minAccuracy',null),'Unavailable');
});

test('Report API exposes the frozen policy and saved baseline measurements without altering its verdict',async()=>{
  const name='threshold-metadata-test-'+randomUUID(),id=Buffer.from(name).toString('base64url'),dir=join(root,'runs',name),{app}=await buildServer({ui:false});
  const configured={minAccuracy:.8,maxAccuracyDrop:.05},comparison={accuracyDrop:.02},gate={pass:true,failures:[]};
  try{
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'snapshot.json'),JSON.stringify({schemaVersion:3,createdAt:new Date().toISOString(),gate:configured,target:{adapter:'f5-scan',url:'http://127.0.0.1:1/unused'},cases:[],repeat:1,concurrency:1}));
    writeFileSync(join(dir,'comparison.json'),JSON.stringify(comparison));
    writeFileSync(join(dir,'gate.json'),JSON.stringify(gate));
    const response=await app.inject({url:'/api/runs/'+id+'?scoring=original',headers:{host:'localhost:38100'}});
    assert.equal(response.statusCode,200,response.body);
    assert.deepEqual(response.json().configuration.gate,configured);
    assert.deepEqual(response.json().configuration.comparison,comparison);
    assert.deepEqual(response.json().run.gate,gate);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
