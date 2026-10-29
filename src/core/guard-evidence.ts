import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'csv-parse/sync';
import type {Attempt} from '../shared/types.js';
import {jevDetection,jevSummary,parseEvaluationEvidence} from '../shared/detection.js';

/** Add independently captured telemetry without changing frozen requests or SDK grades. */
export function withEvaluationEvidence(dir:string,records:Attempt[]):Attempt[]{
  const file=join(dir,'evaluation-evidence.jsonl');if(!existsSync(file))return records;
  const byId=new Map<string,Map<string,ReturnType<typeof parseEvaluationEvidence>>>();
  for(const line of readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean)){
    try{const r=JSON.parse(line),e=parseEvaluationEvidence(r.evidence);if(r.schemaVersion!==1||typeof r.attemptId!=='string'||!['input','output'].includes(r.phase)||!e)continue;
      const phases=byId.get(r.attemptId)??new Map();phases.set(r.phase,e);byId.set(r.attemptId,phases);
    }catch{/* Corrupt optional evidence never becomes a model match. */}
  }
  return records.map(r=>({...r,steps:r.steps.map(s=>s.headers?.['x-guard-evaluation-evidence']?s:{...s,...(byId.get(r.attemptId)?.get(s.phase)?{evaluationEvidence:byId.get(r.attemptId)!.get(s.phase)!}:{})})}));
}
export {jevSummary};
export const detectionColumns=['jev_verdict','jev_model','jev_question_revision','jev_probabilities','jev_evidence_source','jev_evaluations'];
export function detectionCells(r:Attempt){const d=jevDetection(r),rows=d.evidence?.evaluations??[];
  return [d.status,[...new Set(rows.map(e=>e.model).filter(Boolean))].join(';'),[...new Set(rows.map(e=>e.questionRevision).filter(Boolean))].join(';'),JSON.stringify(rows.map(e=>e.probabilities??null)),d.evidence?.source??'',JSON.stringify(rows)];}
export function detectionMarkdown(s:{jev?:ReturnType<typeof jevSummary>}){
  const j=s.jev;if(!j)return '';
  return ['## JEV model evidence','','| Evidence | Completed checks |','|---|---:|',
    `| Explicit model match | ${j.counts.matched} |`,`| Uncertain, conservatively blocked | ${j.counts['uncertain-block']} |`,
    `| Uncertain, not enforced | ${j.counts.unknown} |`,`| No model match | ${j.counts.not_matched} |`,`| JEV not run | ${j.counts.not_run} |`,
    `| Model error | ${j.counts.error} |`,`| Evidence unavailable | ${j.counts.unavailable} |`,'',
    'Counts describe completed checks, not independent samples. Final-action recall includes local rules and uncertainty interventions; it is not native model recall. Missing historical evidence is unavailable, never inferred from a reason string.',''].join('\n');
}
export function detectionCsv(csv:string,records:Attempt[]){
  const rows=parse(csv) as string[][];if(!rows.length)return csv;
  // Replace only evidence columns; preserve later fields such as benchmark purpose.
  const existing=rows[0].map((name,i)=>detectionColumns.includes(name)?i:-1).filter(i=>i>=0).reverse();
  for(const i of existing)for(const row of rows)row.splice(i,1);
  const id=rows[0].indexOf('attempt_id'),byId=new Map(records.map(r=>[r.attemptId,r]));rows[0].push(...detectionColumns);
  for(const row of rows.slice(1)){const r=byId.get(row[id]);row.push(...(r?detectionCells(r):['unavailable',...Array(detectionColumns.length-1).fill('')]));}
  return rows.map(row=>row.map(v=>'"'+(/^[=+\-@\t\r]/.test(String(v??''))?"'"+String(v??''):String(v??'')).replaceAll('"','""')+'"').join(',')).join('\n')+'\n';
}
