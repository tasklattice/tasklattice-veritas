import {useEffect,useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import Markdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {BookOpen,ArrowUpRight,Download,FileCode2,RefreshCw,GitCommitHorizontal,Scale,Link2,ChevronDown} from 'lucide-react';
import {cardOptions} from './query';
import {remarkCardHeadings,cardLink,cardImage} from '../src/shared/card-markdown';
import type {DatasetCard} from '../src/shared/types';
import {Button} from './ui';
import {Skeleton} from './components/ui/skeleton';
import {SourceMark,PublisherMark} from './brand';

const headingComponents:Components={h1:({node,...props})=><h1 tabIndex={-1} {...props}/>,h2:({node,...props})=><h2 tabIndex={-1} {...props}/>,h3:({node,...props})=><h3 tabIndex={-1} {...props}/>,h4:({node,...props})=><h4 tabIndex={-1} {...props}/>,h5:({node,...props})=><h5 tabIndex={-1} {...props}/>,h6:({node,...props})=><h6 tabIndex={-1} {...props}/>,};

export function UpstreamDatasetCard({card}:{card:DatasetCard}){
  const query=useQuery(cardOptions(card.id,card.revision)),source=query.data,[raw,setRaw]=useState(false),[section,setSection]=useState('');
  function jump(id:string,save=true){
    setRaw(false);
    const reveal=()=>{const heading=document.getElementById(id);if(!heading)return;setSection(id);heading.scrollIntoView({block:'start'});heading.focus({preventScroll:true});if(save){const q=new URLSearchParams(location.hash.split('?')[1]??'');q.set('tab','card');q.set('section',id);history.replaceState(null,'',`#/datasets/${encodeURIComponent(card.id)}?${q}`);}};
    requestAnimationFrame(reveal);
  }
  useEffect(()=>{if(!source)return;const sync=()=>{const id=new URLSearchParams(location.hash.split('?')[1]??'').get('section');if(id)jump(id,false);};sync();addEventListener('hashchange',sync);return()=>removeEventListener('hashchange',sync);},[source]);
  if(query.isPending)return <div className="upstream-card-loading" role="status"><Skeleton className="h-8 w-80"/><Skeleton className="h-4 w-64"/><Skeleton className="h-4 w-96"/><p>Loading the archived upstream Dataset card…</p></div>;
  if(query.error||!source)return <div className="empty upstream-card-empty"><BookOpen/><h2>Upstream card unavailable</h2><p role="alert">{query.error?.message??'No README is available for this source.'}</p><div><Button variant="outline" onClick={()=>void query.refetch()}><RefreshCw/>Retry</Button>{card.url&&<Button variant="outline" asChild><a href={card.url} target="_blank" rel="noreferrer">View upstream source<ArrowUpRight/></a></Button>}</div></div>;
  const metadata=source.metadata,metadataFields=[['task_categories','Tasks'],['language','Languages'],['size_categories','Size category'],['license','License']] as const;
  // HTML is not executed. Convert the upstream's presentational line breaks only;
  // the untouched Markdown/YAML remains available in Raw and the download.
  const markdown=source.markdown.replace(/<br\s*\/?\s*>/gi,'  \n');
  function link(href:string,children:ReactNode){
    const resolved=cardLink(href,source!);if(!resolved)return <span>{children}</span>;let fragment=resolved.slice(1);try{fragment=decodeURIComponent(fragment);}catch{}
    if(resolved.startsWith('#')&&!source!.headings.some(h=>h.id==='upstream-'+fragment))return <a href={source!.readmeUrl+resolved} target="_blank" rel="noreferrer">{children}</a>;
    if(resolved.startsWith('#'))return <a href={'#/datasets/'+encodeURIComponent(card.id)+'?tab=card&section='+encodeURIComponent('upstream-'+fragment)} onClick={e=>{e.preventDefault();try{jump('upstream-'+fragment);}catch{}}}>{children}</a>;
    return <a href={resolved} target="_blank" rel="noreferrer">{children}</a>;
  }
  return <div className="upstream-card">
    <div className="upstream-card-source"><div><SourceMark source={source.source}/><span>Upstream Dataset card</span><a href={source.readmeUrl} target="_blank" rel="noreferrer">{source.repository} / {source.filename}<ArrowUpRight/></a></div><span><GitCommitHorizontal/>{source.revision.slice(0,7)}<i/>Pinned snapshot</span></div>
    <div className="upstream-card-toolbar"><div className="upstream-card-view" role="group" aria-label="Dataset card view"><Button variant="ghost" aria-pressed={!raw} onClick={()=>setRaw(false)}><BookOpen/>Preview</Button><Button variant="ghost" aria-pressed={raw} onClick={()=>setRaw(true)}><FileCode2/>Raw Markdown</Button></div><Button variant="ghost" asChild><a href={'/api/datasets/'+encodeURIComponent(card.id)+'/card/raw'} download="README.md"><Download/>Download README</a></Button><Button variant="ghost" onClick={()=>void query.refetch()} aria-label="Refresh upstream card" title="Read the pinned local snapshot again"><RefreshCw/></Button></div>
    <div className="upstream-card-layout"><div className="upstream-card-main">{raw?<pre className="upstream-card-raw" tabIndex={0} aria-label="Original upstream Markdown">{source.raw}</pre>:<article className="hf-dataset-readme upstream-markdown" aria-label="Upstream README"><Markdown remarkPlugins={[remarkGfm,remarkCardHeadings]} skipHtml urlTransform={url=>url} components={{...headingComponents,
      a:({href,children})=>link(href??'',children),
      img:({src,alt})=>{const local=cardImage(typeof src==='string'?src:'',source);return local?<img src={local} alt={alt??''} loading="lazy"/>:<span className="upstream-external-image">{link(typeof src==='string'?src:'',<><Link2/>{alt||'View upstream image'} (external image)</>)}</span>;},

      table:({node,...props})=><div className="upstream-table-scroll"><table {...props}/></div>,
    }}>{markdown}</Markdown></article>}
    <div className="upstream-card-attribution"><PublisherMark publisher={source.publisher} size="sm"/><div><p>Original Dataset card by <strong>{source.publisher}</strong> · <a href={source.readmeUrl} target="_blank" rel="noreferrer">pinned upstream source<ArrowUpRight/></a></p><span>License: {source.license??'See upstream source'} · Upstream wording, authors and citation are preserved.</span></div></div>
    </div>
    <aside className="upstream-card-sidebar" aria-label="Dataset card information"><section className="upstream-metadata"><h2>Upstream metadata</h2>{metadataFields.filter(([key])=>metadata[key]!==undefined).map(([key,label])=><div key={key}><h3>{label}</h3><p>{simpleValue(metadata[key])}</p></div>)}{Array.isArray(metadata.tags)&&<div><h3>Tags</h3><div className="upstream-tags">{[...new Set(metadata.tags.map(String))].map(tag=><span key={tag}>{tag}</span>)}</div></div>}{source.metadataError&&<p className="notice">{source.metadataError}</p>}<details><summary>Original YAML metadata<ChevronDown/></summary><pre>{source.frontmatter||'No YAML metadata is present in this README.'}</pre></details></section><nav aria-label="On this Dataset card"><h2>On this page</h2>{source.headings.filter(h=>h.depth<=3).map(h=><button type="button" key={h.id} className={'depth-'+h.depth} aria-current={section===h.id?'location':undefined} onClick={()=>jump(h.id)}>{h.text}</button>)}</nav>
      <section className="upstream-card-provenance"><h2>Source snapshot</h2><a href={source.readmeUrl} target="_blank" rel="noreferrer">{source.filename}<ArrowUpRight/></a><dl><dt>Revision</dt><dd>{source.revision}</dd><dt>README SHA-256</dt><dd>{source.sha256}</dd><dt>Size</dt><dd>{source.bytes.toLocaleString()} bytes</dd></dl><p><Scale/>{source.license??'See source license'}</p><small>Rendered from the archived README. The card follows the raw archive revision when it is updated.</small></section>
    </aside></div>
  </div>;
}
function simpleValue(value:unknown):string{return Array.isArray(value)?value.map(simpleValue).join(', '):value&&typeof value==='object'?JSON.stringify(value):String(value??'');}
