import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryClient,isCancelledError} from '@tanstack/react-query';
import {rowsOptions,rowOptions} from '../web/query.js';

test('Dataset queries separate scope/search/page/row caches, reuse ready results and abort superseded HTTP requests',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),previousFetch=globalThis.fetch;
  const calls:{url:string;signal?:AbortSignal|null}[]=[];
  globalThis.fetch=(async(input,init)=>{
    const url=String(input);calls.push({url,signal:init?.signal});
    if(url.includes('search=slow'))return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    return new Response(JSON.stringify(url.includes('/rows/25?')?{status:'ready',data:{text:'full record'},source:'test.jsonl'}:{status:'ready',total:57,allTotal:57,items:[{index:Number(new URL(url,'http://local').searchParams.get('offset')??0),values:{text:url},truncatedFields:[]}],columns:[{name:'text',type:'string'}]}),{status:200,headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  const params={config:'eval',split:'train',field:'',search:'',offset:0,limit:25};
  try{
    const first=rowsOptions('wildjailbreak',params);await client.fetchQuery(first);await client.fetchQuery(first);assert.equal(calls.length,1);
    const next=rowsOptions('wildjailbreak',{...params,offset:25});assert.notDeepEqual(first.queryKey,next.queryKey);assert.equal((await client.fetchQuery(next)).items![0].index,25);
    for(const patch of [{split:'test'},{config:'other'},{field:'label'},{search:'safe'},{revision:'new-source-revision'},{sort:'label',order:'desc'},{column:'label',value:'"safe"'}])assert.notDeepEqual(rowsOptions('wildjailbreak',{...params,...patch}).queryKey,first.queryKey);
    assert.notDeepEqual(rowsOptions('aegis',params).queryKey,first.queryKey);
    const detail=rowOptions('wildjailbreak',25,params);await client.fetchQuery(detail);assert.match(calls.at(-1)!.url,/\/rows\/25\?/);
    const slow=rowsOptions('wildjailbreak',{...params,search:'slow'}),pending=client.fetchQuery(slow).catch(error=>error);
    await client.cancelQueries({queryKey:slow.queryKey});assert.ok(isCancelledError(await pending));assert.equal(calls.at(-1)!.signal?.aborted,true);
  }finally{client.clear();globalThis.fetch=previousFetch;}
});
