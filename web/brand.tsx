import {useState} from 'react';
import {Database,FolderOpen,ShieldCheck,ShieldAlert,TextCursorInput,Scale,Fingerprint,MessagesSquare,Languages,Plug} from 'lucide-react';
import type {DatasetCard} from '../src/shared/types';

/** Local assets keep publisher identity available in isolated deployments. */
const publishers:Record<string,string>={nvidia:'nvidia.webp',lmsys:'lmsys.webp','pku-alignment':'pku-alignment.webp',librai:'librai.webp',jailbreakbench:'jailbreakbench.webp',allenai:'allenai.webp',deepset:'deepset.webp',lakera:'lakera.webp',paul:'paul.webp','bench-llm':'bench-llm.svg',ai4privacy:'ai4privacy.webp','thu-coai':'thu-coai.webp',openai:'openai.png',centerforaisafety:'centerforaisafety.png'};
const names:Record<string,string>={aegis:'Aegis 2.0',toxicchat:'ToxicChat',beavertails:'BeaverTails','do-not-answer':'Do-Not-Answer',jailbreakbench:'JailbreakBench',wildjailbreak:'WildJailbreak',deepset:'Prompt Injections',gandalf:'Gandalf',xstest:'XSTest','or-bench':'OR-Bench',pii:'PII Masking 300K','topic-control':'CantTalkAboutThis','safety-prompts':'Safety-Prompts',moderation:'OpenAI Moderation',harmbench:'HarmBench'};
export const datasetName=(card:Pick<DatasetCard,'id'|'name'>)=>names[card.id]??card.name;
export const sourceName=(source:DatasetCard['source'])=>source==='hf'?'Hugging Face':source==='github'?'GitHub':'Local archive';

function LocalMark({file,className='',fallback='dataset'}:{file?:string;className?:string;fallback?:'dataset'|'adapter'}){
  const[failed,setFailed]=useState(false);
  return <span className={'brand-mark '+className} aria-hidden="true">{file&&!failed?<img src={'/brand/'+file} alt="" width="32" height="32" onError={()=>setFailed(true)}/>:fallback==='adapter'?<Plug/>:<Database/>}</span>;
}
/** TaskLattice website BrandMark geometry; the wordmark supplies the accessible name. */
export function ProductMark(){
  return <svg className="product-mark" viewBox="0 0 64 64" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 10h48L32 56 8 10Z"/>
      <path d="M32 10v46M16 30h32M8 10l40 20M56 10 16 30M16 30l16 26M48 30 32 56"/>
    </g>
    <g fill="var(--brand-signal)" stroke="var(--sidebar)" strokeWidth="1.5">
      {[[8,10],[32,10],[56,10],[16,30],[32,30],[48,30],[32,56]].map(([cx,cy])=><circle key={cx+':'+cy} cx={cx} cy={cy} r="3.5"/>)}
    </g>
  </svg>;
}
export function PublisherMark({publisher,size='md'}:{publisher:string;size?:'sm'|'md'|'lg'}){return <LocalMark key={publisher} file={publishers[publisher.toLowerCase()]} className={'publisher-mark mark-'+size}/>;}
export function SourceMark({source}:{source:DatasetCard['source']}){return source==='local'?<FolderOpen aria-hidden="true"/>:<LocalMark file={source==='hf'?'huggingface.svg':'github.svg'} className={'source-mark '+(source==='github'?'monochrome-mark':'')}/>;}
export function AdapterMark({adapter}:{adapter:string|undefined}){return <LocalMark key={adapter} file={adapter==='f5-scan'?'f5.ico':adapter==='litellm-generic-guardrail'?'litellm.webp':undefined} className="adapter-mark" fallback="adapter"/>;}
export function DatasetCategory({id}:{id:string}){
  const[label,Icon]=id==='pii'?['PII & privacy',Fingerprint] as const:id==='topic-control'?['Topic control',MessagesSquare] as const:id==='safety-prompts'?['Chinese safety',Languages] as const:['xstest','or-bench'].includes(id)?['Over-refusal',Scale] as const:['deepset','gandalf'].includes(id)?['Prompt injection',TextCursorInput] as const:['jailbreakbench','wildjailbreak','harmbench'].includes(id)?['Jailbreak resistance',ShieldAlert] as const:['aegis','toxicchat','beavertails','do-not-answer','moderation'].includes(id)?['Content safety',ShieldCheck] as const:['Dataset',Database] as const;
  return <span className="dataset-category"><Icon aria-hidden="true"/>{label}</span>;
}

export function DatasetIdentity({id,cards,repository=false}:{id:string;cards:DatasetCard[];repository?:boolean}){
  const card=cards.find(c=>c.id===id);
  return <span className="dataset-identity"><PublisherMark publisher={card?.publisher??'Local'} size="sm"/><span><strong>{card?datasetName(card):id}</strong>{repository&&<small>{card?.repository??'Saved source'}</small>}</span></span>;
}
export function DatasetCollection({ids,cards}:{ids:string[];cards:DatasetCard[]}){
  const names=ids.map(id=>{const c=cards.find(c=>c.id===id);return c?datasetName(c):id;});
  return <span className="dataset-collection" title={names.join(', ')}><span className="dataset-avatar-stack" aria-hidden="true">{ids.slice(0,3).map(id=><PublisherMark key={id} publisher={cards.find(c=>c.id===id)?.publisher??'Local'} size="sm"/>)}</span><span>{names[0]??'Dataset cases'}{names.length>1&&<small>+{names.length-1} {names.length===2?'Dataset':'Datasets'}</small>}</span></span>;
}
