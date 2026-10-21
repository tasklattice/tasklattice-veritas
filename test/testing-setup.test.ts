import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root} from '../src/core/files.js';
import {buildDatasetCards} from '../src/server/dataset-cards.js';
import type {TargetItem} from '../src/shared/types.js';
import {buildTestingRequest,defaultDatasetOptions,initialTestingDraft,testingCheckLimit,testingSelections,testingTarget} from '../web/testing-model.js';
const catalog=JSON.parse(readFileSync(join(root,'catalog/datasets.json'),'utf8')).datasets;
const cards=buildDatasetCards(catalog,[]).map(c=>({...c,rawAvailable:true}));
const targets:TargetItem[]=[{id:'f5',name:'F5',credentialAvailable:true,target:{adapter:'f5-scan',url:'http://127.0.0.1:1/unused',outputMode:'standalone'}},{id:'lite',name:'LiteLLM',credentialAvailable:true,target:{adapter:'litellm-generic-guardrail',url:'http://127.0.0.1:1/unused',outputMode:'paired'}}];

test('Testing draft preserves per-Dataset scopes and directions while sharing one Target, limit, repeats and concurrency',()=>{
  const draft={...initialTestingDraft({targetId:'f5'}),datasetIds:['wildjailbreak','aegis'],scope:'limited' as const,limit:'3',repeat:'4',concurrency:'2',options:{wildjailbreak:{...defaultDatasetOptions(),sourceSpec:'0',phase:'input' as const},aegis:{...defaultDatasetOptions(),phase:'output' as const}}};
  const before=JSON.stringify(draft),request=buildTestingRequest(draft,cards,targets,catalog);
  assert.deepEqual(request.datasets,[{datasetId:'wildjailbreak',config:'eval',split:'train',phase:'input'},{datasetId:'aegis',phase:'output'}]);
  assert.equal(request.targetId,'f5');assert.equal(request.limitPerDataset,3);assert.equal(request.repeat,4);assert.equal(request.concurrency,2);assert.equal(request.limit,undefined);assert.equal(request.datasetId,undefined);assert.equal(request.phase,undefined);
  assert.equal(testingCheckLimit(draft),24);assert.equal(testingCheckLimit({...draft,concurrency:'100',skipUnlabeled:true}),24);assert.equal(JSON.stringify(draft),before);
  assert.deepEqual(buildTestingRequest({...draft,datasetIds:['aegis'],targetId:'lite'},cards,targets,catalog).datasets,[{datasetId:'aegis',phase:'output'}]);
  assert.equal(testingTarget({...draft,targetId:'lite'},targets).target.outputMode,'paired');
});

test('Full-scope Testing does not send a stale cap or invent a case count, and preserves the Aegis default direction',()=>{
  const draft={...initialTestingDraft({datasetId:'aegis',targetId:'lite'}),limit:'0'};
  const request=buildTestingRequest(draft,cards,targets,catalog);assert.equal(request.limitPerDataset,undefined);assert.equal(testingCheckLimit(draft),null);assert.deepEqual(request.datasets,[{datasetId:'aegis'}]);
  assert.equal(request.repeat,1);assert.equal(request.concurrency,2);assert.equal(request.evidence,'endpoint');assert.equal(request.skipUnlabeled,false);
  assert.deepEqual(initialTestingDraft({targetId:'f5'}).datasetIds,[]);assert.equal(initialTestingDraft({datasetId:'wildjailbreak'}).targetId,'');
});

test('Testing prerequisites reject invalid settings, missing or deleted resources and unavailable credentials before submission',()=>{
  const draft={...initialTestingDraft({targetId:'f5'}),datasetIds:['wildjailbreak'],scope:'limited' as const};
  for(const patch of [{datasetIds:[]},{datasetIds:['wildjailbreak','wildjailbreak']},{datasetIds:['missing']},{targetId:''},{repeat:'0'},{repeat:'101'},{concurrency:'1.5'},{concurrency:'101'},{limit:''},{limit:'0'},{limit:'-1'},{limit:'9007199254740992'},{options:{wildjailbreak:{...defaultDatasetOptions(),sourceSpec:'99'}}}])assert.throws(()=>buildTestingRequest({...draft,...patch},cards,targets,catalog));
  assert.throws(()=>buildTestingRequest(draft,cards.map(c=>({...c,rawAvailable:false})),targets,catalog),/archive/);
  assert.throws(()=>buildTestingRequest(draft,cards,targets,[]),/configuration/);
  assert.throws(()=>buildTestingRequest(draft,cards,[],catalog),/Choose a Target/);
  assert.throws(()=>buildTestingRequest(draft,cards,targets.map(t=>({...t,credentialAvailable:false,target:{...t.target,apiKeyEnv:'VERITAS_TEST_KEY'}})),catalog),/VERITAS_TEST_KEY/);
  assert.equal(testingCheckLimit({...draft,repeat:'0'}),null);
  const topic={...draft,datasetIds:['topic-control']};assert.throws(()=>testingSelections(topic,cards,catalog),/policy domain/);
  assert.equal(testingSelections({...topic,options:{'topic-control':{...defaultDatasetOptions(),domain:' banking '}}},cards,catalog)[0].domain,'banking');
});
