import {isActiveRun} from '../src/shared/testing';
import {QueryClient,queryOptions} from '@tanstack/react-query';
import {api,ApiError} from './api';
import type {DatasetCard,JsonObject,RunItem,TargetItem} from '../src/shared/types';

export const queryClient=new QueryClient({defaultOptions:{queries:{retry:(count,error)=>!(error instanceof ApiError&&error.status<500)&&count<1,staleTime:15_000,gcTime:10*60_000,refetchOnWindowFocus:false},mutations:{retry:false}}});
export const queryKeys={datasets:['datasets'] as const,targets:['targets'] as const,runs:['runs'] as const,catalog:['catalog'] as const};
export const datasetListOptions=()=>queryOptions({queryKey:queryKeys.datasets,queryFn:({signal})=>api<{items:DatasetCard[]}>('/datasets',undefined,'GET',signal),staleTime:60_000});
export const targetListOptions=()=>queryOptions({queryKey:queryKeys.targets,queryFn:({signal})=>api<{items:TargetItem[]}>('/targets',undefined,'GET',signal),refetchInterval:15_000});
export const targetDetailOptions=(id?:string)=>queryOptions({queryKey:['target',id] as const,queryFn:({signal})=>api<{item:TargetItem}>('/targets/'+id,undefined,'GET',signal),enabled:Boolean(id)});
export const runListOptions=()=>queryOptions({queryKey:queryKeys.runs,queryFn:({signal})=>api<{items:RunItem[]}>('/runs',undefined,'GET',signal),refetchInterval:q=>q.state.data?.items.some(r=>isActiveRun(r.status))?2000:15_000});
export const catalogOptions=()=>queryOptions({queryKey:queryKeys.catalog,queryFn:({signal})=>api<{items:JsonObject[]}>('/catalog',undefined,'GET',signal),staleTime:60_000});

export type SourceScope={config:string;split:string;files:string[];available:boolean;recommended:boolean;fields:string[]};
export type ViewerMetadata={id:string;revision:string;source:string;notes:string;scopes:SourceScope[]};
export type ViewerColumn={name:string;type:string;stats?:{count:number;missing:number;min:number;max:number;bins:number[];values?:{value:string;count:number}[]}};
export type ViewerPage={status:'ready'|'indexing';indexedRows?:number;queued?:boolean;items?:{index:number;values:Record<string,string>;truncatedFields:string[]}[];total?:number;allTotal?:number;columns?:ViewerColumn[]};
export type ViewerParams={config:string;split:string;field:string;search:string;offset:number;limit:number;revision?:string|null;sort?:string;order?:string;column?:string;value?:string};
export type ViewerRow={status:'ready';data:JsonObject;source:string}|{status:'indexing';indexedRows?:number};
export const metadataOptions=(id:string,revision?:string|null)=>queryOptions({queryKey:['dataset',id,'metadata',revision] as const,queryFn:({signal})=>api<ViewerMetadata>('/datasets/'+id+'/viewer',undefined,'GET',signal),staleTime:60_000});
export function rowsOptions(id:string,params:ViewerParams){
  const search=new URLSearchParams({config:params.config,split:params.split,...(params.field?{field:params.field}:{}),search:params.search,offset:String(params.offset),limit:String(params.limit),...(params.sort?{sort:params.sort,order:params.order??'asc'}:{}),...(params.column?{column:params.column,value:params.value??'null'}:{})});
  return queryOptions({queryKey:['dataset',id,'rows',params] as const,queryFn:({signal})=>api<ViewerPage>('/datasets/'+id+'/rows?'+search,undefined,'GET',signal),enabled:Boolean(params.config&&params.split),staleTime:q=>q.state.data?.status==='ready'?60_000:0,refetchInterval:q=>q.state.status==='error'?false:q.state.data?.status==='indexing'?1000:false,
    // Keep pagination steady only within the same source scope and search.
    placeholderData:(previous,previousQuery)=>{const old=previousQuery?.queryKey[3];return old&&previous?.status==='ready'&&previousQuery?.queryKey[1]===id&&old.config===params.config&&old.split===params.split&&old.field===params.field&&old.revision===params.revision&&old.search===params.search&&old.sort===params.sort&&old.order===params.order&&old.column===params.column&&old.value===params.value?previous:undefined;}});
}
export const rowOptions=(id:string,index:number,params:Pick<ViewerParams,'config'|'split'|'field'|'revision'>)=>queryOptions({queryKey:['dataset',id,'row',params,index] as const,queryFn:({signal})=>api<ViewerRow>(`/datasets/${id}/rows/${index}?`+new URLSearchParams({config:params.config,split:params.split,...(params.field?{field:params.field}:{})}),undefined,'GET',signal),staleTime:q=>q.state.data?.status==='ready'?60_000:0,refetchInterval:q=>q.state.status==='error'?false:q.state.data?.status==='indexing'?1000:false});

export const cardOptions=(id:string,revision?:string|null)=>queryOptions({queryKey:['dataset',id,'card',revision] as const,queryFn:({signal})=>api<import('../src/shared/dataset-card').UpstreamDatasetCard>('/datasets/'+encodeURIComponent(id)+'/card',undefined,'GET',signal),staleTime:60_000});
