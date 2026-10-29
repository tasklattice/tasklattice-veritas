import {parse} from 'csv-parse/sync';
import {piiEvidence,type PiiStatus,piiLabels} from '../shared/pii.js';
import type {Attempt,Case,JsonObject} from '../shared/types.js';
export const piiColumns=['pii_outcome','pii_annotated_values','pii_remaining_values','pii_metric_version'];
export function piiCells(r:Attempt,c?:Case){const p=piiEvidence(r,c);return p?[p.status,p.annotated,p.remaining??'',p.version]:['','','',''];}
export function piiCsv(csv:string,records:(Attempt&{pii?:ReturnType<typeof piiEvidence>})[]){
 const rows=parse(csv) as string[][];if(!rows.length)return csv;
 for(const i of rows[0].map((n,i)=>piiColumns.includes(n)?i:-1).filter(i=>i>=0).reverse())for(const r of rows)r.splice(i,1);
 const idx=rows[0].indexOf('attempt_id'),byId=new Map(records.map(r=>[r.attemptId,r.pii]));rows[0].push(...piiColumns);
 for(const r of rows.slice(1)){const p=byId.get(r[idx]);r.push(...(p?[p.status,String(p.annotated),p.remaining==null?'':String(p.remaining),p.version]:['','','','']));}
 return rows.map(r=>r.map(v=>'"'+(/^[=+\-@\t\r]/.test(v)?"'"+v:v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n';
}
export function piiMarkdown(s:JsonObject){const p=s.pii;if(!p)return '';const rate=(x:number|null)=>x==null?'N/A':(x*100).toFixed(2)+'%';
 return ['## PII outcomes','','| Metric | Result |','|---|---:|',`| Intervention recall (block or transform) | ${rate(p.interventionRecall)} |`,`| Complete annotated redaction | ${p.counts.complete} / ${p.completed} (${rate(p.completeRedactionRate)}) |`,...Object.entries(p.counts).map(([k,n])=>`| ${piiLabels[k as PiiStatus]} | ${n} |`),`| Completed controls / interventions | ${p.controlCompleted} / ${p.controlInterventions} |`,'','Final-action recall includes other protections and is not native PII detector recall. Both rates use completed, annotated-positive checks. Block is intervention, not successful redaction. Complete redaction requires nonempty transformed text and verified removal of every annotated source span; unknown replacement formats remain unverified. Errors, skips and missing checks are excluded; repeats are not independent samples. Metric version: '+p.version+'. Saved grades remain unchanged.',''].join('\n');}
