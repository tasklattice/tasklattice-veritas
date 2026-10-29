import {isActiveRun} from '../src/shared/testing';
import type {Attempt,Grade,JsonObject,RunItem} from '../src/shared/types';
import {DEFAULT_QUALITY_THRESHOLDS} from '../src/shared/quality-thresholds';
export type Evidence=Attempt&{pii?:ReturnType<typeof import('../src/shared/pii').piiEvidence>;expected?:string|null;grade?:Grade;samplePreview?:string|null;sampleTruncated?:boolean};
export type EvidencePage={items:Evidence[];total:number;allTotal:number;datasetTotal:number;unexpected:number;errors:number;skipped:number};
export function reportDetailLocation(params:URLSearchParams){
  const tabs=['overview','checks','evidence','configuration'];
  const requested=params.get('tab'),tab=requested==='metrics'?'overview':requested&&tabs.includes(requested)?requested:params.has('checks')?'checks':'overview';
  const filter=['all','unexpected','error','skipped'].includes(params.get('checks')??'')?params.get('checks')!:'all';
  return {tab,filter,dataset:params.get('dataset')??''};
}
export const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString():'—';
export const reportLabel=(run:Pick<RunItem,'name'>)=>/^run-.*-[a-f0-9]{6}$/.test(run.name)?'Run '+run.name.slice(-6).toUpperCase():run.name;
export function reportExecutionStatus(run:Pick<RunItem,'status'>){
  const labels:Record<RunItem['status'],string>={queued:'Queued',preparing:'Preparing',running:'Running',scoring:'Scoring',completed:'Completed',failed:'Execution failed',cancelled:'Cancelled',interrupted:'Interrupted'};
  return {state:run.status,label:labels[run.status],description:run.status==='completed'?'Test execution finished. Review match rate and unexpected decisions for result quality.':run.status==='failed'?'The test could not finish cleanly. Open the Report for execution errors or missing checks.':run.status==='interrupted'?'Execution stopped before a final result was saved.':run.status==='cancelled'?'Execution was cancelled. Completed checks remain available.':'Test execution is in progress.'};
}
const thresholdDefinitions:Record<string,{label:string;summary:string;operator:string}>={
  minCoverage:{label:'Completed coverage',summary:'coverage',operator:'≥'},minAccuracy:{label:'Scoring match rate',summary:'accuracy',operator:'≥'},
  maxFalsePositiveRate:{label:'False-positive rate',summary:'falsePositiveRate',operator:'≤'},maxFalseNegativeRate:{label:'Missed-block rate',summary:'falseNegativeRate',operator:'≤'},
  maxP95Ms:{label:'Check latency · p95',summary:'latencyMs',operator:'≤'},maxAccuracyDrop:{label:'Match-rate drop vs baseline',summary:'accuracyDrop',operator:'≤'},
};
export function reportThresholdPolicy(run:Pick<RunItem,'summary'|'gate'>,configuration:JsonObject|null,offline=false){
  const configured=offline?{}:configuration?.gate,known=configured!==null&&typeof configured==='object'&&!Array.isArray(configured);
  const failures:JsonObject[]=Array.isArray(run.gate?.failures)?run.gate.failures:[];
  const values:Record<string,number>=known?{...DEFAULT_QUALITY_THRESHOLDS,...configured}:Object.fromEntries(failures.filter(f=>Number.isFinite(f.threshold)).map(f=>[f.metric,f.threshold]));
  const rows=Object.entries(values).filter(([key])=>thresholdDefinitions[key]).map(([key,threshold])=>{
    const definition=thresholdDefinitions[key],failure=failures.find(f=>f.metric===key),summary=run.summary;
    const measured=key==='maxP95Ms'?summary?.latencyMs?.p95:key==='maxAccuracyDrop'?configuration?.comparison?.accuracyDrop:summary?.[definition.summary];
    const value=failure?failure.actual:measured,actual=typeof value==='number'&&Number.isFinite(value)?value:null;
    return {key,label:definition.label,operator:definition.operator,threshold,actual,origin:known?(Object.hasOwn(configured,key)?'Saved test':'Veritas default'):'Saved verdict',result:failure?'Not met':run.gate&&actual!==null?'Met':'Unavailable'};
  });
  return {source:offline?'Veritas defaults · offline scoring':!known?'Historical policy not recorded':Object.keys(configured).length?'Saved test configuration':'Veritas defaults',known,rows,otherFailures:failures.filter(f=>!thresholdDefinitions[f.metric])};
}
export function thresholdValue(key:string,value:number|null){
  if(value===null)return 'Unavailable';
  return key==='maxP95Ms'?value.toLocaleString()+' ms':key==='maxAccuracyDrop'?(value*100).toFixed(1)+' pp':(value*100).toFixed(1)+'%';
}
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
  if(isActiveRun(run.status))return {label:'Testing in progress',tone:'info'};
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
