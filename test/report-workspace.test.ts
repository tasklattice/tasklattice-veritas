import test from 'node:test';
import assert from 'node:assert/strict';
import type {RunItem,TargetItem} from '../src/shared/types.js';
import {comparisonHref,comparisonCasesHref,legacyReportComparisonHref,parseComparisonIds,reportGroups,reportScopeKey,reportTargetKey,trendCohort,finiteMetric,finishedReports} from '../web/report-workspace-model.js';
import {reportDetailLocation} from '../web/report-model.js';

const run=(id:string,patch:Partial<RunItem>={}):RunItem=>({id,name:id,createdAt:'2026-10-28T12:00:00Z',status:'completed',datasetIds:['aegis','deepset'],evidence:'endpoint',targetId:'guard-a',targetName:'Guard',summary:{accuracy:.8},...patch});
const target=(id:string):TargetItem=>({id,name:'Guard',credentialAvailable:true,target:{adapter:'f5-scan',outputMode:'standalone',url:'http://127.0.0.1:1/unused'}});

test('Report relationships use stable Target IDs, preserve renamed history and keep same-name Targets separate',()=>{
  const saved=run('saved',{targetName:'Old name'}),other=run('other',{targetId:'guard-b'}),orphan=run('orphan',{targetId:undefined,targetName:undefined});
  const input=[saved,other,orphan],before=JSON.stringify(input),groups=reportGroups(input,[target('guard-a'),target('guard-b'),target('untested')]);
  assert.equal(groups.find(g=>g.key==='target:guard-a')!.name,'Guard');
  assert.deepEqual(groups.find(g=>g.key==='target:guard-a')!.runs.map(r=>r.id),['saved']);
  assert.deepEqual(groups.find(g=>g.key==='target:guard-b')!.runs.map(r=>r.id),['other']);
  assert.equal(groups.find(g=>g.key==='target:untested')!.runs.length,0);
  assert.notEqual(reportTargetKey(orphan),reportTargetKey(run('another',{targetId:undefined,targetName:undefined})));
  assert.equal(JSON.stringify(input),before);
});

test('History charts exclude different source combinations, synthetic evidence and unfinished summaries',()=>{
  const old=run('old',{createdAt:'2026-10-27T12:00:00Z'}),latest=run('latest',{createdAt:'2026-10-28T13:00:00Z',datasetIds:['deepset','aegis']}),extra=run('different',{datasetIds:['aegis']}),synthetic=run('synthetic',{evidence:'synthetic-local-demo'}),running=run('running',{createdAt:'2026-10-28T14:00:00Z',status:'running',summary:undefined});
  assert.equal(reportScopeKey(latest),reportScopeKey(old));
  assert.deepEqual(trendCohort([extra,old,synthetic,latest,running]).map(r=>r.id),['old','latest']);
  assert.deepEqual(trendCohort([running]),[]);
  assert.deepEqual(finishedReports([old,running,run('error',{status:'failed'}),run('missing',{summary:undefined})]).map(r=>r.id),['old','error']);
});

test('Comparison links retain selection order, deduplicate, bound the set and escape report identifiers',()=>{
  const ids=['baseline','candidate/one','candidate?two','fourth','ignored'];
  const params=new URLSearchParams(comparisonHref([ids[0],ids[0],...ids.slice(1)],'targets').split('?')[1]);
  assert.deepEqual(parseComparisonIds(params.get('reports')),ids.slice(0,4));assert.equal(params.get('mode'),'targets');
  assert.deepEqual(parseComparisonIds('a,,a,b,c,d,e'),['a','b','c','d']);assert.deepEqual(parseComparisonIds(null),[]);
  assert.equal(finiteMetric(0),0);assert.equal(finiteMetric(null),null);assert.equal(finiteMetric(NaN),null);assert.equal(finiteMetric(Infinity),null);
});

test('Progressive Report tabs retain scoring context and preserve legacy comparison and Dataset evidence links',()=>{
  const state=(query:string)=>reportDetailLocation(new URLSearchParams(query));
  assert.deepEqual(state(''),{tab:'overview',filter:'all',dataset:''});
  assert.deepEqual(state('checks=unexpected'),{tab:'checks',filter:'unexpected',dataset:''});
  assert.deepEqual(state('checks=all&dataset=aegis&scoring=original'),{tab:'checks',filter:'all',dataset:'aegis'});
  assert.deepEqual(state('baseline=reference&scoring=original'),{tab:'overview',filter:'all',dataset:''});
  assert.deepEqual(state('tab=metrics'),{tab:'overview',filter:'all',dataset:''});
  assert.deepEqual(state('tab=metrics&checks=unexpected'),{tab:'overview',filter:'unexpected',dataset:''});
  assert.deepEqual(state('tab=compare'),{tab:'overview',filter:'all',dataset:''});
  assert.deepEqual(state('tab=evidence&checks=unexpected&baseline=reference'),{tab:'evidence',filter:'unexpected',dataset:''});
  assert.deepEqual(state('tab=checks&checks=error&dataset=pii&scoring=saved-version'),{tab:'checks',filter:'error',dataset:'pii'});
  assert.deepEqual(state('tab=unknown&checks=invalid'),{tab:'checks',filter:'all',dataset:''});
});

test('Case comparison links use the shared workspace and pin baseline and candidate scoring versions',()=>{
  const href=comparisonCasesHref('reference','candidate','s-base','s-current','targets'),params=new URLSearchParams(href.split('?')[1]);
  assert.ok(href.startsWith('#/compare?'));
  assert.deepEqual(parseComparisonIds(params.get('reports')),['reference','candidate']);
  assert.equal(params.get('scorings'),'s-base,s-current');assert.equal(params.get('view'),'cases');assert.equal(params.get('mode'),'targets');
  const legacy=(query:string)=>legacyReportComparisonHref('candidate',new URLSearchParams(query));
  assert.equal(legacy('tab=compare&baseline=reference&scoring=s-current&baselineScoring=s-base'),comparisonCasesHref('reference','candidate','s-base','s-current'));
  assert.equal(legacy('baseline=reference&scoring=original'),comparisonCasesHref('reference','candidate','original','original'));
  assert.equal(legacy('tab=compare&scoring=s-current'),comparisonHref(['candidate'],'history',['s-current']));
  assert.equal(legacy('tab=evidence&baseline=reference'),null);assert.equal(legacy('tab=metrics'),null);assert.equal(legacy(''),null);
  const deduplicated=new URLSearchParams(comparisonHref(['reference','reference','candidate'],'history',['s-base','ignored','s-current']).split('?')[1]);
  assert.equal(deduplicated.get('scorings'),'s-base,s-current');
});
