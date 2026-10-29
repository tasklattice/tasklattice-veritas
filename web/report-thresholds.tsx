import type {JsonObject,RunItem} from '../src/shared/types';
import {Table,Thead,Tbody,Tr,Th,Td} from './ui';
import {reportThresholdPolicy,thresholdValue} from './report-model';

export function ReportThresholds({run,configuration,offline}:{run:RunItem;configuration:JsonObject|null;offline:boolean}){
  const policy=reportThresholdPolicy(run,configuration,offline);
  const mixedOrigins=new Set(policy.rows.map(row=>row.origin)).size>1;
  return <section className="report-thresholds" aria-label="Evaluation thresholds">
    <header className="report-section-heading"><div><h2>Evaluation thresholds</h2><p title="Threshold source">{policy.source}</p></div><span className={run.gate?.pass===false?'text-warning':run.gate?.pass===true?'text-success':''}>{run.gate?.pass===false?'Not met':run.gate?.pass===true?'Met':'Not assessed'}</span></header>
    {!policy.known&&<p className="help">Only saved failed thresholds are available.</p>}
    {policy.rows.length>0&&<Table className="resource-table threshold-policy-table"><Thead><Tr><Th>Metric</Th><Th>Required</Th><Th>Actual</Th>{mixedOrigins&&<Th>Source</Th>}<Th>Result</Th></Tr></Thead><Tbody>{policy.rows.map(row=><Tr key={row.key}><Td>{row.label}</Td><Td>{row.operator} {thresholdValue(row.key,row.threshold)}</Td><Td>{thresholdValue(row.key,row.actual)}</Td>{mixedOrigins&&<Td>{row.origin}</Td>}<Td className={row.result==='Not met'?'text-warning':row.result==='Met'?'text-success':''}>{row.result}</Td></Tr>)}</Tbody></Table>}
    {policy.otherFailures.map((failure,i)=><p className="help text-warning" key={i}>{failure.metric==='engineConsistency'?'Recorded grade consistency':failure.metric}: {failure.reason??'The recorded assessment check did not pass.'}</p>)}
  </section>;
}
