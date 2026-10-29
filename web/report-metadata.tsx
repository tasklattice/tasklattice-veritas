import {useState} from 'react';
import {ArrowUpRight,ChevronRight,FileJson,FileText,X} from 'lucide-react';
import type {DatasetCard,JsonObject,RunItem} from '../src/shared/types';
import {Button,Table,Thead,Tbody,Tr,Th,Td,Sheet,SheetTitle,SheetDescription,Disclosure} from './ui';
import {adapterName} from './api';
import {DatasetIdentity,datasetName} from './brand';
import {count} from './report-model';
import {ReportThresholds} from './report-thresholds';
import {reportSampling,reportSource} from './report-metadata-model';

export function ReportMetadata({id,run,report,configuration,cards,scoringName,offline,exportQuery}:{id:string;run:RunItem;report:JsonObject|null;configuration:JsonObject|null;cards:DatasetCard[];scoringName:string;offline:boolean;exportQuery:string}){
  const sources=(configuration?.sources??[]).map(reportSource) as ReturnType<typeof reportSource>[];
  const [selected,setSelected]=useState<ReturnType<typeof reportSource>|null>(null);
  const notes=[...new Set<string>([...(report?.benchmark?.warnings??[]),...(report?.caveats??[])])];
  return <div className="report-metadata-workspace">
    <div className="metadata-top-grid">
      <section className="metadata-configuration" aria-label="Test configuration"><h2>Test configuration</h2>
        {configuration?<dl className="metadata-facts">
          <div><dt>Cases</dt><dd>{count(configuration.caseCount)}</dd></div><div><dt>Repeats</dt><dd>{count(configuration.repeat)}</dd></div>
          <div><dt>Concurrency</dt><dd>{count(configuration.concurrency)}</dd></div><div><dt>Sampling</dt><dd>{reportSampling(configuration,sources)}</dd></div>
          <div><dt>Test focus</dt><dd>{report?.benchmark?.label??configuration.testPurpose??'Endpoint decisions'}</dd></div><div><dt>Scoring rules</dt><dd>{scoringName}</dd></div>
          <div><dt>Adapter</dt><dd>{adapterName(configuration.target?.adapter)}</dd></div><div><dt>Output mode</dt><dd>{configuration.target?.outputMode??'Not recorded'}</dd></div>
          <div className="metadata-full-width"><dt>Runtime URL</dt><dd className="metadata-runtime-url">{configuration.target?.url??'Not recorded'}</dd></div>
        </dl>:<p className="historical-notice">Test configuration unavailable.</p>}
      </section>
      <ReportThresholds run={run} configuration={configuration} offline={offline}/>
    </div>
    {sources.length>0&&<section className="metadata-sources" aria-label="Dataset provenance"><div className="metadata-section-heading"><h2>Dataset snapshots <span>{sources.length}</span></h2></div>
      <Table className="resource-table metadata-sources-table"><Thead><Tr><Th>Dataset</Th><Th>Scope</Th><Th>Cases</Th><Th>Revision</Th><Th>License</Th><Th><span className="visually-hidden">Upstream source</span></Th></Tr></Thead><Tbody>{sources.map((source,i)=><Tr key={source.id+'-'+i}>
        <Td><DatasetIdentity id={source.id} cards={cards}/></Td><Td><Button variant="ghost" className="metadata-scope-button" aria-label={'View source details for '+source.id} onClick={()=>setSelected(source)}>{source.scope}<ChevronRight aria-hidden="true"/></Button></Td>
        <Td className="number">{count(source.cases)}</Td><Td><code title={source.revision??undefined}>{source.revision?String(source.revision).slice(0,12):'—'}</code></Td><Td>{source.license??'—'}</Td><Td>{source.url&&<a className="metadata-upstream-link" href={source.url} target="_blank" rel="noreferrer">Source<ArrowUpRight aria-hidden="true"/></a>}</Td>
      </Tr>)}</Tbody></Table>
    </section>}
    <div className="metadata-secondary">
      <Disclosure className="metadata-disclosure" label="Technical details"><dl className="metadata-facts">
        <div className="metadata-full-width"><dt>Report ID</dt><dd className="report-run-name">{run.name}</dd></div><div><dt>Original scorer</dt><dd>{configuration?.scorer??'Not recorded'}</dd></div><div><dt>Engine</dt><dd>{configuration?.engine?.name??'Not recorded'}{configuration?.engine?.version?' · '+configuration.engine.version:''}</dd></div>
      </dl></Disclosure>
      {(notes.length>0||report?.benchmark?.metricScope)&&<Disclosure className="metadata-disclosure" label={<>Measurement notes <span>{notes.length||''}</span></>}>{report?.benchmark?.metricScope&&<p>{report.benchmark.metricScope}</p>}{notes.length>0&&<ul>{notes.map(note=><li key={note}>{note}</li>)}</ul>}</Disclosure>}
      {report&&<section className="metadata-downloads" aria-label="Report files"><span>Files</span><a href={`/api/runs/${id}/files/report.json${exportQuery}`}><FileJson aria-hidden="true"/>JSON</a><a href={`/api/runs/${id}/files/report.md${exportQuery}`}><FileText aria-hidden="true"/>Markdown</a></section>}
    </div>
    {selected&&<SourceDetails source={selected} cards={cards} close={()=>setSelected(null)}/>}
  </div>;
}
function SourceDetails({source,cards,close}:{source:ReturnType<typeof reportSource>;cards:DatasetCard[];close:()=>void}){
  const [raw,setRaw]=useState(false),card=cards.find(c=>c.id===source.id);
  return <Sheet className="source-snapshot-sheet" onClose={close}><div className="dialog-header"><div><SheetTitle>{card?datasetName(card):source.id}</SheetTitle><SheetDescription>Dataset snapshot</SheetDescription></div><Button variant="ghost" aria-label="Close source details" onClick={close}><X/></Button></div><div className="dialog-body">
    <dl className="metadata-facts"><div><dt>Scope</dt><dd>{source.scope}</dd></div><div><dt>Direction</dt><dd>{source.phase==='input'?'Input':source.phase==='output'?'Saved response':source.phase??'Not recorded'}</dd></div><div><dt>Selected cases</dt><dd>{count(source.cases)}</dd></div><div><dt>Seed</dt><dd>{count(source.selection?.seed)}</dd></div><div className="metadata-full-width"><dt>Sampling</dt><dd>{source.selection?.method??source.selection?.algorithm??'Not recorded'}</dd></div><div className="metadata-full-width"><dt>Revision</dt><dd className="report-run-name">{source.revision??'Not recorded'}</dd></div></dl>
    {source.files.length>0&&<section><h3>Source files <span>{source.files.length}</span></h3><Table className="resource-table"><Thead><Tr><Th>File</Th><Th>SHA-256</Th></Tr></Thead><Tbody>{source.files.map((file:JsonObject,i:number)=><Tr key={i}><Td>{file.file??file.path??file.name??'File '+(i+1)}</Td><Td><code title={file.sha256}>{file.sha256?String(file.sha256).slice(0,16):'—'}</code></Td></Tr>)}</Tbody></Table></section>}
    <Disclosure className="metadata-disclosure" label="Raw snapshot" onToggle={e=>setRaw(e.currentTarget.open)}>{raw&&<pre>{JSON.stringify(source.raw,null,2)}</pre>}</Disclosure>
  </div></Sheet>;
}
