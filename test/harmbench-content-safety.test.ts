import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize} from '../src/core/datasets.js';
import {benchmarkScope} from '../src/shared/benchmark.js';
const opts={phase:'input' as const,config:'default',split:'test'};
test('HarmBench retains behavior identity and categories without converting context into an attack',()=>{
 const row={BehaviorID:'fixture-id',Behavior:'Synthetic requested behavior',FunctionalCategory:'standard',SemanticCategory:'cybercrime_intrusion',ContextString:''};
 const [c]=normalize('harmbench',row,opts);
 assert.equal(c.text,row.Behavior);assert.equal(c.expected,'block');assert.equal(c.metadata?.sourceId,row.BehaviorID);
 assert.equal(c.metadata?.semanticCategory,row.SemanticCategory);assert.equal(c.metadata?.functionalCategory,'standard');
 for(const category of ['contextual','copyright','multimodal'])assert.equal(normalize('harmbench',{...row,FunctionalCategory:category},opts)[0].expected,null);
 const scope=benchmarkScope({cases:[c],testPurpose:'endpoint-decisions'});
 assert.equal(scope.counts['behavior-goal'],1);assert.ok(scope.warnings.some(w=>w.includes('No allow controls')));
});
