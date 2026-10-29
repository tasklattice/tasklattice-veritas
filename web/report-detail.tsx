import {isActiveRun} from '../src/shared/testing';
import {ReportActivity} from './report-activity';
import {RescoreForm} from './scoring-controls';
import type {ScorerConfig} from '../src/shared/scorer';
import {useEffect,useRef,useState} from 'react';
import {Tabs} from 'radix-ui';
import {Download,RefreshCw,X,AlertTriangle,RotateCcw,GitCompareArrows} from 'lucide-react';
import type {Case,DatasetCard,JsonObject,RunItem} from '../src/shared/types';
import {Button,NativeSelect,Table,Thead,Tbody,Tr,Th,Td,Sheet,SheetTitle,SheetDescription,DataPagination} from './ui';
import {api,adapterName} from './api';
import {time} from './format';
import {ReportStatus} from './report-list';
import {DeleteResource} from './resource-actions';
import {AdapterMark,DatasetIdentity,DatasetCollection,datasetName} from './brand';
import {PiiDetails} from './report-pii';
import {piiLabels,type PiiStatus} from '../src/shared/pii';
import {JevDetails} from './report-detection';
import {jevLabels,type JevStatus} from '../src/shared/detection';
import {ReportOverview} from './report-overview';
import {ReportEvidenceTab} from './report-evidence-tab';
import {ReportMetadata} from './report-metadata';
import {comparisonHref} from './report-workspace-model';
import {DecisionBadge,ActionComparison,PhaseLabel} from './report-evidence';
import {count,reportLabel,reportDetailLocation,type Evidence,type EvidencePage} from './report-model';
type Detail={run:RunItem;report:JsonObject|null;configuration:JsonObject|null;scoring?:{selectedId:string;versions:{id:string;name:string;createdAt:string;config:ScorerConfig;offline:boolean}[];config:ScorerConfig;canRescore:boolean;busy:boolean;offline:boolean}};

export function ReportDetail({id,scoringId,cards,refresh,notify}:{id:string;scoringId?:string;cards:DatasetCard[];refresh:()=>Promise<void>;notify:(message:string)=>void}){
  const[rescoring,setRescoring]=useState(false);
  const scoringQuery=scoringId?'?scoring='+encodeURIComponent(scoringId):'';
  const locationState=reportDetailLocation(new URLSearchParams(location.hash.split('?')[1]??''));
  const[detail,setDetail]=useState<Detail|null>(null),[tab,setTab]=useState(locationState.tab),[evidence,setEvidence]=useState<EvidencePage|null>(null);
  const[offset,setOffset]=useState(0),[size,setSize]=useState(50),[filter,setFilter]=useState(locationState.filter),[datasetFilter,setDatasetFilter]=useState(locationState.dataset),[error,setError]=useState(''),[evidenceError,setEvidenceError]=useState(''),[inspect,setInspect]=useState<Evidence|null>(null),[cancelling,setCancelling]=useState(false),[loading,setLoading]=useState(true),[nonce,setNonce]=useState(0);
  const checksTrigger=useRef<HTMLButtonElement>(null),reportHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(detail)reportHeading.current?.focus({preventScroll:true});},[detail?.run.id]);
  useEffect(()=>{setDetail(null);const saved=reportDetailLocation(new URLSearchParams(location.hash.split('?')[1]??''));setTab(saved.tab);setOffset(0);setFilter(saved.filter);setDatasetFilter(saved.dataset);setInspect(null);setCancelling(false);setEvidence(null);setError('');setEvidenceError('');},[id,scoringId]);
  useEffect(()=>{
    let alive=true,timer:ReturnType<typeof setTimeout>;setLoading(true);setEvidenceError('');
    async function load(){try{
      const result=await api<Detail>('/runs/'+id+scoringQuery);if(!alive)return;setDetail(result);setError('');
      const query=tab==='checks'?`offset=${offset}&limit=${size}&filter=${filter}&dataset=${encodeURIComponent(datasetFilter)}`:null;
      if(query){try{const page=await api<EvidencePage>(`/runs/${id}/attempts?${query}&scoring=${encodeURIComponent(result.scoring?.selectedId??'original')}`);if(!alive)return;setEvidence(page);}catch(e){if(alive)setEvidenceError((e as Error).message);}}
      if(!alive)return;setLoading(false);if(isActiveRun(result.run.status))timer=setTimeout(()=>void load(),1500);
    }catch(e){if(alive){setError((e as Error).message);setLoading(false);}}}
    void load();return()=>{alive=false;clearTimeout(timer);};
  },[id,scoringId,tab,offset,size,filter,datasetFilter,nonce]);
  function chooseTab(value:string){setTab(value);setInspect(null);const params=new URLSearchParams(location.hash.split('?')[1]??'');params.set('tab',value);window.history.replaceState(null,'','#/runs/'+id+'?'+params);}
  function openChecks(value='all',dataset=''){setFilter(value);setDatasetFilter(dataset);setOffset(0);chooseTab('checks');const params=new URLSearchParams(location.hash.split('?')[1]??'');params.set('checks',value);if(dataset)params.set('dataset',dataset);else params.delete('dataset');window.history.replaceState(null,'','#/runs/'+id+'?'+params);queueMicrotask(()=>checksTrigger.current?.focus());}
  if(!detail)return <div className="content"><div className="empty" role="status"><h2>{error?'Report unavailable':'Loading Report…'}</h2>{error&&<><p>{error}</p><Button variant="outline" onClick={()=>setNonce(n=>n+1)}>Retry</Button></>}</div></div>;
  const selectedScoringId=detail.scoring?.selectedId??'original',exportQuery='?scoring='+encodeURIComponent(selectedScoringId);
  const{run,report,configuration}=detail,s=report?.summary,datasetIds=run.datasetIds??[];
  const gradesAvailable=configuration?.gradesAvailable===true,active=isActiveRun(run.status),attempts=evidence?.items??[],evidenceCounts={all:evidence?.datasetTotal,unexpected:evidence?.unexpected,error:evidence?.errors,skipped:evidence?.skipped};
  return <div className="content report-detail">
    <header className="report-heading"><div className="report-title-group"><h1 ref={reportHeading} tabIndex={-1} title={run.name}>{reportLabel(run)}</h1><ReportStatus run={run}/></div><div className="resource-actions">{report&&!active&&<Button variant="outline" asChild><a href={comparisonHref([id],'history',[selectedScoringId])}><GitCompareArrows/>Compare reports</a></Button>}{report&&<Button variant="outline" asChild><a href={`/api/runs/${id}/files/results.csv${exportQuery}`} title="Export all checks as CSV"><Download/>Export CSV</a></Button>}<DeleteResource kind="Report" id={id} name={run.name} disabled={active||detail.scoring?.busy} onDelete={()=>api('/runs/'+id,undefined,'DELETE')} onSuccess={()=>{notify('Report deleted permanently.');void refresh();location.hash='/runs';}}/></div></header>
    <dl className="report-metadata-inline" aria-label="Report metadata"><div><dt>Target</dt><dd>{run.targetId?<a href={'#/targets/'+run.targetId}>{run.targetName??'Saved Target'}</a>:run.targetName??run.endpointName??'Historical Target'}</dd></div><div><dt>Datasets</dt><dd><DatasetCollection ids={datasetIds} cards={cards}/></dd></div><div><dt>Created</dt><dd>{time(run.createdAt)}</dd></div><div><dt>Adapter</dt><dd>{adapterName(run.adapter)}</dd></div></dl>
    {(error||run.error)&&<div className="notice error" role="alert">{error||run.error} <Button variant="ghost" onClick={()=>setNonce(n=>n+1)}>Retry</Button></div>}
    {active&&<ReportActivity id={id} run={run} cards={cards} cancelling={cancelling} cancel={()=>{setCancelling(true);void api(`/runs/${id}/cancel`,{}).then(()=>setNonce(n=>n+1)).catch(e=>{setError(e.message);setCancelling(false);});}} inspect={attemptId=>{void api<{attempt:Evidence}>(`/runs/${id}/attempts/${encodeURIComponent(attemptId)}?scoring=${encodeURIComponent(selectedScoringId)}`).then(result=>setInspect(result.attempt)).catch(e=>setError(e.message));}}/>}
    {run.evidence==='synthetic-local-demo'&&<div className="evidence-context-note"><AlertTriangle aria-hidden="true"/><span>Synthetic verification · mock Target results, not deployed Guard accuracy.</span></div>}
    {report&&!gradesAvailable&&<div className="evidence-context-note"><AlertTriangle aria-hidden="true"/><span>Historical scoring · saved summary retained; per-check grades are unavailable.</span></div>}


    {report&&detail.scoring&&<div className="results-scoring-toolbar"><div className="report-scoring-selection"><label title="Scoring rules determine pass/fail from saved responses. Switching versions does not call the Target.">Scoring<NativeSelect aria-label="Scoring version" value={selectedScoringId} disabled={loading} onChange={e=>{const p=new URLSearchParams(location.hash.split('?')[1]??'');p.set('scoring',e.target.value);p.set('tab',tab);location.hash='/runs/'+id+'?'+p;}}>{detail.scoring.versions.map((v,i)=><option key={v.id} value={v.id}>{i===0?'Original':'Version '+(i+1)} · {v.name}</option>)}</NativeSelect></label></div><div className="report-scoring-meta"><Button variant="outline" disabled={!detail.scoring.canRescore||detail.scoring.busy} title={detail.scoring.canRescore?undefined:'Requires a finished test with schema-3 request evidence'} onClick={()=>setRescoring(true)}><RotateCcw/>Re-score</Button><a href={'/api/runs/'+id+'/files/scorer.json'+exportQuery}>Download rules</a></div></div>}
    <Tabs.Root value={reportDetailLocation(new URLSearchParams({tab})).tab} onValueChange={chooseTab}><div className="detail-tabs-row"><Tabs.List className="detail-tabs" aria-label="Report sections"><Tabs.Trigger value="overview">Overview</Tabs.Trigger><Tabs.Trigger value="checks" ref={checksTrigger}>Results <span>{count(s?.recordedAttempts??run.progress?.completed??0)}</span></Tabs.Trigger><Tabs.Trigger value="evidence">Evidence</Tabs.Trigger><Tabs.Trigger value="configuration">Metadata</Tabs.Trigger></Tabs.List><Button variant="ghost" aria-label="Refresh Report" title="Refresh Report" disabled={loading} onClick={()=>setNonce(n=>n+1)}><RefreshCw/></Button></div>
    <Tabs.Content value="overview" className="detail-tab-panel">
      {s?<ReportOverview summary={s} datasets={report?.datasets??{}} cards={cards} gradesAvailable={gradesAvailable} openChecks={openChecks}/>:active?null:<div className="empty"><h2>No summary available</h2><p>Open Results to inspect the available request evidence.</p><Button variant="outline" onClick={()=>openChecks()}>View results</Button></div>}
    </Tabs.Content>
    <Tabs.Content value="checks" className="detail-tab-panel">

      <section className="resource-list evidence-list" aria-label="Request evidence">{!gradesAvailable&&<div className="historical-notice">{active?'Checks appear as requests finish. Final grades will be available after scoring completes.':'Historical scorer preserved. Per-check pass/fail is unavailable; inspect the recorded expected and observed actions. The saved summary is unchanged.'}</div>}
      <div className="evidence-filter-bar"><div className="check-filter-buttons" aria-label="Filter checks">{[{key:'all',label:'All checks'},{key:'unexpected',label:'Unexpected'},{key:'error',label:'Errors'},{key:'skipped',label:'Skipped'}].map(f=><Button key={f.key} variant={filter===f.key?'secondary':'ghost'} aria-pressed={filter===f.key} disabled={f.key==='unexpected'&&!gradesAvailable} onClick={()=>openChecks(f.key,datasetFilter)}>{f.label}<span className={f.key==='unexpected'&&(evidenceCounts.unexpected??0)>0?'text-danger':''}>{count(evidenceCounts[f.key as keyof typeof evidenceCounts])}</span></Button>)}</div>{datasetIds.length>1&&<label className="evidence-dataset-filter"><NativeSelect aria-label="Filter checks by Dataset" value={datasetFilter} onChange={e=>openChecks(filter,e.target.value)}><option value="">All Datasets</option>{datasetIds.map(value=><option key={value} value={value}>{datasetName(cards.find(c=>c.id===value)??{id:value,name:value})}</option>)}</NativeSelect></label>}</div>
      <div className="evidence-result-count"><span role="status">{loading?'Loading checks…':`${count(evidence?.total)} matching / ${count(evidence?.datasetTotal)} in scope · ${count(evidence?.allTotal)} recorded in this Report`}</span><span>{filter.startsWith('pii-')?'PII: '+piiLabels[filter.slice(4) as PiiStatus]:filter.startsWith('jev-')?'JEV: '+jevLabels[filter.slice(4) as JevStatus]:''}</span></div>
      {evidenceError?<div className="empty"><h3>Request evidence unavailable</h3><p role="alert">{evidenceError}</p><Button variant="outline" onClick={()=>setNonce(n=>n+1)}>Retry checks</Button></div>:<><Table className="resource-table request-evidence-table" aria-busy={loading}><Thead><Tr><Th>Request</Th><Th>Direction</Th><Th>Expected → observed</Th><Th>Result</Th><Th>Latency</Th><Th>Actions</Th></Tr></Thead><Tbody>{!loading&&attempts.map(a=><Tr className={a.status==='completed'&&a.grade?.pass===false?'unexpected-evidence-row':undefined} key={a.attemptId}><Td><div className="request-row-meta"><DatasetIdentity id={a.dataset} cards={cards}/><span className="request-case-id" title={a.caseId}>{a.caseId}</span></div><p className="request-text">{a.samplePreview??a.caseId}{a.sampleTruncated?'…':''}</p>{a.status!=='completed'&&<small>{a.error??a.skipReason}</small>}</Td><Td><PhaseLabel phase={a.phase}/></Td><Td><ActionComparison attempt={a}/></Td><Td><DecisionBadge attempt={a}/></Td><Td className="number">{a.latencyMs?.toFixed(1)??'—'} ms</Td><Td><Button variant="ghost" onClick={()=>setInspect(a)} aria-label={'Inspect check '+a.caseId+' '+a.attemptId}>Inspect</Button></Td></Tr>)}</Tbody></Table>
      {(loading||!attempts.length)&&<div className="empty evidence-empty" role="status"><h3>{loading?'Loading checks…':'No checks match the selected filters.'}</h3>{!loading&&(filter!=='all'||datasetFilter)&&<Button variant="outline" onClick={()=>openChecks()}>Show all checks</Button>}</div>}
      <DataPagination key={id+datasetFilter+filter+size} offset={offset} limit={size} total={evidence?.total??0} busy={loading} onChange={(o,n)=>{setOffset(o);setSize(n);setInspect(null);}}/>
      </>}</section></Tabs.Content>
    <Tabs.Content value="evidence" className="detail-tab-panel">{s?<ReportEvidenceTab id={id} scoringId={selectedScoringId} run={run} summary={s} cards={cards} inspect={setInspect} activity={<ReportActivity id={id} run={run} cards={cards} cancelling={cancelling} cancel={()=>{setCancelling(true);void api(`/runs/${id}/cancel`,{}).then(()=>setNonce(n=>n+1)).catch(e=>{setError(e.message);setCancelling(false);});}} inspect={attemptId=>{void api<{attempt:Evidence}>(`/runs/${id}/attempts/${encodeURIComponent(attemptId)}?scoring=${encodeURIComponent(selectedScoringId)}`).then(result=>setInspect(result.attempt)).catch(e=>setError(e.message));}}/>}/>:<div className="empty"><h3>Evidence is not available yet</h3><p>Open Results for checks that have finished.</p><Button variant="outline" onClick={()=>openChecks()}>View results</Button></div>}</Tabs.Content>
    <Tabs.Content value="configuration" className="detail-tab-panel"><ReportMetadata id={id} run={run} report={report} configuration={configuration} cards={cards} scoringName={detail.scoring?.versions.find(v=>v.id===selectedScoringId)?.name??'Not recorded'} offline={detail.scoring?.offline??false} exportQuery={exportQuery}/></Tabs.Content>
    </Tabs.Root>{rescoring&&<RescoreForm id={id} initial={detail.scoring?.config} close={()=>setRescoring(false)} done={version=>{setRescoring(false);location.hash='/runs/'+id+'?tab=checks&scoring='+encodeURIComponent(version);notify('Saved results re-scored. No additional Target calls.');void refresh();}}/>}{inspect&&<EvidenceDialog active={active} id={id} scoringId={selectedScoringId} attempt={inspect} close={()=>setInspect(null)}/>}</div>;
}

export function EvidenceDialog({id,scoringId,attempt,close,active}:{active:boolean;id:string;scoringId:string;attempt:Evidence;close:()=>void}){
  const[data,setData]=useState<{attempt:Evidence;sample:Case|null}|null>(null),[error,setError]=useState(''),[nonce,setNonce]=useState(0);
  useEffect(()=>{let alive=true;void api<{attempt:Evidence;sample:Case|null}>(`/runs/${id}/attempts/${encodeURIComponent(attempt.attemptId)}?scoring=${encodeURIComponent(scoringId)}`).then(d=>{if(alive){setData(d);setError('');}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[id,scoringId,attempt.attemptId,nonce]);
  const sample=data?.sample,a=data?.attempt??attempt;
  return <Sheet onClose={close} className="evidence-sheet"><div className="dialog-header"><div><SheetTitle>Check details</SheetTitle><SheetDescription className="case-id">{a.caseId}</SheetDescription></div><Button variant="ghost" onClick={close} aria-label="Close check details"><X/></Button></div><div className="dialog-body">
    <div className="evidence-verdict"><DecisionBadge attempt={a}/><div><span className="help">Expected → observed</span><ActionComparison attempt={a}/></div></div><div className="check-facts"><div><span>Dataset</span><strong>{a.dataset}</strong></div><div><span>Direction</span><PhaseLabel phase={a.phase}/></div><div><span>Latency</span><strong>{a.latencyMs?.toFixed(1)??'—'} ms</strong></div><div><span>Adapter</span><span className="adapter-label"><AdapterMark adapter={a.adapter}/>{adapterName(a.adapter)}</span></div></div><p className="check-reason">{a.grade?.reason??a.error??a.skipReason??(active?'Scoring pending. The observed action and request evidence are available now.':'This historical check has no compatible per-check grade.')}</p>
    <PiiDetails attempt={a}/><JevDetails attempt={a}/>
    {a.grade?.components&&<ul className="check-grade-components" aria-label="Scoring checks">{a.grade.components.map((c,i)=><li key={i}><strong className={c.pass?'text-success':'text-danger'}>{c.pass?'Pass':'Fail'} · {c.name}</strong><span>{c.reason}</span></li>)}</ul>}
    {error&&<div className="notice error" role="alert">{error}<Button variant="ghost" onClick={()=>setNonce(n=>n+1)}>Retry</Button></div>}
    {!data&&!error&&<p role="status">Loading the saved sample…</p>}
    {sample&&<><h3>Test text</h3><pre>{sample.text}</pre>{sample.prompt&&<><h3>Original prompt</h3><pre>{sample.prompt}</pre></>}</>}
    <h3>Request &amp; response</h3>{a.steps?.map((step,i)=><details className="evidence-step" key={i} open><summary>{i+1}. {step.phase} · HTTP {step.httpStatus??'—'} · {step.latencyMs.toFixed(1)} ms</summary><h4>Request</h4><pre>{JSON.stringify(step.request,null,2)}</pre><h4>Response</h4><pre>{JSON.stringify(step.response??{error:step.error??'No response'},null,2)}</pre></details>)}
    <details className="evidence-step"><summary>Raw evidence</summary><pre>{JSON.stringify({attempt:a,sample},null,2)}</pre></details><p className="help">Sample text is untrusted source data. Credentials are excluded from recorded requests.</p>
  </div></Sheet>;
}
