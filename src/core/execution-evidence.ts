/** Verified runtime status for offline grading; frozen HTTP evidence is never rewritten. */
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {hash} from './files.js';
import type {Attempt,JsonObject} from '../shared/types.js';
import {executionFailure,stepEvaluationEvidence,validExecutionEvidence,type RuntimeExecutionEvidence} from '../shared/detection.js';
export function executionEvidenceHash(dir:string):string|null {const p=join(dir,'execution-evidence.jsonl');return existsSync(p)?hash(readFileSync(p)):null;}
export function withExecutionEvidence(dir:string,records:Attempt[],expectedHash:string|null=executionEvidenceHash(dir)):Attempt[]{
 const byId=new Map<string,Map<string,RuntimeExecutionEvidence>>(),ids=new Map(records.map(r=>[r.attemptId,r]));
 if(expectedHash!==null){
  if(executionEvidenceHash(dir)!==expectedHash)throw new Error('Verified execution evidence was modified');
  for(const line of readFileSync(join(dir,'execution-evidence.jsonl'),'utf8').split(/\r?\n/).filter(Boolean)){
   const v=JSON.parse(line),r=ids.get(v.attemptId),step=r?.steps.find(s=>s.phase===v.phase);
   if(v.schemaVersion!==1||!r||!step||!['input','output'].includes(v.phase)||typeof v.eventId!=='string'||!v.eventId||
      typeof v.requestId!=='string'||!v.requestId.endsWith('veritas-'+r.attemptId)||v.responseHash!==hash(JSON.stringify(step.response))||!validExecutionEvidence(v.execution))throw new Error('Invalid or mismatched verified execution evidence');
   const phases=byId.get(r.attemptId)??new Map();if(phases.has(v.phase))throw new Error('Duplicate verified execution evidence');phases.set(v.phase,v.execution);byId.set(r.attemptId,phases);
  }
 }
 return records.map(r=>{
  const steps=r.steps.map(s=>{const e=byId.get(r.attemptId)?.get(s.phase);if(!e)return s;const native=stepEvaluationEvidence(s);
   // An original structured execution result is authoritative. Telemetry may
   // fill a legacy omission, but cannot replace captured endpoint evidence.
   if(native?.execution)return s;
   return {...s,evaluationEvidence:{...(native??{schemaVersion:1 as const,complete:false,protectionMode:'enforce' as const,evaluations:[]}),execution:e,source:'guard-telemetry' as const}};
  });
  const error=steps.map(executionFailure).find(Boolean);
  return error?{...r,steps,status:'error' as const,error}:{...r,steps};
 });
}
/** A legacy assessment keeps its original interpretation; new assessments pin the sidecar hash. */
export function recordsForScoring(dir:string,records:Attempt[],metadata?:JsonObject):Attempt[]{
 return metadata?.executionEvidenceHash!==undefined?withExecutionEvidence(dir,records,metadata.executionEvidenceHash):records;
}
