import type {DatasetCard,JsonObject} from '../src/shared/types';
import {Button,Table,Thead,Tbody,Tr,Th,Td,Disclosure} from './ui';
import {DatasetIdentity} from './brand';
import {percent} from './format';
import {count} from './report-model';
import {ReportSummary} from './report-summary';
import {PiiSummary} from './report-pii';
import {DatasetOutcomeChart} from './report-charts';

export function ReportOverview({summary:s,datasets,cards,gradesAvailable,openChecks}:{summary:JsonObject;datasets:JsonObject;cards:DatasetCard[];gradesAvailable:boolean;openChecks:(filter:string,dataset?:string)=>void}){
  const groups=(Object.entries(datasets) as [string,JsonObject][]).sort((a,b)=>(b[1].failed??0)-(a[1].failed??0));
  return <>
    <ReportSummary summary={s} openChecks={openChecks}/>
    <PiiSummary summary={s} openChecks={openChecks}/>
    {groups.length>1&&<DatasetOutcomeChart groups={groups} cards={cards} openChecks={openChecks}/>}
    {groups.length>0&&<section className="dataset-results" aria-label="Results by Dataset">
      <div className="section-title"><h2>Dataset metrics <span>{groups.length}</span></h2></div>
      <div className="resource-list"><Table className="resource-table dataset-results-table"><Thead><Tr><Th>Dataset</Th><Th>Completed / planned</Th><Th>Accuracy</Th><Th>Precision</Th><Th>Recall</Th><Th>F1</Th><Th>Coverage</Th><Th>Unexpected</Th><Th>Errors</Th><Th>Actions</Th></Tr></Thead><Tbody>{groups.map(([name,v])=><Tr key={name}>
        <Td><DatasetIdentity id={name} cards={cards}/></Td><Td className="number">{count(v.completed)} / {count(v.plannedAttempts)}</Td>
        <Td><span className="accuracy-cell"><strong>{percent(v.accuracy)}</strong><span className="mini-meter"><i style={{width:typeof v.accuracy==='number'?Math.max(0,Math.min(100,v.accuracy*100))+'%':'0%'}}/></span><small>Scoring</small><small>Intervention {percent(v.classification?.accuracy)}</small>{v.pii&&<small>Complete redaction {percent(v.pii.completeRedactionRate)}</small>}</span></Td>
        <Td>{percent(v.precision)}</Td><Td>{percent(v.recall)}</Td><Td>{percent(v.f1)}</Td><Td>{percent(v.coverage)}</Td>
        <Td>{gradesAvailable?<Button variant="ghost" className={v.failed>0?'text-danger':''} onClick={()=>openChecks('unexpected',name)} aria-label={'View unexpected checks for '+name}>{count(v.failed)}</Button>:count(v.failed)}</Td>
        <Td className={v.errors>0?'text-warning':''}>{count(v.errors)}</Td><Td><Button variant="ghost" aria-label={'View checks for '+name} onClick={()=>openChecks('all',name)}>View</Button></Td>
      </Tr>)}</Tbody></Table></div>
    </section>}
    <Disclosure className="report-metric-definitions" label="Metric definitions and counts">
      <p>Overall metrics aggregate recorded checks across Datasets. Accuracy is the match rate under the selected scoring rules; errors, skipped and missing checks are excluded from its denominator.</p>
      <p>Intervention accuracy, precision, recall and F1 treat block or transform as an intervention, independently of scoring assertions. This includes uncertainty blocks and other protections; it does not prove a PII detector match. Complete redaction is assessed separately. Undefined rates show —.</p>
      <p>Precision = TP / (TP + FP) · Recall = TP / (TP + FN) · F1 = 2TP / (2TP + FP + FN).</p>
      <p>{count(s.classification?.truePositives)} true positives · {count(s.classification?.falsePositives)} false positives · {count(s.classification?.falseNegatives)} false negatives · {count(s.classification?.trueNegatives)} true negatives · {count(s.classification?.support)} labelled completed checks.</p>
    </Disclosure>
  </>;
}
