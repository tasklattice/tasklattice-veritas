import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Activity,ArrowRight,RefreshCw} from 'lucide-react';
import type {RunActivity,ActivityEntry} from '../src/shared/activity';
import type {DatasetCard,RunItem} from '../src/shared/types';
import {api} from './api';
import {Button} from './ui';
import {DatasetIdentity} from './brand';
import {PhaseLabel} from './report-evidence';
import {count} from './report-model';

const stages: Record<ActivityEntry['stage'],string> = {'starting':'Starting check','preparing-input':'Preparing input for response check','scanning-input':'Scanning input','scanning-output':'Scanning saved response'};
export function ReportActivity({id,run,cards,cancelling,cancel,inspect}:{id:string;run:RunItem;cards:DatasetCard[];cancelling:boolean;cancel:()=>void;inspect:(attemptId:string)=>void}) {
  const active = ['queued','running'].includes(run.status);
  const query = useQuery({queryKey:['run-activity',id,active],queryFn:({signal})=>api<RunActivity>('/runs/'+id+'/activity',undefined,'GET',signal),
    staleTime:0,refetchInterval:active?1000:false});
  const [now,setNow] = useState(Date.now());
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active]);
  const a=query.data;
  if(!active&&!a?.available)return null;
  const serverNow = now + (a ? Date.parse(a.serverTime) - query.dataUpdatedAt : 0);
  const elapsed=(start:string)=>Math.max(0,Math.floor((serverNow-Date.parse(start))/1000));
  const total=a?.total||run.progress?.total||0,done=a?.finished??run.progress?.completed??0;
  const finalizing=a?.phase==='finalizing',queued=run.status==='queued';
  const title=cancelling?'Stopping active requests…':queued?'Waiting to start':finalizing?'Scoring checks and preparing the Report':'Testing in progress';
  const recent=<div className="activity-recent"><div className="activity-subheading"><h3>Recently finished</h3><span>Latest {a?.recent.length??0} checks · observed actions</span></div>
    {a?.recent.length?<div className="activity-recent-list">{a.recent.map(row=><button key={row.attemptId} className="activity-finished-row" onClick={()=>inspect(row.attemptId)} aria-label={'Inspect finished check '+row.caseId+' '+row.attemptId}>
      <span><DatasetIdentity id={row.dataset} cards={cards}/><small>Case {row.caseNumber} · Repeat {row.repeat}/{row.repeats} · {row.phase}</small><span className="activity-preview">{row.samplePreview}</span></span>
      <span className={'activity-action '+(row.status==='error'?'text-danger':'')}>{row.status==='completed'?row.action:row.status}<small>{row.latencyMs==null?'—':(row.latencyMs/1000).toFixed(1)+' s'}</small></span><ArrowRight aria-hidden="true"/>
    </button>)}</div>:<p className="help">{active?'Waiting for the first request to finish.':'No finished checks were recorded.'}</p>}
    <p className="help activity-footnote">{active?'Live actions are not final grades. Scoring and the full request evidence are saved in this Report.':'Showing the latest 20 finished checks. Open Checks for the complete request evidence.'}</p></div>;
  if(!active)return <details className="execution-history"><summary><Activity aria-hidden="true"/>Execution history <span>{count(a?.finished)} checks finished</span></summary>{recent}</details>;
  return <section className="report-activity" aria-label="Live test activity">
    <div className="activity-heading"><div><h2><Activity aria-hidden="true"/>{title}</h2><p>{count(done)} / {count(total)} checks finished{a?.available?` · ${count(a.active.length)} active · ${count(a.errors)} errors · ${count(a.skipped)} skipped`:''}</p></div><Button variant="outline" disabled={cancelling} onClick={cancel}>{cancelling?'Cancelling…':'Cancel test'}</Button></div>
    <progress aria-label="Finished checks" max={total||1} value={done}/>
    {query.isError&&<div className="activity-error" role="alert">Activity updates unavailable. {query.error.message}<Button variant="ghost" onClick={()=>void query.refetch()}><RefreshCw/>Retry</Button></div>}
    {a&&<span className="activity-update">Updated {Math.max(0,Math.floor((now-query.dataUpdatedAt)/1000))} s ago · refreshes every second</span>}
    {queued?<p className="activity-wait">Queue position {a?.queuePosition??'—'}. Waiting for the current test to release the runner. No requests have been sent.</p>:!a?.active.length?<p className="activity-wait" role="status">{finalizing?'All Target calls have returned. promptfoo is finishing scoring and the Report.':'Starting promptfoo and waiting for the first check…'}</p>:<>
      <div className="activity-subheading"><h3>Executing now <span>{a.active.length} / {a.concurrency} concurrent</span></h3><span>Per-request timeout {Math.round((a.timeoutMs??30000)/1000)} s</span></div>
      <div className="active-checks">{a.active.map(row=><div className="active-check" key={row.attemptId}>
        <div className="active-check-main"><div className="active-check-meta"><DatasetIdentity id={row.dataset} cards={cards}/><span>Case {row.caseNumber} / {a.caseCount} · Repeat {row.repeat}/{row.repeats}</span><PhaseLabel phase={row.phase}/></div><p className="activity-preview">{row.samplePreview}</p><code>{row.caseId}</code></div>
        <div className="active-check-stage"><strong>{stages[row.stage]}</strong><span>{elapsed(row.stageStartedAt)} s in this stage · {elapsed(row.startedAt)} s total</span>{elapsed(row.stageStartedAt)>=10&&<small className="text-warning">Waiting for the Target response</small>}</div>
      </div>)}</div></>}
    {recent}
  </section>;
}
