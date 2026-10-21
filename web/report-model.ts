import type {Attempt,Grade,JsonObject,RunItem} from '../src/shared/types';
export type Evidence=Attempt&{expected?:string|null;grade?:Grade;samplePreview?:string|null;sampleTruncated?:boolean};
export type EvidencePage={items:Evidence[];total:number;allTotal:number;datasetTotal:number;unexpected:number;errors:number;skipped:number};
export const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString():'—';
export function decisionResult(a:Pick<Evidence,'status'|'expected'|'action'|'grade'>){
  if(a.status==='error')return {label:'Execution error',tone:'warning',kind:'error'};
  if(a.status==='skipped')return {label:'Skipped',tone:'neutral',kind:'skipped'};
  if(!a.grade)return {label:'Unscored',tone:'neutral',kind:'unscored'};
  if(a.grade.pass)return {label:'Matched',tone:'success',kind:'passed'};
  if(a.grade.actionPass===true)return {label:'Additional check failed',tone:'danger',kind:'unexpected'};
  if(!a.expected)return {label:'Expectation needs review',tone:'warning',kind:'unexpected'};
  if(a.expected==='allow')return {label:'False positive',tone:'danger',kind:'unexpected'};
  if(a.expected==='block')return {label:'Missed block',tone:'danger',kind:'unexpected'};
  return {label:'Transformation mismatch',tone:'danger',kind:'unexpected'};
}
export function reportAttention(run:Pick<RunItem,'status'>,s:JsonObject){
  if(['running','queued'].includes(run.status))return {label:'Testing in progress',tone:'info'};
  if(s.failed>0)return {label:count(s.failed)+' unexpected '+(s.failed===1?'decision':'decisions'),tone:'danger'};
  if(s.errors>0)return {label:count(s.errors)+' execution '+(s.errors===1?'error':'errors'),tone:'warning'};
  if(s.missing>0||['cancelled','interrupted','failed'].includes(run.status))return {label:'Test incomplete',tone:'warning'};
  if(s.skipped>0)return {label:count(s.skipped)+' skipped '+(s.skipped===1?'check':'checks'),tone:'warning'};
  if(s.unscored>0)return {label:count(s.unscored)+' completed checks need scoring',tone:'warning'};
  if(s.completed>0)return {label:'All completed checks matched',tone:'success'};
  return {label:'No completed checks',tone:'neutral'};
}
export function outcomeSegments(s:JsonObject){
  return [
    {key:'passed',label:'Matched',value:s.passed,filter:'all',tone:'success'},
    {key:'failed',label:'Unexpected',value:s.failed,filter:'unexpected',tone:'danger'},
    {key:'errors',label:'Errors',value:s.errors,filter:'error',tone:'warning'},
    {key:'skipped',label:'Skipped',value:s.skipped,filter:'skipped',tone:'neutral'},
    {key:'missing',label:'Missing',value:s.missing,filter:null,tone:'muted'},
  ].map(p=>({...p,value:typeof p.value==='number'&&Number.isFinite(p.value)&&p.value>=0?p.value:null}));
}
