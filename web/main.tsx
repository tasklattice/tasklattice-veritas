import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClientProvider,useQuery} from '@tanstack/react-query';
import {queryClient,queryKeys,datasetListOptions,targetListOptions,runListOptions} from './query';
import {FileChartColumn,Database,Cable,PanelLeft,ChevronRight,ShieldCheck} from 'lucide-react';
import type {DatasetCard,TargetItem,RunItem} from '../src/shared/types';
import {Button} from './ui';
import {ProductMark,datasetName} from './brand';
import {DatasetBrowser,DatasetDetail} from './dataset-browser';
import {TargetPage} from './targets';
import {ReportList} from './report-list';
import {ReportDetail} from './report-detail';
import {ReportCompareWorkspace} from './report-compare-workspace';
import {legacyReportComparisonHref} from './report-workspace-model';
import {TestingForm} from './testing-form';
import type {TestingInitial} from './testing-model';
import {ThemeControl} from './theme';
import {ToastProvider,useToast} from './components/ui/toast';
import './shadcn.css';
import './style.css';
import './dataset.css';
import './upstream-card.css';
import './scoring.css';
import './report-observability.css';
import './testing-next.css';
import './report-workspace.css';
import './report-layout.css';
function App(){
  const[route,setRoute]=useState(location.hash.slice(1)||'/runs'),[collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('veritas-sidebar-collapsed')==='true';}catch{return false;}});
  const runsQuery=useQuery(runListOptions()),datasetsQuery=useQuery(datasetListOptions()),targetsQuery=useQuery(targetListOptions());
  const runs=runsQuery.data?.items??[],datasets=datasetsQuery.data?.items??[],targets=targetsQuery.data?.items??[];
  const error=[runsQuery.error,datasetsQuery.error,targetsQuery.error].find(Boolean)?.message??'',loading=runsQuery.isPending||datasetsQuery.isPending||targetsQuery.isPending;
  const notify=useToast();
  const[testing,setTesting]=useState(false),[initial,setInitial]=useState<TestingInitial>();const opener=useRef<HTMLElement|null>(null);
  const refresh=async()=>{await Promise.all([queryKeys.runs,queryKeys.datasets,queryKeys.targets].map(queryKey=>queryClient.invalidateQueries({queryKey})));};
  useEffect(()=>{const changed=()=>setRoute(location.hash.slice(1)||'/runs');addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed);},[]);
  useEffect(()=>{if(route==='/endpoints')location.hash='/targets';},[route]);
  useEffect(()=>{if(!route.startsWith('/runs/'))return;const href=legacyReportComparisonHref(route.slice('/runs/'.length).split('?')[0],new URLSearchParams(route.split('?')[1]??''));if(href)location.replace(href);},[route]);
  useEffect(()=>{window.scrollTo(0,0);},[route.split('?')[0]]);
  useEffect(()=>{try{localStorage.setItem('veritas-sidebar-collapsed',String(collapsed));}catch{}},[collapsed]);
  const page=route.startsWith('/compare')?'report-compare':route.startsWith('/runs/')?'report-detail':route.startsWith('/datasets')?'datasets':route.startsWith('/targets')||route==='/endpoints'?'targets':'runs';
  const cardId=route.startsWith('/datasets/')?decodeURIComponent(route.slice('/datasets/'.length).split('?')[0]):undefined,card=datasets.find(d=>d.id===cardId),targetId=route.startsWith('/targets/')?route.slice('/targets/'.length):undefined;
  const title=page==='datasets'?'Datasets':page==='targets'?'Targets':'Reports';
  function start(selection?:TestingInitial){opener.current=document.activeElement as HTMLElement;setInitial(selection);setTesting(true);}
  function close(){setTesting(false);queueMicrotask(()=>opener.current?.isConnected&&opener.current.focus());}
  return <div className={'shell'+(collapsed?' collapsed':'')}><aside className="sidebar"><a href="#/runs" className="brand" aria-label="TaskLattice Veritas"><ProductMark/><span className="brand-wordmark"><span>TaskLattice</span><strong>Veritas</strong></span></a><div className="nav-content"><div className="nav-group-label">Workspace</div><nav aria-label="Main navigation">{[{id:'runs',label:'Reports',icon:FileChartColumn},{id:'datasets',label:'Datasets',icon:Database},{id:'targets',label:'Targets',icon:Cable}].map(({id,label,icon:Icon})=><a key={id} href={'#/'+id} aria-label={label} title={collapsed?label:undefined} aria-current={page===id||(page==='report-detail'||page==='report-compare')&&id==='runs'?'page':undefined}><Icon/><span>{label}</span></a>)}</nav></div><div className="sidebar-footer"><ShieldCheck aria-hidden="true"/><div><strong>Guardrail testing</strong><span>Decisions backed by evidence</span></div></div></aside>
    <main><header className="topbar"><div className="breadcrumb"><Button variant="ghost" className="sidebar-toggle" aria-label="Toggle sidebar" aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}><PanelLeft/></Button><span className="header-divider"/><span>Testing</span><ChevronRight/>{page==='report-detail'||page==='report-compare'?<a href="#/runs" aria-label="All reports">Report</a>:<span className="current">{title}</span>}{(page==='report-detail'||page==='report-compare')&&<><ChevronRight/><span className="current">{page==='report-compare'?'Compare':'Details'}</span></>}{card&&<><ChevronRight/><span className="current">{datasetName(card)}</span></>}{targetId&&<><ChevronRight/><span className="current">Details</span></>}</div><div className="header-controls"><ThemeControl/></div></header>
      <div className="workspace-canvas">{error&&<div className="notice error" role="alert">{error}<Button variant="ghost" onClick={()=>void refresh()}>Retry</Button></div>}
      {page==='report-detail'?<ReportDetail cards={datasets} key={route.split('?')[0]} id={route.slice('/runs/'.length).split('?')[0]} scoringId={new URLSearchParams(route.split('?')[1]??'').get('scoring')??undefined} refresh={refresh} notify={notify}/>:<div className={'content'+(page==='datasets'||page==='targets'?' resource-content':'')}>{loading?<div className="empty" role="status">Loading workspace…</div>:page==='datasets'?(cardId?(card?<DatasetDetail key={card.id} card={card}/>:<div className="empty"><h2>Dataset not found</h2><a href="#/datasets">All Datasets</a></div>):<DatasetBrowser cards={datasets} refresh={()=>void refresh()}/>):page==='targets'?<TargetPage start={id=>start({targetId:id})} id={targetId} targets={targets} refresh={refresh} notify={notify}/>:page==='report-compare'?<ReportCompareWorkspace cards={datasets} runs={runs}/>:<ReportList cards={datasets} targets={targets} runs={runs} start={start} refresh={refresh} notify={notify}/>}</div>}
      </div></main>{testing&&<TestingForm datasets={datasets} targets={targets} initial={initial} close={close} done={id=>{setTesting(false);location.hash='/runs/'+id;void refresh();}}/>}</div>;
}
const clientRoot=import.meta.hot?.data.clientRoot??createRoot(document.getElementById('root')!);
if(import.meta.hot)import.meta.hot.data.clientRoot=clientRoot;
clientRoot.render(<QueryClientProvider client={queryClient}><ToastProvider><App/></ToastProvider></QueryClientProvider>);
