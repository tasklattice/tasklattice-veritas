/** Prepare the pinned MPBench instruction-detection cohort; never sends Target traffic. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {importDataset} from '../src/core/datasets.js';
import {sampleCases} from '../src/core/sampling.js';
import {hash} from '../src/core/files.js';
import type {Case, JsonObject} from '../src/shared/types.js';

const {values}=parseArgs({options:{'source-dir':{type:'string'},out:{type:'string'},seed:{type:'string',default:'42'},'per-family':{type:'string',default:'20'}}});
if(!values['source-dir']||!values.out) throw Error('Usage: node --import tsx scripts/prepare-mpbench.ts --source-dir DIR --out DIR [--seed 42] [--per-family 20]');
const seed=Number(values.seed), perFamily=Number(values['per-family']);
assert.ok(Number.isSafeInteger(seed)&&seed>=0&&seed<=4294967295,'Invalid seed');
assert.ok(Number.isSafeInteger(perFamily)&&perFamily>0&&perFamily<=600,'per-family must be 1..600');
const revision='6886880a7c29625e0109e0ad91d0e095029f1577';
const checksums:Record<string,string>={adversarial:'f2d23a5a2d483889eb2fdd9a2a082f0759603bc0a17664814a7caafbd318f90d',benign:'707ef7e311e147d9818a8a9e04293296fc6bf3390241e4cac23c8145765b62d5'};
const aliases:Record<string,string>={explicit_keyword_injection:'explicit',explicit_keyword:'explicit',delayed_conditional_injection_injection:'conditional',delayed_conditional_injection:'conditional',repetition_injection:'repetition',repetition_based_injection:'repetition',repetition:'repetition'};

// One pinned upstream physical line contains two adjacent JSON objects. Parse
// complete objects losslessly; braces inside strings do not delimit records.
function objects(raw:string):JsonObject[]{
 const rows:JsonObject[]=[];let depth=0,start=-1,quoted=false,escaped=false;
 for(let i=0;i<raw.length;i++){
  const c=raw[i];
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){assert.ok(depth>0);quoted=true;}
  else if(c==='{'){if(depth===0)start=i;depth++;}
  else if(c==='}'){assert.ok(depth>0);if(--depth===0)rows.push(JSON.parse(raw.slice(start,i+1)));}
  else if(depth===0)assert.ok(/\s/.test(c),'Unexpected content between JSON objects');
 }
 assert.equal(depth,0);assert.equal(quoted,false);return rows;
}
const sources:JsonObject[]=[],pools:Record<string,Case[]>={};
for(const split of ['adversarial','benign']){
 const file=split+'_data.jsonl.jsonl',raw=readFileSync(join(resolve(values['source-dir']),file));
 const sha256=hash(raw);assert.equal(sha256,checksums[split],'Unexpected source revision: '+file);
 const rows=objects(raw.toString('utf8'));assert.equal(rows.length,split==='adversarial'?3241:2999);
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,'Duplicate IDs within a source');
 sources.push({file,sha256,rows:rows.length,revision});
 pools[split]=rows.filter(r=>split==='benign'||aliases[r.attack_type]).map(r=>({
  id:'mpbench:'+r.id,dataset:'mpbench',phase:'input',config:'external-context',split,text:r.context,
  expected:split==='adversarial'?'block':'allow',guardContext:{targetSource:'retrieved_content',query:r.user_query},
  metadata:{sourceId:r.id,labelSource:'source-split-instruction-policy',attackFamily:split==='benign'?'benign':aliases[r.attack_type],attackType:r.attack_type,signal:r.attack_signal,domain:r.domain,sourceRevision:revision,sourceFile:file,sourceSha256:sha256},
 }));
}
const selected:Case[]=[],groups:JsonObject[]=[];
for(const family of ['explicit','conditional','repetition']){
 const sample=sampleCases(pools.adversarial.filter(c=>c.metadata?.attackFamily===family),perFamily,{method:'random',seed});
 selected.push(...sample.cases);groups.push({family,...sample.selection});
}
const unique=[...new Map([...pools.benign].sort((a,b)=>b.id.localeCompare(a.id)).map(c=>[hash(c.text),c])).values()];
const controls=sampleCases(unique,perFamily*3,{method:'random',seed});
selected.push(...controls.cases);groups.push({family:'benign',duplicatesExcluded:pools.benign.length-unique.length,...controls.selection});
// Rank within each split using original source IDs; scope the final identities
// by split because the upstream benign file reuses some adversarial IDs.
const cases=sampleCases(selected,undefined,{method:'random',seed}).cases.map(c=>({...c,id:'mpbench:'+c.split+':'+c.metadata!.sourceId}));
assert.equal(cases.length,perFamily*6);assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);assert.equal(new Set(cases.map(c=>c.text)).size,cases.length);
const out=resolve(values.out),file=out+'.input.jsonl';
writeFileSync(file,cases.map(c=>JSON.stringify(c)).join('\n')+'\n',{mode:0o600,flag:'wx'});
await importDataset({dataset:'veritas',file,out,limit:0,phase:'input',config:'external-context',split:'adversarial+benign'});
const imported=readFileSync(join(out,'cases.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
assert.deepEqual(imported,cases,'Import must preserve every selected case');
const manifest=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));
assert.equal(manifest.counts.cases,cases.length);assert.ok(!manifest.counts.duplicateCases);
Object.assign(manifest,{dataset:'mpbench',source:'https://github.com/Digital-Trust-Lab/mp-bench',revision,license:'Apache-2.0',upstreamFiles:sources,
 selection:{method:'preselected',algorithm:'case-sampling-v1 per source/family',seed,groups,caseIds:cases.map(c=>c.id)},
 notes:['External instruction detection only; no memory write, persistence, retrieval or agent attack-success evaluation.',
 'Fact injection and experience injection excluded before inference; they require provenance or agent-outcome evaluation.',
 'Model input contains original context and user query only; expected_memory, attacker goal and expected action are never sent.',
 'Balanced instruction attacks and unique-context benign controls; historical F5/Nemo spreadsheet metrics are not directly comparable.',
 'Cross-file source IDs are namespaced by split; import counts and case identities are verified.']});
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({directory:out,cases:cases.length,seed,attackCases:perFamily*3,benignCases:perFamily*3,caseHash:hash(cases)}));
