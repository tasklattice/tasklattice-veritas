import type {JsonObject} from '../src/shared/types';
import {Button} from './ui';
import {percent} from './format';
import {count} from './report-model';

export function ReportSummary({summary:s,openChecks}:{summary:JsonObject;openChecks:(filter:string)=>void}){
  return <div className="report-overall-metrics">
    <section className="overview-key-metrics" aria-label="Overall evaluation metrics">{[
      {label:'Accuracy',value:percent(s.accuracy),note:count(s.passed)+' / '+count(s.scored??s.completed)+' matched',definition:'Match rate under the selected scoring rules.'},
      {label:'Precision',value:percent(s.precision),definition:'Correct interventions divided by all observed interventions.'},
      {label:'Recall',value:percent(s.recall),definition:'Detected interventions divided by all expected interventions.'},
      {label:'F1',value:percent(s.f1),definition:'Harmonic mean of detection precision and recall.'},
    ].map(metric=><div key={metric.label} title={metric.definition}><span>{metric.label}</span><strong>{metric.value}</strong>{metric.note&&<small>{metric.note}</small>}</div>)}</section>
    <dl className="overview-execution-metadata" aria-label="Execution measurements">
      <div><dt>Completed / planned</dt><dd>{count(s.completed)} / {count(s.plannedAttempts)}</dd></div>
      <div><dt>Coverage</dt><dd>{percent(s.coverage)}</dd></div>
      <div><dt>Execution errors</dt><dd>{s.errors>0?<Button variant="ghost" className="text-warning" onClick={()=>openChecks('error')}>{count(s.errors)}</Button>:count(s.errors)}</dd></div>
      <div><dt>Check latency · p95</dt><dd>{s.latencyMs?.p95==null?'—':Math.round(s.latencyMs.p95).toLocaleString()+' ms'}</dd></div>
    </dl>
  </div>;
}
