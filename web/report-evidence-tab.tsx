import {useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {RefreshCw} from 'lucide-react';
import type {DatasetCard,JsonObject,RunItem} from '../src/shared/types';
import {jevLabels} from '../src/shared/detection';
import {piiLabels} from '../src/shared/pii';
import {api} from './api';
import {Button,NativeSelect,Table,Thead,Tbody,Tr,Th,Td,DataPagination} from './ui';
import {JevBadge,JevSummary} from './report-detection';
import {PiiSummary} from './report-pii';
import {DatasetIdentity,datasetName} from './brand';
import {PhaseLabel} from './report-evidence';
import {count,type Evidence,type EvidencePage} from './report-model';

export function ReportEvidenceTab({id,scoringId,run,summary,cards,activity,inspect}:{id:string;scoringId:string;run:RunItem;summary:JsonObject;cards:DatasetCard[];activity:ReactNode;inspect:(attempt:Evidence)=>void}){
  const [view,setView]=useState('model'),[filter,setFilter]=useState('all'),[dataset,setDataset]=useState(''),[offset,setOffset]=useState(0),[size,setSize]=useState(25);
  const hasPii=summary.pii&&(summary.pii.positiveCases>0||summary.pii.controlCompleted>0);
  const params=new URLSearchParams({filter,dataset,offset:String(offset),limit:String(size),scoring:scoringId});
  const query=useQuery({queryKey:['report-model-evidence',id,scoringId,view,filter,dataset,offset,size],queryFn:({signal})=>api<EvidencePage>('/runs/'+id+'/attempts?'+params,undefined,'GET',signal),enabled:view!=='execution'});
  const labels=view==='pii'?piiLabels:jevLabels,prefix=view==='pii'?'pii-':'jev-';
  function selectView(value:string){setView(value);setFilter('all');setDataset('');setOffset(0);}
  function selectFilter(value:string){setFilter(value);setOffset(0);}
  return <div className="report-evidence-workspace">
    <div className="evidence-kind-tabs" aria-label="Evidence types"><Button variant="ghost" aria-pressed={view==='model'} onClick={()=>selectView('model')}>Model verdicts</Button>{hasPii&&<Button variant="ghost" aria-pressed={view==='pii'} onClick={()=>selectView('pii')}>PII redaction</Button>}<Button variant="ghost" aria-pressed={view==='execution'} onClick={()=>selectView('execution')}>Execution history</Button></div>
    {view==='execution'?<section className="report-execution-evidence" aria-label="Execution evidence">{activity}</section>:<>
      {view==='model'?(summary.jev?<JevSummary summary={summary} openChecks={selectFilter}/>:<p className="historical-notice">Model verdicts were not recorded for this Report. Final Guard actions are preserved below.</p>):<PiiSummary summary={summary} openChecks={selectFilter}/>}
      <section className="resource-list model-evidence-list" aria-label={view==='pii'?'Recorded redaction evidence':'Recorded model evidence'}><div className="model-evidence-tools"><label>Verdict<NativeSelect aria-label="Filter evidence by verdict" value={filter} onChange={e=>selectFilter(e.target.value)}><option value="all">All recorded checks</option>{Object.entries(labels).map(([key,label])=><option key={key} value={prefix+key}>{label}</option>)}</NativeSelect></label>{(run.datasetIds?.length??0)>1&&<label><NativeSelect aria-label="Filter evidence by Dataset" value={dataset} onChange={e=>{setDataset(e.target.value);setOffset(0);}}><option value="">All Datasets</option>{run.datasetIds!.map(id=><option key={id} value={id}>{datasetName(cards.find(c=>c.id===id)??{id,name:id})}</option>)}</NativeSelect></label>}<span role="status">{query.isFetching?'Loading evidence…':count(query.data?.total)+' checks'}</span><Button variant="ghost" aria-label="Refresh evidence" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw/></Button></div>
        {query.error?<div className="empty"><h3>Evidence unavailable</h3><p role="alert">{query.error.message}</p><Button variant="outline" onClick={()=>void query.refetch()}>Retry evidence</Button></div>:<><Table className="resource-table model-evidence-table" aria-busy={query.isFetching}><Thead><Tr><Th>Request</Th><Th>{view==='pii'?'Redaction evidence':'Model verdict'}</Th><Th>Guard action</Th><Th><span className="visually-hidden">Inspect evidence</span></Th></Tr></Thead><Tbody>{query.data?.items.map(attempt=><Tr key={attempt.attemptId}><Td><div className="request-row-meta"><DatasetIdentity id={attempt.dataset} cards={cards}/><PhaseLabel phase={attempt.phase}/></div><p className="request-text">{attempt.samplePreview??attempt.caseId}{attempt.sampleTruncated?'…':''}</p><small className="request-case-id">{attempt.caseId}</small></Td><Td>{view==='model'?<JevBadge attempt={attempt}/>:attempt.pii?piiLabels[attempt.pii.status]:'Unavailable'}</Td><Td><span className="decision-action">{attempt.status==='completed'?attempt.action??'Unavailable':attempt.status}</span></Td><Td><Button variant="ghost" onClick={()=>inspect(attempt)} aria-label={'Inspect model evidence '+attempt.attemptId}>Inspect</Button></Td></Tr>)}</Tbody></Table>{!query.data?.items.length&&<div className="empty" role="status"><h3>{query.isPending?'Loading evidence…':'No recorded checks match this verdict.'}</h3>{!query.isPending&&filter!=='all'&&<Button variant="outline" onClick={()=>selectFilter('all')}>Show all evidence</Button>}</div>}<DataPagination key={view+filter+dataset+size} offset={offset} limit={size} total={query.data?.total??0} busy={query.isFetching} onChange={(o,n)=>{setOffset(o);setSize(n);}}/></>}
      </section>
    </>}
  </div>;
}
