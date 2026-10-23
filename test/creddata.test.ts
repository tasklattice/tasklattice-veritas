import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {credDataRecords, credentialTypes, normalizeCredData, parseCredAnnotations, type CredAnnotation} from '../src/core/creddata.js';
import {importDataset} from '../src/core/datasets.js';
import {lines} from '../src/core/files.js';
import {buildRowIndex, readRowPage, readRow} from '../src/server/dataset-viewer.js';
import {datasetCategory} from '../web/dataset-filters.js';
import {resolveDatasetSelections} from '../src/server/prepare-evaluation.js';
import {benchmarkScope} from '../src/shared/benchmark.js';
import type {Case} from '../src/shared/types.js';

const file='data/abcdef01/src/1234abcd.txt';
const a=(id:number,start:number,end=start,patch:Partial<CredAnnotation>={}):CredAnnotation=>({Id:String(id),FileID:'1234abcd',RepoName:'abcdef01',FilePath:file,LineStart:start,LineEnd:end,ValueStart:-1,ValueEnd:-1,GroundTruth:'T',Category:'Password',CryptographyKey:'',PredefinedPattern:'',...patch});

test('CredData merges overlapping annotations and preserves multiline text without adding neighboring secrets',()=>{
  // Construct a deliberately invalid fixture; keep literal key headers out of
  // source so the publication check still catches accidentally added keys.
  const keyHeader=['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const fakeKey=keyHeader+'\nfixture-not-a-real-key\n-----END PRIVATE KEY-----';
  const text='password = "fixture-only"\r\npassword = env.PASS\r\n'+fakeKey.replaceAll('\n','\r\n')+'\r\nunknown-value\r\nuuid-value';
  const annotations=[a(1,1,1,{GroundTruth:'F'}),a(2,1),a(3,2,2,{GroundTruth:'F'}),a(4,3,5,{Category:'PEM Private Key'}),a(5,4,4,{GroundTruth:'F'}),a(6,6,6,{GroundTruth:'X'}),a(7,7,7,{Category:'UUID'})];
  const records=credDataRecords(text,annotations,file);
  assert.deepEqual(records.map(r=>r.expected),['block','allow','block',null,null]);
  assert.equal(records[0].annotations.length,2);
  assert.equal(records[1].text,'password = env.PASS');
  assert.equal(records[2].text,fakeKey);
  assert.equal(records[2].annotations.length,2);
  assert.equal(records[3].reviewReason,'upstream-unknown');
  assert.equal(records[4].reviewReason,'positive-outside-credential-scope');
  assert.deepEqual(credDataRecords(text,[...annotations].reverse(),file),records);
});

test('CredData scopes credential families and validates labels, paths and Unicode offsets',()=>{
  assert.deepEqual(credentialTypes('Nonce:Salt:UUID:AWS S3 Bucket:Firebase Domain'),[]);
  assert.deepEqual(credentialTypes('PEM Private Key:Key:Secret'),['api-key','private-key']);
  assert.deepEqual(credentialTypes('Bearer Authorization:Password:API'),['api-key','password','token']);
  assert.deepEqual(credentialTypes('URL Credentials'),['password']);
  const header='Id,FileID,Domain,RepoName,FilePath,LineStart,LineEnd,GroundTruth,ValueStart,ValueEnd,CryptographyKey,PredefinedPattern,Category\n';
  const csv='1,1234abcd,GitHub,abcdef01,'+file+',1,1,T,2,3,,,Password\n';
  const rows=parseCredAnnotations(header+csv);
  assert.equal(credDataRecords('😀=x',rows,file).length,1); // Upstream columns are Python code points, not UTF-16.
  assert.throws(()=>parseCredAnnotations(header+csv.replace(',T,',',typo,')),/Invalid/);
  assert.throws(()=>parseCredAnnotations(header+csv.replace(file,'data/abcdef01/../../secret')),/path/);
  assert.throws(()=>credDataRecords('short',[a(1,2)],file),/outside/);
  const invalid=credDataRecords('short',[a(1,1,1,{ValueStart:2,ValueEnd:50})],file)[0];
  assert.equal(invalid.expected,null);assert.equal(invalid.reviewReason,'invalid-source-value-span');
  assert.deepEqual(invalid.invalidAnnotations,['1']);
  assert.equal(normalizeCredData(invalid,{phase:'input',config:'credentials',split:'needs-review'})[0].expected,null);
  assert.equal(credDataRecords('short',[a(1,1,1,{ValueStart:2,ValueEnd:-1})],file)[0].expected,'block');
});

test('CredData imports input and standalone output with explicit provenance and rejects relabeling',async()=>{
  const record=credDataRecords('password = "fixture-only"',[a(1,1)],file)[0];
  const options={phase:'both' as const,config:'credentials',split:'reviewed'};
  const cases=normalizeCredData(record,options);
  assert.deepEqual(cases.map(c=>c.phase),['input','output']);
  assert.notEqual(cases[0].id,cases[1].id);assert.equal(cases[0].text,record.text);assert.equal(cases[1].prompt,undefined);
  assert.equal(cases[0].metadata?.annotations[0].Id,'1');
  assert.throws(()=>normalizeCredData({...record,expected:'allow'},options),/contradicts/);
  assert.throws(()=>normalizeCredData({...record,converter:'unknown'},options),/reconstructed/);
  const dir=mkdtempSync(join(tmpdir(),'veritas-creddata-'));
  try {
    const source=join(dir,'reviewed.jsonl');writeFileSync(source,JSON.stringify(record)+'\n');
    await importDataset({dataset:'creddata',file:source,out:join(dir,'cases'),...options,limit:0});
    assert.deepEqual(lines<Case>(join(dir,'cases/cases.jsonl')),cases);
    const db=join(dir,'viewer.sqlite');await buildRowIndex(db,[source]);
    assert.equal(readRowPage(db,{column:'expected',value:'"block"'}).total,1);
    assert.equal(readRow(db,'0').data.text,record.text);
    assert.equal(datasetCategory('creddata'),'pii');
    const selected=resolveDatasetSelections({datasets:[{datasetId:'creddata'}],repeat:1,concurrency:2});
    assert.equal(selected[0].specs.length,1);assert.equal(selected[0].specs[0].split,'reviewed');
    assert.throws(()=>resolveDatasetSelections({datasets:[{datasetId:'creddata'}],repeat:1,concurrency:2,testPurpose:'jailbreak-detection'}),/no supported jailbreak/);
    assert.match(benchmarkScope({cases}).warnings[0],/credential detection/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
