import type {Attempt,JsonObject} from '../src/shared/types';
import {jevDetection,jevLabels,capabilityLabels,probabilityLabels,type JevStatus} from '../src/shared/detection';
import {Button,Disclosure} from './ui';
import {count} from './report-model';

const tone=(s:JevStatus)=>s==='matched'?'text-danger':s==='uncertain-block'||s==='unknown'||s==='error'?'text-warning':'';
export function JevBadge({attempt}:{attempt:Attempt}){const d=jevDetection(attempt);return <span className={'jev-verdict '+tone(d.status)}>{jevLabels[d.status]}</span>;}
export function JevSummary({summary,openChecks}:{summary:JsonObject;openChecks:(filter:string)=>void}){
  const j=summary.jev;if(!j)return null;
  return <section className="jev-evidence-summary" aria-label="JEV model evidence"><div className="section-title"><div><h2>JEV</h2></div><span className="help">{count(j.available)} / {count(j.completed)} completed with evidence</span></div>
    <div className="jev-evidence-primary">{[{key:'matched',label:'Explicit model match'},{key:'uncertain-block',label:'Uncertain · blocked'}].map(({key,label})=><Button key={key} variant="ghost" onClick={()=>openChecks('jev-'+key)} disabled={!j.counts[key]}><span><span>{label}</span><strong>{count(j.counts[key])}</strong></span></Button>)}</div>
    <div className="jev-evidence-secondary">{(['not_matched','not_run','unknown','error','unavailable'] as JevStatus[]).filter(key=>j.counts[key]>0).map(key=><Button key={key} variant="ghost" disabled={!j.counts[key]} onClick={()=>openChecks('jev-'+key)}>{jevLabels[key]}<strong>{count(j.counts[key])}</strong></Button>)}</div>
    <Disclosure className="report-evidence-definitions" label="Metric definitions"><p>Final-action recall includes local rules and uncertainty blocks. It does not measure native JEV recall. Counts are per completed check across Jailbreak, Content safety and Topic control. Missing historical capabilities are not inferred; inspect the recorded rows for attribution.</p></Disclosure></section>;
}
export function JevDetails({attempt}:{attempt:Attempt}){
  const d=jevDetection(attempt),rows=d.evidence?.evaluations??[];
  return <section className="jev-check-details" aria-label="JEV model verdict"><h3>JEV model verdict</h3><JevBadge attempt={attempt}/>{rows.map((e,i)=><div key={i} className="jev-model-evidence"><p><strong>{capabilityLabels[e.capability]} · {e.model??'JEV'}</strong><span>{e.questionRevision??'Question revision unavailable'}</span></p><dl>{e.policyId&&<div><dt>Policy</dt><dd>{e.policyId}</dd></div>}<div><dt>Native verdict</dt><dd>{e.verdict}</dd></div><div><dt>Enforced action</dt><dd>{e.enforcedAction??'No JEV intervention'}</dd></div>{Object.entries(e.probabilities??{}).map(([k,p])=><div key={k}><dt>{probabilityLabels[k]??k}</dt><dd>{p.toFixed(2)}</dd></div>)}{e.thresholds&&<div><dt>Decision thresholds</dt><dd>no ≤ {e.thresholds.lower}; yes ≥ {e.thresholds.upper}</dd></div>}</dl>{!e.probabilities&&<p className="help">Native probabilities are unavailable for this historical request.</p>}</div>)}<p className="help">{d.status==='uncertain-block'?'At least one JEV check was uncertain and enforced a block. Review each capability below for other explicit matches.':d.status==='not_run'?'No JEV evaluation was recorded. An earlier rule may have ended the check, or JEV was not selected.':d.status==='unavailable'?'This response has no compatible model evidence. The saved final action and scoring are preserved.':'Noul values are model yes probabilities, not severity scores.'}</p></section>;
}
