import {isActiveRun} from '../src/shared/testing';
import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Activity,ArrowRight,RefreshCw,Check} from 'lucide-react';
import type {RunActivity,ActivityEntry} from '../src/shared/activity';
import type {DatasetCard,RunItem} from '../src/shared/types';
import {api} from './api';
import {Button} from './ui';
import {DatasetIdentity} from './brand';
import {PhaseLabel} from './report-evidence';
import {count} from './report-model';

const stages: Record<ActivityEntry['stage'],string> = {'starting':'Starting check','preparing-input':'Preparing input for response check','scanning-input':'Scanning input','scanning-output':'Scanning saved response'};
export function ReportActivity({id,run,cards,cancelling,cancel,inspect}:{id:string;run:RunItem;cards:DatasetCard[];cancelling:boolean;cancel:()=>void;inspect:(attemptId:string)=>void}) {
  const active = isActiveRun(run.status);
  const query = useQuery({queryKey:['run-activity',id,active],queryFn:({signal})=>api<RunActivity>('/runs/'+id+'/activity',undefined,'GET',signal),
    staleTime:0,refetchInterval:active?1000:false});
  const [now,setNow] = useState(Date.now());
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active]);
  const a=query.data;
  if(!active&&!a?.available)return query.isPending||run.status==='completed'?null:run.stage?<section className="report-activity" aria-label="Preparation outcome"><h2>{run.status==='cancelled'?'Test cancelled':run.status==='interrupted'?'Test interrupted':'Preparation stopped'}</h2><p className="help">{run.stage.message} No request evidence was recorded.</p>{run.stage.preparation&&<p className="help">{count(run.stage.preparation.scannedRows)} rows read · {count(run.stage.preparation.convertedCases)} cases converted</p>}</section>:null;
  const serverNow = now + (a ? Date.parse(a.serverTime) - query.dataUpdatedAt : 0);
  const elapsed=(start:string)=>Math.max(0,Math.floor((serverNow-Date.parse(start))/1000));
  const total=a?.total||run.progress?.total||0,done=a?.finished??run.progress?.completed??0;
  const stage=a?.stage??run.stage,preparing=run.status==='preparing'||stage?.stage==='preparing',prep=stage?.preparation;
  const finalizing=run.status==='scoring'||a?.phase==='finalizing',queued=run.status==='queued';
  const phaseIndex=preparing?0:queued?0:finalizing?2:1;
  const title=cancelling?'Stopping active requests…':queued?'Waiting to start':preparing?'Preparing Datasets':finalizing?(stage?.stage==='reporting'?'Generating the Report':'Scoring and saving results'):'Testing in progress';
  const recent=<div className="activity-recent"><div className="activity-subheading"><h3>Recently finished</h3><span>Latest {a?.recent.length??0} checks · observed actions</span></div>
    {a?.recent.length?<div className="activity-recent-list">{a.recent.map(row=><button key={row.attemptId} className="activity-finished-row" onClick={()=>inspect(row.attemptId)} aria-label={'Inspect finished check '+row.caseId+' '+row.attemptId}>
      <span><DatasetIdentity id={row.dataset} cards={cards}/><small>Case {row.caseNumber} · Repeat {row.repeat}/{row.repeats} · {row.phase}</small><span className="activity-preview">{row.samplePreview}</span></span>
      <span className={'activity-action '+(row.status==='error'?'text-danger':'')}>{row.status==='completed'?row.action:row.status}<small>{row.latencyMs==null?'—':(row.latencyMs/1000).toFixed(1)+' s'}</small></span><ArrowRight aria-hidden="true"/>
    </button>)}</div>:<p className="help">{active?'Waiting for the first request to finish.':'No finished checks were recorded.'}</p>}
    <p className="help activity-footnote">{active?'Live actions are not final grades. Scoring and the full request evidence are saved in this Report.':'Showing the latest 20 finished checks. Open Checks for the complete request evidence.'}</p></div>;
  if(!active)return <details className="execution-history"><summary><Activity aria-hidden="true"/>Execution history <span>{count(a?.finished)} checks finished</span></summary>{!!run.stageHistory?.length&&<ol className="report-stage-history" aria-label="Recorded testing stages">{run.stageHistory!.filter(s=>s.stage!=='queued'&&s.stage!=='finished').map(s=><li key={s.stage}><strong>{s.stage==='preparing'?'Prepare Datasets':s.stage==='running'?'Execute checks':s.stage==='scoring'?'Save scoring results':'Generate Report'}</strong><span>{s.message}</span><small>{s.stage==='preparing'?`${count(s.preparation?.scannedRows)} rows read · ${count(s.preparation?.selectedCases)} cases selected`:s.total!=null?`${count(s.completed)} / ${count(s.total)}`:''}<time dateTime={s.updatedAt}>{new Date(s.updatedAt).toLocaleTimeString('en-GB')}</time></small></li>)}</ol>}{recent}</details>;
  return <section className="report-activity" aria-label="Live test activity">
    <div className="activity-heading"><div><h2><Activity aria-hidden="true"/>{title}</h2><p>{preparing?stage?.message??'Reading local source files':queued?'Your Report is ready. Waiting for the local runner.':finalizing?stage?.message??'Saving promptfoo grades':count(done)+' / '+count(total)+' checks finished'}{!preparing&&!finalizing&&a?.available?` · ${count(a.active.length)} active · ${count(a.errors)} errors · ${count(a.skipped)} skipped`:''}</p></div><Button variant="outline" disabled={cancelling} onClick={cancel}>{cancelling?'Cancelling…':'Cancel test'}</Button></div>
    <ol className="report-stage-strip" aria-label="Testing stages">{['Prepare Datasets','Execute checks','Score & report'].map((label,i)=><li key={label} aria-current={i===phaseIndex?'step':undefined} data-state={i<phaseIndex?'complete':i===phaseIndex?'current':'pending'}><span>{i<phaseIndex?<Check aria-hidden="true"/>:i+1}</span>{label}</li>)}</ol>
    {preparing?<><progress aria-label="Prepared source files" max={prep?.filesTotal??1} value={prep?.filesCompleted??0}/><div className="preparation-facts" role="status"><strong>{prep?.dataset?<DatasetIdentity id={prep.dataset} cards={cards}/>:stage?.message}</strong><span>Dataset {prep?.datasetIndex??'—'} / {prep?.datasets??run.datasetIds?.length}</span><span>{count(prep?.scannedRows)} rows read</span><span>{count(prep?.convertedCases)} cases converted</span><span>{count(prep?.selectedCases)} cases selected</span>{prep?.file&&<code>{prep.file}</code>}</div><p className="help">Random and stratified samples read the complete source scope before selecting cases. No Target requests are sent during preparation.</p></>:finalizing?<progress aria-label="Saved scoring results" max={stage?.total||1} value={stage?.completed??0}/>:!queued&&<progress aria-label="Finished checks" max={total||1} value={done}/>}

    {query.isError&&<div className="activity-error" role="alert">Activity updates unavailable. {query.error.message}<Button variant="ghost" onClick={()=>void query.refetch()}><RefreshCw/>Retry</Button></div>}
    {a&&<span className="activity-update">Updated {Math.max(0,Math.floor((now-query.dataUpdatedAt)/1000))} s ago · refreshes every second</span>}
    {preparing||finalizing?null:queued?<p className="activity-wait">Queue position {a?.queuePosition??'—'}. Waiting for the current test to release the runner. No requests have been sent.</p>:!a?.active.length?<p className="activity-wait" role="status">{finalizing?'All Target calls have returned. promptfoo is finishing scoring and the Report.':'Starting promptfoo and waiting for the first check…'}</p>:<>
      <div className="activity-subheading"><h3>Executing now <span>{a.active.length} / {a.concurrency} concurrent</span></h3><span>Per-request timeout {Math.round((a.timeoutMs??30000)/1000)} s</span></div>
      <div className="active-checks">{a.active.map(row=><div className="active-check" key={row.attemptId}>
        <div className="active-check-main"><div className="active-check-meta"><DatasetIdentity id={row.dataset} cards={cards}/><span>Case {row.caseNumber} / {a.caseCount} · Repeat {row.repeat}/{row.repeats}</span><PhaseLabel phase={row.phase}/></div><p className="activity-preview">{row.samplePreview}</p><code>{row.caseId}</code></div>
        <div className="active-check-stage"><strong>{stages[row.stage]}</strong><span>{elapsed(row.stageStartedAt)} s in this stage · {elapsed(row.startedAt)} s total</span>{elapsed(row.stageStartedAt)>=10&&<small className="text-warning">Waiting for the Target response</small>}</div>
      </div>)}</div></>}
    {!preparing&&!queued&&recent}
  </section>;
}
