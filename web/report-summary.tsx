import {Activity,AlertTriangle,CheckCheck,Clock3,Coins,Repeat2,ArrowRight,ShieldAlert,ShieldCheck} from 'lucide-react';
import type {JsonObject,RunItem} from '../src/shared/types';
import {percent} from './format';
import {count,outcomeSegments,reportAttention} from './report-model';

export function ReportSummary({summary:s,run,gradesAvailable,openChecks}:{summary:JsonObject;run:RunItem;gradesAvailable:boolean;openChecks:(filter:string)=>void}){
  const parts=outcomeSegments(s),total=parts.reduce((n,p)=>n+(p.value??0),0),attention=reportAttention(run,s),AttentionIcon=attention.tone==='success'?CheckCheck:AlertTriangle;
  return <>
    <section className="report-scores" aria-label="Accuracy, precision, recall and F1 score">
      {[{label:'Accuracy',value:s.accuracy,note:count(s.passed)+' / '+count(s.scored??s.completed)+' scored checks matched',formula:'Match rate under the selected scoring rules'},{label:'Precision',value:s.precision,note:'Correct interventions / all interventions',formula:'TP / (TP + FP)'},{label:'Recall',value:s.recall,note:'Detected / expected interventions',formula:'TP / (TP + FN)'},{label:'F1 score',value:s.f1,note:'Balance of precision and recall',formula:'2TP / (2TP + FP + FN)'}].map(m=><div key={m.label} title={m.formula}><span className="metric-label">{m.label}</span><strong>{percent(m.value)}</strong><small>{m.value==null?'Not defined for this sample':m.note}</small></div>)}
    </section>
    <details className="classification-notes"><summary>Metric definitions &amp; confusion matrix</summary><p>Precision, recall and F1 treat <strong>block or transform as a positive intervention</strong>. They use labelled completed checks, independently of the selected scoring rules. Accuracy is the selected scorer match rate and can differ from binary detection accuracy. Errors, skipped and missing checks are excluded; undefined denominators show —.</p><dl>{[{name:'True positives',key:'truePositives'},{name:'False positives',key:'falsePositives'},{name:'False negatives',key:'falseNegatives'},{name:'True negatives',key:'trueNegatives'}].map(v=><div key={v.key}><dt>{v.name}</dt><dd>{count(s.classification?.[v.key])}</dd></div>)}</dl><p>{count(s.classification?.support)} labelled completed checks · Binary detection accuracy {percent(s.classification?.accuracy)}</p></details>
    <section className="report-summary report-summary-compact" aria-label="Test summary">
      <div className="summary-outcomes"><div className="summary-coverage-inline"><span>Coverage <b>{percent(s.coverage)}</b></span><span>{count(s.completed)} / {count(s.plannedAttempts)} planned checks completed</span></div><div className={'summary-verdict tone-'+attention.tone}><AttentionIcon aria-hidden="true"/><h2>{attention.label}</h2></div><p>Accuracy excludes execution errors, skipped and missing checks. Read it together with coverage.</p>
        <div className="outcome-bar" role="img" aria-label={parts.map(p=>p.label+': '+count(p.value)).join(', ')}>{parts.filter(p=>(p.value??0)>0).map(p=><span className={'outcome-segment outcome-'+p.tone} key={p.key} style={{width:((p.value??0)/total*100)+'%'}}/>)}</div>
        <div className="outcome-legend">{parts.map(p=>{const content=<><i className={'outcome-dot outcome-'+p.tone}/><span>{p.label}<strong>{count(p.value)}</strong></span></>;return p.filter&&p.filter!=='all'?<button className="outcome-legend-item" key={p.key} disabled={p.filter==='unexpected'&&!gradesAvailable} title={p.filter==='unexpected'&&!gradesAvailable?'Per-check scoring is unavailable for this historical Report':undefined} onClick={()=>openChecks(p.filter)} aria-label={p.filter==='error'?'View execution errors':'View '+p.label.toLowerCase()+' checks'}>{content}<ArrowRight aria-hidden="true"/></button>:<div className="outcome-legend-item" key={p.key}>{content}</div>;})}</div>
      </div>
    </section>
    <div className="report-operational-metrics" aria-label="Performance and execution metrics">
      <div><Clock3 aria-hidden="true"/><span><span className="metric-label">Check latency · p95</span><strong>{s.latencyMs?.p95==null?'—':Math.round(s.latencyMs.p95).toLocaleString()}<em> ms</em></strong><small>Caller measured · p50 {s.latencyMs?.p50==null?'—':Math.round(s.latencyMs.p50)} ms</small></span></div>
      <div><Activity aria-hidden="true"/><span><span className="metric-label">HTTP calls</span><strong>{count(s.httpCalls)}</strong><small>{count(s.inputHttpCalls)} input · {count(s.outputHttpCalls)} output</small></span></div>
      <div><Repeat2 aria-hidden="true"/><span><span className="metric-label">Unstable cases</span><strong>{percent(s.unstableRate)}</strong><small>{s.repeatEligibleCases===0?'No cases have two completed repeats':count(s.unstableCases)+' / '+count(s.repeatEligibleCases)+' repeated cases'}</small></span></div>
      <div><Coins aria-hidden="true"/><span><span className="metric-label">Guard-side cost</span><strong className="metric-unavailable">Not connected</strong><small>Guard trace / cost integration required</small></span></div>
    </div>
  </>;
}

export function DecisionInsights({summary:s}:{summary:JsonObject}){
  return <section className="decision-insights" aria-label="Decision diagnostics"><div><ShieldCheck aria-hidden="true"/><div><h3>False positives <strong>{percent(s.falsePositiveRate)}</strong></h3><p>{count(s.falsePositives)} / {count(s.expectedAllow)} expected allows did not satisfy the selected action rule.</p></div></div><div><ShieldAlert aria-hidden="true"/><div><h3>Missed blocks <strong className={s.falseNegatives>0?'text-danger':''}>{percent(s.falseNegativeRate)}</strong></h3><p>{count(s.falseNegatives)} / {count(s.expectedBlock)} expected blocks did not satisfy the selected action rule.</p></div></div></section>;
}
