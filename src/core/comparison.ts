import {validatePurpose} from '../shared/benchmark.js';
import type {Attempt,Case,Grade,JsonObject} from '../shared/types.js';
import type {ChangeKind,ComparisonRow,ComparedCheck} from '../shared/comparison.js';
import {hash} from './files.js';
import {adapterType,outputMode} from './provider.js';

export interface ComparisonEvidence {snapshot:JsonObject;records:Attempt[];grades?:Map<string,Grade>;scorerHash?:string;report:JsonObject}
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
function gradeState(records:Attempt[], source:ComparisonEvidence) {
  if(records.length!==source.snapshot.repeat)return {kind:'incomplete',reason:'Missing attempts or a different repeat count'};
  if(records.some(r=>r.status!=='completed'))return {kind:'incomplete',reason:'Execution errors or skipped checks are not content verdicts'};
  if(records.some(r=>!source.grades?.has(r.attemptId)))return {kind:'incomplete',reason:'Saved per-check grades are unavailable'};
  const states=new Set(records.map(r=>`${r.action}/${source.grades!.get(r.attemptId)!.pass}`));
  if(states.size>1)return {kind:'unstable',reason:'Repeated checks disagree in action or grade'};
  return {kind:source.grades!.get(records[0].attemptId)!.pass?'pass':'fail',reason:''};
}
function compact(records:Attempt[], grades?:Map<string,Grade>):ComparedCheck[] {return records.map(r=>({attemptId:r.attemptId,status:r.status,action:r.action,pass:grades?.get(r.attemptId)?.pass,reason:grades?.get(r.attemptId)?.reason??r.error??r.skipReason,latencyMs:r.latencyMs??r.totalHttpLatencyMs}));}
/** Read-only comparison: no Provider, credential lookup, fresh assertion, or Target call. */
export function compareEvidence(baseline:ComparisonEvidence,candidate:ComparisonEvidence) {
  const a=baseline.snapshot,b=candidate.snapshot,issues:string[]=[],warnings:string[]=[];
  if(validatePurpose(a.testPurpose)!==validatePurpose(b.testPurpose))issues.push('Test purposes differ.');
  if(!baseline.scorerHash||baseline.scorerHash!==candidate.scorerHash)issues.push('Scoring rules or implementations differ. Re-score both Reports with the same rules.');
  if(adapterType(a.target)!==adapterType(b.target)||outputMode(a.target)!==outputMode(b.target))issues.push('Adapter or output mode differs.');
  if(a.evidence!==b.evidence)issues.push('Synthetic and measured evidence cannot be compared.');
  if(a.providerHash!==b.providerHash||a.engine?.version!==b.engine?.version)issues.push('Execution implementation or promptfoo version differs.');
  if(a.repeat!==b.repeat)issues.push('Repeat counts differ.');
  if(a.concurrency!==b.concurrency)warnings.push('Concurrency differs; latency deltas are not comparable.');
  const ac=new Map<string,Case>((a.cases??[]).map((c:Case)=>[c.id,c])),bc=new Map<string,Case>((b.cases??[]).map((c:Case)=>[c.id,c]));
  const ar=new Map<string,Attempt[]>(),br=new Map<string,Attempt[]>();
  for(const [records,map] of [[baseline.records,ar],[candidate.records,br]] as const)for(const r of records){const list=map.get(r.caseId)??[];list.push(r);map.set(r.caseId,list);}
  const counts:Record<ChangeKind,number>={'new-failure':0,fixed:0,'still-failing':0,unchanged:0,unstable:0,'not-comparable':0};
  const rows:ComparisonRow[]=[];
  for(const id of new Set([...bc.keys(),...ac.keys()])){
    const left=ac.get(id),right=bc.get(id),sample=right??left!,l=ar.get(id)??[],r=br.get(id)??[];
    let change:ChangeKind='not-comparable',reason=issues.join(' ');
    if(!left||!right)reason='Case is absent from one Report';
    else if(hash(canonical(left))!==hash(canonical(right)))reason='Case input, expectation or metadata changed';
    else if(!issues.length){
      const ls=gradeState(l,baseline),rs=gradeState(r,candidate);
      if(ls.kind==='incomplete'||rs.kind==='incomplete')reason=[ls,rs].filter(x=>x.kind==='incomplete').map(x=>x.reason).join('; ');
      else if(ls.kind==='unstable'||rs.kind==='unstable'){change='unstable';reason='Action or grade varies across repeats; no regression or fix is claimed';}
      else {change=ls.kind==='pass'?(rs.kind==='fail'?'new-failure':'unchanged'):(rs.kind==='pass'?'fixed':'still-failing');reason=change==='new-failure'?'Previously matched; now consistently fails':change==='fixed'?'Previously failed; now consistently matches':change==='still-failing'?'Consistently fails in both Reports':'Consistently matches in both Reports';}
    }
    counts[change]++;rows.push({caseId:id,dataset:sample.dataset,phase:sample.phase,expected:sample.expected,samplePreview:Array.from(sample.text.slice(0,480)).slice(0,240).join(''),change,reason,baseline:compact(l,baseline.grades),candidate:compact(r,candidate.grades)});
  }
  const cohortMatches=rows.every(r=>ac.has(r.caseId)&&bc.has(r.caseId)&&hash(canonical(ac.get(r.caseId)))===hash(canonical(bc.get(r.caseId))));
  if(!cohortMatches)warnings.push('Case populations or labels differ. Only identical shared cases are compared; overall deltas are withheld.');
  const complete=baseline.report.summary.coverage===1&&candidate.report.summary.coverage===1&&counts['not-comparable']===0;
  if(!complete)warnings.push('Incomplete or ungraded evidence exists. Overall deltas are withheld; execution failures are not fixes.');
  warnings.push('Target URLs do not prove which Guard configuration was active. Review frozen configuration and returned routing/version evidence.');
  const aggregateComparable=!issues.length&&cohortMatches&&complete;
  const metrics=[['Accuracy','accuracy'],['Precision','precision'],['Recall','recall'],['F1 score','f1'],['Coverage','coverage'],['Latency p95','latencyMs']] .map(([name,key])=>{
    const x=key==='latencyMs'?baseline.report.summary.latencyMs?.p95:baseline.report.summary[key],y=key==='latencyMs'?candidate.report.summary.latencyMs?.p95:candidate.report.summary[key];
    return {name,baseline:typeof x==='number'?x:null,candidate:typeof y==='number'?y:null,delta:aggregateComparable&&(key!=='latencyMs'||a.concurrency===b.concurrency)&&typeof x==='number'&&typeof y==='number'?y-x:null,unit:key==='latencyMs'?'ms' as const:'rate' as const};
  });
  if(baseline.report.summary.pii&&candidate.report.summary.pii){
    for(const [name,key] of [['PII intervention recall','interventionRecall'],['PII complete redaction','completeRedactionRate'],['PII control interventions','controlFalsePositiveRate']]){
      const x=baseline.report.summary.pii[key],y=candidate.report.summary.pii[key];
      metrics.push({name,baseline:x,candidate:y,delta:aggregateComparable&&baseline.report.summary.pii.version===candidate.report.summary.pii.version&&typeof x==='number'&&typeof y==='number'?y-x:null,unit:'rate'});
    }
  }
  return {counts,issues,warnings,aggregateComparable,metrics,rows};
}
