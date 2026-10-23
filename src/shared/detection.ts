import type {Attempt, Step} from './types.js';
export type JevStatus = 'matched'|'uncertain-block'|'unknown'|'not_matched'|'not_run'|'error'|'unavailable';
export interface ModelEvaluation {
  evaluatorId:'typesafe-jev-jailbreak'|'typesafe-jev-content-safety';capability:'jailbreak'|'content_safety';model:string|null;policyId?:string|null;
  verdict:'matched'|'not_matched'|'unknown'|'error';enforcedAction:'block'|'transform'|'allow'|null;
  questionRevision?:string|null;thresholds?:{lower:number;upper:number};probabilities?:Record<string,number>;
}
export interface RuntimeExecutionEvidence {status:'complete'|'error'|'bypassed';failClosed:boolean;errorTypes:string[]}
export function validExecutionEvidence(v:any):v is RuntimeExecutionEvidence {return !!v&&['complete','error','bypassed'].includes(v.status)&&typeof v.failClosed==='boolean'&&Array.isArray(v.errorTypes)&&v.errorTypes.length<=8&&v.errorTypes.every((s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(s));}
export interface EvaluationEvidence {execution?:RuntimeExecutionEvidence;schemaVersion:1;complete:boolean;protectionMode:'enforce'|'monitor'|'bypass';modelRevisionId?:string|null;evaluations:ModelEvaluation[];source?:'endpoint-header'|'guard-telemetry'}
const evaluatorCapabilities: Record<string,string> = {'typesafe-jev-jailbreak':'jailbreak','typesafe-jev-content-safety':'content_safety'};
const probabilityKeys: Record<string,string[]> = {jailbreak:['jailbreak_attempt','unsafe_pretext'],content_safety:['unsafe_content']};
const identity=(v:unknown)=>v===null||typeof v==='string'&&/^[A-Za-z0-9_.:/-]{1,160}$/.test(v);
export function parseEvaluationEvidence(raw:unknown):EvaluationEvidence|null {
  try {
    if(typeof raw==='string'){if(raw.length>6000)return null;raw=JSON.parse(raw);}
    const v=raw as EvaluationEvidence;
    if(!v||v.schemaVersion!==1||typeof v.complete!=='boolean'||!['enforce','monitor','bypass'].includes(v.protectionMode)||!Array.isArray(v.evaluations)||v.evaluations.length>40)return null;
    if(v.execution!==undefined&&!validExecutionEvidence(v.execution))return null;
    if(v.evaluations.some(e=>!e||!Object.hasOwn(evaluatorCapabilities,e.evaluatorId)||evaluatorCapabilities[e.evaluatorId]!==e.capability||!identity(e.model)||
      !['matched','not_matched','unknown','error'].includes(e.verdict)||![null,'block','transform','allow'].includes(e.enforcedAction)||
      e.questionRevision!==undefined&&!identity(e.questionRevision)||e.thresholds&&!(Number.isFinite(e.thresholds.lower)&&Number.isFinite(e.thresholds.upper)&&0<=e.thresholds.lower&&e.thresholds.lower<e.thresholds.upper&&e.thresholds.upper<=1)||
      e.probabilities&&Object.entries(e.probabilities).some(([k,p])=>!probabilityKeys[e.capability]?.includes(k)||typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)))return null;
    return {...(v.execution?{execution:{status:v.execution.status,failClosed:v.execution.failClosed,errorTypes:[...v.execution.errorTypes]}}:{}),schemaVersion:1,complete:v.complete,protectionMode:v.protectionMode,modelRevisionId:identity(v.modelRevisionId)?v.modelRevisionId:null,
      evaluations:v.evaluations.map(e=>({evaluatorId:e.evaluatorId,capability:e.capability,model:e.model,verdict:e.verdict,enforcedAction:e.enforcedAction,
        ...(identity(e.policyId)?{policyId:e.policyId}:{}),...(e.questionRevision?{questionRevision:e.questionRevision}:{}),
        ...(e.thresholds?{thresholds:{lower:e.thresholds.lower,upper:e.thresholds.upper}}:{}),...(e.probabilities?{probabilities:{...e.probabilities}}:{})})),
      source:v.source==='guard-telemetry'?'guard-telemetry':'endpoint-header'};
  }catch{return null;}
}
export function stepEvaluationEvidence(step:Step|undefined){return step?parseEvaluationEvidence(step.evaluationEvidence??step.headers?.['x-guard-evaluation-evidence']):null;}
export function jevDetection(record:Attempt):{status:JevStatus;evidence:EvaluationEvidence|null} {
  const step=record.steps.filter(s=>s.phase===record.phase).at(-1),evidence=stepEvaluationEvidence(step);
  if(!evidence)return {status:'unavailable',evidence:null};
  const rows=evidence.evaluations;
  const status:JevStatus=rows.some(e=>e.verdict==='error')?'error':
    rows.some(e=>e.verdict==='unknown'&&e.enforcedAction==='block')&&record.action==='block'?'uncertain-block':
    rows.some(e=>e.verdict==='matched')?'matched':rows.some(e=>e.verdict==='unknown')?'unknown':
    rows.length&&evidence.complete?'not_matched':evidence.complete?'not_run':'unavailable';
  return {status,evidence};
}
export const jevLabels:Record<JevStatus,string>={matched:'Explicit match','uncertain-block':'Uncertain · blocked',unknown:'Uncertain',not_matched:'No match',not_run:'Not run',error:'Model error',unavailable:'Evidence unavailable'};
export function jevSummary(records:Attempt[]){
  const completed=records.filter(r=>r.status==='completed'),counts=Object.fromEntries(Object.keys(jevLabels).map(k=>[k,0])) as Record<JevStatus,number>;
  for(const r of completed)counts[jevDetection(r).status]++;
  return {counts,completed:completed.length,available:completed.length-counts.unavailable,unit:'completed checks'};
}

export function executionFailure(step:Step|undefined):string|null {const e=stepEvaluationEvidence(step)?.execution;return e?.status==='error'?'Guard execution error'+(e.failClosed?' (failed closed)':'')+(e.errorTypes.length?': '+e.errorTypes.join(', '):''):null;}
