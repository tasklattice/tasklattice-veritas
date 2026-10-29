import {useEffect,useState,lazy,Suspense} from 'react';
import {Tabs} from 'radix-ui';
import {Database,Search,X,SlidersHorizontal,ChevronDown,ArrowUpRight,RefreshCw,Table2,BookOpen,GitCommitHorizontal,Scale,ArrowLeft} from 'lucide-react';
import {DatasetViewer} from './dataset-viewer';
const UpstreamDatasetCard=lazy(()=>import('./upstream-card').then(module=>({default:module.UpstreamDatasetCard})));
import {PublisherMark,SourceMark,DatasetCategory,datasetName,sourceName} from './brand';
import type {DatasetCard} from '../src/shared/types';
import {Button,Input,NativeSelect} from './ui';
import {categories,filterDatasets,type DatasetFilters} from './dataset-filters';

export function DatasetBrowser({cards,refresh}:{cards:DatasetCard[];refresh:()=>void}){
  const[filters,setFilters]=useState<DatasetFilters>({search:'',category:[],source:[],availability:[]}),[sort,setSort]=useState('catalog');
  const filtered=filterDatasets(cards,filters),items=sort==='name'?[...filtered].sort((a,b)=>a.repository!.localeCompare(b.repository!)):filtered;
  const count=filters.category.length+filters.source.length+filters.availability.length;
  function toggle(group:'category'|'source'|'availability',value:string){setFilters(f=>({...f,[group]:f[group].includes(value)?f[group].filter(v=>v!==value):[...f[group],value]}));}
  function clear(){setFilters({search:'',category:[],source:[],availability:[]});}
  function facet(group:'category'|'source'|'availability',value:string){return filterDatasets(cards,{...filters,[group]:[value]}).length;}
  const groups=[{key:'category' as const,title:'Testing capability',options:categories},{key:'source' as const,title:'Source',options:[{value:'hf',label:'Hugging Face'},{value:'github',label:'GitHub'}]},{key:'availability' as const,title:'Availability',options:[{value:'local',label:'Available locally'},{value:'missing',label:'Archive required'}]}];
  return <section className="hf-datasets-page">
    <header className="hf-catalog-heading"><div><Database/><h1>Datasets</h1><span>{cards.length}</span></div><Button variant="outline" onClick={refresh}><RefreshCw/>Refresh</Button></header>
    <p className="hf-catalog-description">Browse benchmarks, read source documentation, and inspect the original data.</p>
    <div className="hf-catalog-toolbar"><div className="search-control"><Search/><Input type="search" aria-label="Search datasets" placeholder="Filter by name, publisher, or keyword…" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/>{filters.search&&<Button className="search-clear" variant="ghost" aria-label="Clear search" onClick={()=>setFilters({...filters,search:''})}><X/></Button>}</div><span role="status">{items.length} of {cards.length} datasets</span><label className="hf-sort">Sort<NativeSelect aria-label="Sort datasets" value={sort} onChange={e=>setSort(e.target.value)}><option value="catalog">Catalog order</option><option value="name">Name: A–Z</option></NativeSelect></label></div>
    <div className="hf-catalog-layout"><aside className="hf-filters" aria-label="Dataset filters"><div className="hf-filter-heading"><h2><SlidersHorizontal/>Filters{count>0&&<span>{count}</span>}</h2><Button variant="ghost" disabled={!count&&!filters.search} onClick={clear}>Clear</Button></div>{groups.map(group=><details open key={group.key}><summary>{group.title}<ChevronDown/></summary><div role="group" aria-label={group.title}>{group.options.map(option=><label key={option.value} className={filters[group.key].includes(option.value)?'selected':''}><input type="checkbox" checked={filters[group.key].includes(option.value)} onChange={()=>toggle(group.key,option.value)}/><span>{option.label}</span><small>{facet(group.key,option.value)}</small></label>)}</div></details>)}<p className="hf-filter-note">One Dataset per original source. Local archives are pinned to a source revision.</p></aside>
    <div className="hf-catalog-results">{count>0&&<div className="hf-active-filters">{groups.flatMap(g=>g.options.filter(o=>filters[g.key].includes(o.value)).map(o=><Button key={g.key+o.value} variant="outline" onClick={()=>toggle(g.key,o.value)} aria-label={'Remove '+o.label+' filter'}>{o.label}<X/></Button>))}</div>}
    {items.length?<div className="hf-dataset-results-grid">{items.map(card=><article className="hf-source-card" key={card.id}><div className="hf-source-title"><PublisherMark publisher={card.publisher} size="sm"/><h2><a href={'#/datasets/'+encodeURIComponent(card.id)} aria-label={'View dataset '+datasetName(card)} title={card.repository??card.name}>{card.repository??card.name}</a></h2><span className={'hf-local-status'+(card.rawAvailable?' ready':'')} title={card.rawAvailable?'Pinned archive available locally':'Download the archive with the CLI'}><i/>{card.rawAvailable?'Local':'Not downloaded'}</span></div><p>{card.description}</p><div className="hf-source-footer"><DatasetCategory id={card.id}/><span className="hf-source-license"><Scale/>{card.license??'See source'}</span><span className="hf-source-origin"><SourceMark source={card.source}/>{sourceName(card.source)}</span></div></article>)}</div>:<div className="empty"><Search/><h2>No matching datasets</h2><p>Try another keyword or remove a filter.</p><Button variant="outline" onClick={clear}>Clear all filters</Button></div>}
    <p className="hf-catalog-end">{items.length} {items.length===1?'dataset':'datasets'} · Original source annotations · Pinned local archives</p></div></div>
  </section>;
}

export function DatasetDetail({card}:{card:DatasetCard}){
  const[tab,setTab]=useState(()=>new URLSearchParams(location.hash.split('?')[1]??'').get('tab')==='card'?'card':'data');
  useEffect(()=>{const sync=()=>setTab(new URLSearchParams(location.hash.split('?')[1]??'').get('tab')==='card'?'card':'data');addEventListener('hashchange',sync);return()=>removeEventListener('hashchange',sync);},[]);
  function selectTab(value:string){setTab(value);const q=new URLSearchParams(location.hash.split('?')[1]??'');if(value==='card')q.set('tab','card');else{q.delete('tab');q.delete('section');}history.replaceState(null,'',location.hash.split('?')[0]+(q.size?'?'+q:''));}

  return <div className="resource-detail-page dataset-detail-page hf-dataset-detail">
    <header className="hf-repo-header"><div className="hf-repo-identity"><a href="#/datasets" className="hf-back" aria-label="All datasets"><ArrowLeft/></a><PublisherMark publisher={card.publisher} size="sm"/><div><p>Dataset</p><h1><span>{card.publisher}</span><b>/</b>{card.repository?.split('/').slice(1).join('/')??card.name}</h1></div></div><div className="hf-repo-actions">{card.url&&<Button variant="outline" asChild><a href={card.url} target="_blank" rel="noreferrer"><SourceMark source={card.source}/>Source<ArrowUpRight/></a></Button>}</div></header>
    <Tabs.Root value={tab} onValueChange={selectTab}><div className="hf-repo-tabs"><Tabs.List className="detail-tabs" aria-label="Dataset sections"><Tabs.Trigger value="card"><BookOpen/>Dataset card</Tabs.Trigger><Tabs.Trigger value="data"><Table2/>Data viewer</Tabs.Trigger></Tabs.List><span><GitCommitHorizontal/>{card.revision?.slice(0,7)}<i/> {card.rawAvailable?'Archived locally':'Archive required'}</span></div><Tabs.Content forceMount value="data" className="detail-tab-panel"><DatasetViewer key={card.id} card={card}/></Tabs.Content><Tabs.Content value="card" className="detail-tab-panel"><Suspense fallback={<div className="upstream-card-loading" role="status">Loading the upstream Dataset card…</div>}><UpstreamDatasetCard card={card}/></Suspense></Tabs.Content></Tabs.Root>
  </div>;
}
