import test from 'node:test';
import assert from 'node:assert/strict';
import {reportSource,reportSampling} from '../web/report-metadata-model.js';
import {reportLabel} from '../web/report-model.js';

test('Dataset snapshots use frozen revision, scope and selected cases without consulting the current catalog',()=>{
  const original={dataset:'aegis',source:'https://example.com/datasets/aegis',revision:'saved-revision',license:'cc-by-4.0',config:'default',split:'test',phase:'input',files:[{file:'test.json',sha256:'saved-hash'}],selection:{method:'random',seed:7,caseIds:['case-1','case-2']}};
  const before=JSON.stringify(original),source=reportSource(original);
  assert.equal(source.scope,'default / test');assert.equal(source.revision,'saved-revision');assert.equal(source.license,'cc-by-4.0');assert.equal(source.cases,2);
  assert.equal(source.url,'https://example.com/datasets/aegis');assert.equal(source.files[0].sha256,'saved-hash');
  assert.equal(source.raw,original);assert.equal(JSON.stringify(original),before);
});

test('Combined historical reports unwrap nested manifests and retain the later selected sample count',()=>{
  const manifest={dataset:'aegis',source:'https://example.com/aegis',revision:'frozen-upstream',license:'cc-by-4.0',config:'default',split:'test',selection:{method:'random',caseIds:['a','b','c']},files:[{file:'test.json'}]};
  const source=reportSource({dataset:'aegis',historicalRunId:'parent',manifest,sampling:{count:2,seed:42,method:'equal allocation per observed label, random within label'}});
  assert.equal(source.manifest,manifest);assert.equal(source.revision,'frozen-upstream');assert.equal(source.cases,2);assert.equal(source.scope,'default / test');assert.equal(source.url,'https://example.com/aegis');
  assert.equal(reportSampling({},[source]),'Per Dataset');
  assert.equal(reportSampling({selection:{method:'stratified',seed:99}},[source]),'Stratified · seed 99');
});

test('Missing provenance remains explicitly unavailable instead of inventing local imports or source-order sampling',()=>{
  const source=reportSource({dataset:'historical'});
  assert.equal(source.revision,null);assert.equal(source.license,null);assert.equal(source.scope,'Not recorded');assert.equal(source.cases,null);assert.equal(source.url,undefined);
  assert.deepEqual(source.files,[]);assert.equal(reportSampling({},[source]),'Not recorded');
  assert.equal(reportSampling({selection:{}},[source]),'Not recorded');
  assert.equal(reportSampling({},[reportSource({selection:{}})]),'Not recorded');
});

test('Upstream links admit web sources while rejecting executable or credential-bearing URLs',()=>{
  for(const source of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','https://user:secret@example.com/data'])assert.equal(reportSource({source}).url,undefined);
  assert.equal(reportSource({source:'http://localhost:38100/data'}).url,'http://localhost:38100/data');
});

test('Report identity uses stable short IDs while retaining custom run names',()=>{
  assert.equal(reportLabel({name:'run-2026-10-28T14-26-24.718Z-8f66c7'}),'Run 8F66C7');
  assert.equal(reportLabel({name:'custom-regression'}),'custom-regression');
});
