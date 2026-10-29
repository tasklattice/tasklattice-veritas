import {useId,useRef,useState,type ComponentProps,type ReactNode} from 'react';
import {Dialog} from 'radix-ui';
import {Button as ShadcnButton} from './components/ui/button';
import {Input as ShadcnInput} from './components/ui/input';
import {NativeSelect as ShadcnNativeSelect} from './components/ui/native-select';
import {Table as ShadcnTable,TableHeader,TableBody,TableRow,TableHead,TableCell} from './components/ui/table';
import {cva} from 'class-variance-authority';
import {ChevronDown,ChevronLeft,ChevronRight,RefreshCw,Search,X} from 'lucide-react';

// Relay's shadcn/Radix conventions, expressed with the shared family CSS tokens.
const buttonVariants=cva('ui-button',{variants:{variant:{default:'button-primary',secondary:'button-secondary',ghost:'button-ghost',outline:'button-outline',danger:'button-danger'},size:{md:'button-md',lg:'button-lg',sm:'button-sm'}},defaultVariants:{variant:'default',size:'md'}});
export function Button({variant='default',size='md',className='',asChild=false,...props}:ComponentProps<'button'>&{variant?:'default'|'secondary'|'ghost'|'outline'|'danger';size?:'md'|'lg'|'sm';asChild?:boolean}){
  return <ShadcnButton {...props} asChild={asChild} variant={variant==='danger'?'destructive':variant} size={size==='md'?'default':size} type={asChild?undefined:props.type??'button'} className={buttonVariants({variant,size,className})}/>;
}
export function Input({id,className='',...props}:ComponentProps<'input'>){
  const generated=useId();return <ShadcnInput {...props} id={id??generated} data-slot="input" className={'ui-input '+className}/>;
}
export function NativeSelect({id,className='',...props}:Omit<ComponentProps<'select'>,'size'>){
  const generated=useId();return <ShadcnNativeSelect {...props} id={id??generated} className="select-wrap" selectClassName={'ui-select '+className}/>;
}
export function Table({className='',...props}:ComponentProps<'table'>){return <ShadcnTable {...props} containerClassName="table-scroll" className={'ui-table '+className}/>;}
export const Thead=(props:ComponentProps<'thead'>)=><TableHeader {...props}/>;
export const Tbody=(props:ComponentProps<'tbody'>)=><TableBody {...props}/>;
export const Tr=(props:ComponentProps<'tr'>)=><TableRow {...props}/>;
export const Th=({children,...props}:ComponentProps<'th'>)=><TableHead scope="col" {...(!children?{'aria-label':'Actions'}:{})} {...props}>{children}</TableHead>;
export const Td=(props:ComponentProps<'td'>)=><TableCell {...props}/>;
export function Disclosure({label,children,className='',...props}:ComponentProps<'details'>&{label:ReactNode}){
  return <details {...props} className={'ui-disclosure '+className}><summary><span>{label}</span><ChevronDown aria-hidden="true"/></summary>{children}</details>;
}
export function StateTag({state,label}:{state:string;label?:string}){
  const tone=['completed','pass','ready','available'].includes(state)?'success':['failed','error','fail'].includes(state)?'danger':['gate-failed','interrupted','cancelled','unreviewed','unavailable'].includes(state)?'warning':['running','queued','preparing','scoring'].includes(state)?'info':'neutral';
  return <span data-slot="badge" className={'state-tag status-'+tone}><i aria-hidden="true"/><span className="state-label">{label??state.replaceAll('-',' ')}</span></span>;
}
export function Sheet({children,onClose,busy=false,className=''}:{children:ReactNode;onClose:()=>void;busy?:boolean;className?:string}){
  const opener=useRef<HTMLElement|null>(document.activeElement as HTMLElement);
  return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy)onClose();}}><Dialog.Portal><Dialog.Overlay className="sheet-overlay"/><Dialog.Content className={'sheet '+className} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onInteractOutside={e=>e.preventDefault()} onCloseAutoFocus={e=>{if(opener.current?.isConnected&&opener.current!==document.body){e.preventDefault();opener.current.focus();}}}>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export const SheetTitle=Dialog.Title;
export const SheetDescription=Dialog.Description;

/** Shared resource heading keeps identity, description and page actions aligned. */
export function ResourceHeader({title,description,icon,count,actions,back}:{title:string;description:string;icon:ReactNode;count?:string;actions?:ReactNode;back?:{href:string;label:string}}){
  return <header className="resource-page-header"><div className="resource-heading-identity">{back&&<Button variant="ghost" className="resource-back" asChild><a href={back.href} aria-label={back.label} title={back.label}><ChevronLeft/></a></Button>}<span className="resource-header-icon">{icon}</span><div className="resource-heading-copy"><div className="resource-title-line"><h1>{title}</h1>{count&&<span className="resource-heading-count">{count}</span>}</div><p>{description}</p></div></div>{actions&&<div className="resource-actions">{actions}</div>}</header>;
}

export function ResourceList<T>({items,label,searchText,filter,action,onRefresh,children,emptyDescription,density='default',toolbarStart}:{items:T[];label:string;searchText:(item:T)=>string;filter?:{label:string;options:{value:string;label:string}[];matches:(item:T,value:string)=>boolean};action:ReactNode;onRefresh?:()=>void;emptyDescription?:string;density?:'default'|'compact';toolbarStart?:ReactNode;children:(items:T[])=>ReactNode}){
  const id=useId(),[search,setSearch]=useState(''),[selected,setSelected]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(25);
  const filtered=items.filter(item=>searchText(item).toLowerCase().includes(search.trim().toLowerCase())&&(!selected||!filter||filter.matches(item,selected)));
  const pages=Math.max(1,Math.ceil(filtered.length/size)),current=Math.min(page,pages),active=Boolean(search||selected);
  function clear(){setSearch('');setSelected('');setPage(1);}
  const summary=<><span role="status">{filtered.length} of {items.length} records</span>{active&&<Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}</>;
  return <section className={'resource-list'+(density==='compact'?' resource-list-compact':'')} aria-label={label}><div className="resource-list-toolbar">{toolbarStart}
    <div className="search-control"><Search aria-hidden="true"/><Input id={id+'-search'} type="search" aria-label={'Search '+label.toLowerCase()} placeholder={'Search '+label.toLowerCase()+' by name or ID…'} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>{search&&<Button variant="ghost" size="sm" className="search-clear" aria-label="Clear search" onClick={()=>{setSearch('');setPage(1);}}><X/></Button>}</div>
    {filter&&<div className="resource-list-filter"><NativeSelect aria-label={filter.label} value={selected} onChange={e=>{setSelected(e.target.value);setPage(1);}}>{filter.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect></div>}
    {density==='compact'&&<div className="resource-toolbar-summary">{summary}</div>}{onRefresh&&<Button variant="ghost" onClick={onRefresh}><RefreshCw/>Refresh</Button>}{action}</div>
    {density!=='compact'&&<div className="resource-list-summary">{summary}</div>}
    {filtered.length?children(filtered.slice((current-1)*size,current*size)):<div className="empty"><h2>{active?'No matching records':'No records yet'}</h2><p>{active?'Try a different search or clear the filters.':emptyDescription??'Select one or more Datasets and a Target to start testing.'}</p>{active&&<Button variant="outline" onClick={clear}>Clear filters</Button>}</div>}
    {filtered.length>0&&<div className="list-pagination"><label htmlFor={id+'-size'}>Rows per page</label><NativeSelect id={id+'-size'} value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1);}}>{[25,50,100].map(n=><option key={n} value={n}>{n}</option>)}</NativeSelect><span className="page-count">{(current-1)*size+1}–{Math.min(current*size,filtered.length)} of {filtered.length}</span><label htmlFor={id+'-page'}>Page</label><NativeSelect id={id+'-page'} value={current} onChange={e=>setPage(Number(e.target.value))}>{Array.from({length:pages},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</NativeSelect><span>of {pages}</span><Button variant="ghost" aria-label="Previous page" disabled={current===1} onClick={()=>setPage(current-1)}><ChevronLeft/></Button><Button variant="ghost" aria-label="Next page" disabled={current===pages} onClick={()=>setPage(current+1)}><ChevronRight/></Button></div>}
  </section>;
}

export function DataPagination({offset,limit,total,busy=false,onChange}:{offset:number;limit:number;total:number;busy?:boolean;onChange:(offset:number,limit:number)=>void}){
  const id=useId(),page=Math.floor(offset/limit)+1,pages=Math.max(1,Math.ceil(total/limit)),[jump,setJump]=useState(String(page));
  return <div className="data-pagination"><label htmlFor={id+'-size'}>Rows per page</label><NativeSelect id={id+'-size'} value={limit} disabled={busy} onChange={e=>{setJump('1');onChange(0,Number(e.target.value));}}>{[25,50,100].map(n=><option key={n} value={n}>{n}</option>)}</NativeSelect><span className="page-count">{total?`${offset+1}–${Math.min(offset+limit,total)} of ${total.toLocaleString()}`:'0 rows'}</span><form onSubmit={e=>{e.preventDefault();const n=Number(jump);if(Number.isSafeInteger(n)&&n>=1&&n<=pages)onChange((n-1)*limit,limit);}}><label htmlFor={id+'-page'}>Page</label><Input id={id+'-page'} aria-label="Go to page" type="number" min="1" max={pages} required value={jump} disabled={busy||!total} onChange={e=>setJump(e.target.value)}/><span>of {pages.toLocaleString()}</span><Button type="submit" variant="ghost" disabled={busy||!total}>Go</Button></form><Button variant="ghost" disabled={busy||offset===0} aria-label="Previous page" onClick={()=>{setJump(String(page-1));onChange(Math.max(0,offset-limit),limit);}}><ChevronLeft/></Button><Button variant="ghost" disabled={busy||offset+limit>=total} aria-label="Next page" onClick={()=>{setJump(String(page+1));onChange(offset+limit,limit);}}><ChevronRight/></Button></div>;
}
