import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {queryClient,targetDetailOptions} from './query';
import {ArrowRight,Plus,Pencil,X,Play,Cable,KeyRound,Clock3,SlidersHorizontal,Link2,RefreshCw} from 'lucide-react';
import type {TargetItem,JsonObject} from '../src/shared/types';
import {Button,Input,NativeSelect,ResourceHeader,ResourceList,Table,Thead,Tbody,Tr,Th,Td,StateTag,Sheet,SheetTitle,SheetDescription} from './ui';
import {api,adapterName} from './api';
import {AdapterMark} from './brand';
import {DeleteResource} from './resource-actions';

type Props={targets:TargetItem[];refresh:()=>Promise<void>;notify:(message:string)=>void;start:(id:string)=>void};
const modeLabel=(target:TargetItem['target'])=>target.outputMode==='paired'?'Paired response':'Standalone text';
const credentialLabel=(item:TargetItem)=>!item.target.apiKeyEnv?'No credential configured':item.credentialAvailable?'Credential available':'Credential missing';
export function TargetPage({targets,refresh,notify,start,id}:{id?:string}&Props){
  const[editing,setEditing]=useState<TargetItem|null|undefined>(()=>new URLSearchParams(location.hash.split('?')[1]??'').has('create')?null:undefined);
  const detailQuery=useQuery(targetDetailOptions(id));
  const item=detailQuery.isError?undefined:detailQuery.data?.item;
  function changed(message:string){notify(message);void refresh();}
  const deletion=(target:TargetItem)=><DeleteResource kind="Target" id={target.id} name={target.name} onDelete={()=>api('/targets/'+target.id,undefined,'DELETE')} onSuccess={()=>{changed('Target deleted permanently.');if(id)location.hash='/targets';}}/>;
  return <>
    {id?<div className="resource-detail-page target-detail-page">{item?<>
      <ResourceHeader title={item.name} description={adapterName(item.target.adapter)+' · Test destination'} icon={<AdapterMark adapter={item.target.adapter}/>} back={{href:'#/targets',label:'All Targets'}} actions={<><Button variant="outline" onClick={()=>setEditing(item)}><Pencil/>Edit Target</Button>{deletion(item)}<Button onClick={()=>start(item.id)} disabled={!item.credentialAvailable}><Play/>Start testing</Button></>}/>
      <div className="target-detail-panels"><section className="target-detail-panel"><h2><Link2 aria-hidden="true"/>Connection</h2><div className="connection-url"><span className="metric-label">Runtime URL</span><code>{item.target.url}</code></div><div className="target-credential"><span className="metric-label"><KeyRound aria-hidden="true"/>Credential</span><StateTag state={!item.target.apiKeyEnv?'none':item.credentialAvailable?'available':'unavailable'} label={credentialLabel(item)}/>{item.target.apiKeyEnv&&<code>{item.target.apiKeyEnv}</code>}<p className="help">{item.target.apiKeyEnv?'This references a server environment variable. Secret values are not stored here.':'This Target is configured without a credential reference.'}</p></div><p className="target-connection-note">Configuration only. Credential availability does not verify that the Target is reachable.</p></section>
      <section className="target-detail-panel"><h2><SlidersHorizontal aria-hidden="true"/>Scan behavior</h2><dl className="target-scan-facts"><div><dt>Adapter</dt><dd><span className="adapter-label"><AdapterMark adapter={item.target.adapter}/>{adapterName(item.target.adapter)}</span></dd></div><div><dt>Output mode</dt><dd>{modeLabel(item.target)}</dd></div><div><dt>Request timeout</dt><dd>{(item.target.timeoutMs??30000).toLocaleString()} ms</dd></div></dl><p className="help">{item.target.adapter==='f5-scan'?'F5 scans input and saved response text independently. Original prompt and conversation history are not sent with the response.':item.target.outputMode==='paired'?'Response testing checks the original input before checking the saved model response. An input rejection can skip the output check.':'Response testing sends the saved model response as a standalone check.'}</p></section></div>
      <div className="target-record-meta"><span>Target ID <code>{item.id}</code></span><span>Changes apply to new tests. Existing Reports keep their frozen configuration.</span></div>
      <section className="target-usage-note"><Cable aria-hidden="true"/><div><h3>Use this Target in a test</h3><p>Start testing from Report, select this Target, then choose the Datasets, source scope, concurrency and repeats. The runtime URL should point to an Endpoint published in Guard.</p></div></section>
    </>:<div className="empty"><h2>{detailQuery.isPending?'Loading Target…':'Target unavailable'}</h2><p>{detailQuery.error?.message??'Return to the Target list or refresh.'}</p><a href="#/targets">All Targets</a><Button variant="outline" onClick={()=>{void detailQuery.refetch();void refresh();}}>Refresh</Button></div>}</div>:<>
      <ResourceHeader title="Targets" count={targets.length+' configured'} description="Manage the Guard connections used by your tests." icon={<Cable aria-hidden="true"/>} actions={<><Button variant="outline" onClick={()=>void refresh()}><RefreshCw/>Refresh</Button><Button onClick={()=>setEditing(null)}><Plus/>Create Target</Button></>}/>
      <ResourceList density="compact" items={targets} label="Targets" searchText={t=>t.name+' '+t.target.url+' '+t.id+' '+adapterName(t.target.adapter)} action={null} emptyDescription="Create a Target with a runtime URL and Adapter, then select it when starting a test.">
        {items=><Table className="resource-table target-list-table"><Thead><Tr><Th>Name</Th><Th>Runtime URL</Th><Th>Adapter</Th><Th>Scan mode</Th><Th>Credential</Th><Th>Timeout</Th><Th>Actions</Th></Tr></Thead><Tbody>{items.map(t=><Tr key={t.id}><Td><a className="target-row-name" href={'#/targets/'+t.id} aria-label={'View Target '+t.name}>{t.name}</a></Td><Td><code className="target-row-url" title={t.target.url}>{t.target.url}</code></Td><Td><span className="adapter-label"><AdapterMark adapter={t.target.adapter}/>{adapterName(t.target.adapter)}</span></Td><Td>{modeLabel(t.target)}</Td><Td><StateTag state={!t.target.apiKeyEnv?'none':t.credentialAvailable?'available':'unavailable'} label={!t.target.apiKeyEnv?'Not required':t.credentialAvailable?'Available':'Missing'}/>{t.target.apiKeyEnv&&<small className="technical target-credential-env" title={t.target.apiKeyEnv}>{t.target.apiKeyEnv}</small>}</Td><Td className="number">{((t.target.timeoutMs??30000)/1000).toLocaleString()} s</Td><Td><div className="resource-actions"><Button variant="ghost" onClick={()=>setEditing(t)} aria-label={'Edit Target '+t.name}><Pencil/>Edit</Button>{deletion(t)}</div></Td></Tr>)}</Tbody></Table>}
      </ResourceList><p className="help target-list-note">Publish the Endpoint in Guard, then add its runtime URL as a Target here. Connection reachability is verified when you run a test.</p>
    </>}
    {editing!==undefined&&<TargetForm item={editing} close={()=>setEditing(undefined)} done={async item=>{setEditing(undefined);await refresh();notify(editing?'Target updated. Existing tests keep their saved configuration.':'Target created.');if(!editing)location.hash='/targets/'+item.id;}}/>}
  </>;
}

function TargetForm({item,close,done}:{item:TargetItem|null;close:()=>void;done:(target:TargetItem)=>Promise<void>}){
  const[adapter,setAdapter]=useState(item?.target.adapter??'litellm-generic-guardrail');
  const mutation=useMutation({mutationFn:(payload:JsonObject)=>api<{item:TargetItem}>(item?'/targets/'+item.id:'/targets',payload,item?'PUT':'POST'),onSuccess:async response=>{await queryClient.invalidateQueries({queryKey:['target',response.item.id]});await done(response.item);}});
  const busy=mutation.isPending,error=mutation.error?.message??'';
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const form=new FormData(e.currentTarget);
    try{
      const target={...(adapter==='litellm-generic-guardrail'&&item?.target.adapter===adapter?item.target:{}),adapter,url:String(form.get('url')),outputMode:adapter==='f5-scan'?'standalone':String(form.get('outputMode')),timeoutMs:Number(form.get('timeoutMs')),
        ...(form.get('apiKeyEnv')?{apiKeyEnv:String(form.get('apiKeyEnv'))}:{apiKeyEnv:undefined}),...(adapter==='f5-scan'?{verbose:form.get('verbose')==='on'}:{})};
      await mutation.mutateAsync({name:String(form.get('name')),target,version:item?.version});
    }catch{/* Mutation state owns the persistent form error. */}
  }
  return <Sheet onClose={close} busy={busy}><form onSubmit={e=>void submit(e)}><div className="dialog-header"><div><SheetTitle>{item?'Edit Target':'Create Target'}</SheetTitle><SheetDescription>Configure a test destination. For Guard, use a published Endpoint runtime URL.</SheetDescription></div><Button variant="ghost" disabled={busy} onClick={close} aria-label="Close Target form"><X/></Button></div>
    <fieldset className="dialog-body" disabled={busy}>{error&&<div className="notice error" role="alert">{error}</div>}
      <label>Target name<Input name="name" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}" defaultValue={item?.name??''} placeholder="uat-content-safety" required/></label>
      <label><span className="adapter-label"><AdapterMark adapter={adapter}/>Adapter</span><NativeSelect value={adapter} onChange={e=>setAdapter(e.target.value as typeof adapter)}><option value="litellm-generic-guardrail">LiteLLM</option><option value="f5-scan">F5 Scan</option></NativeSelect></label>
      <label>Runtime URL<Input name="url" type="url" defaultValue={item?.target.url??''} placeholder={adapter==='f5-scan'?'http://localhost:38082/runtime/v1/endpoints/…/backend/v1/scans':'http://localhost:38082/runtime/v1/endpoints/…/beta/litellm_basic_guardrail_api'} required/></label>
      <label>Credential environment variable (optional)<Input name="apiKeyEnv" pattern="[A-Z_][A-Z0-9_]*" defaultValue={item?.target.apiKeyEnv??''} placeholder="TALI_GUARD_API_KEY"/></label><p className="help">Enter the variable name, not the secret. Leave blank for a local Target that requires no authentication.</p>
      {adapter==='litellm-generic-guardrail'?<label>Output mode<NativeSelect name="outputMode" defaultValue={item?.target.outputMode??'paired'}><option value="paired">Paired with input</option><option value="standalone">Standalone response</option></NativeSelect></label>:<><div className="notice">F5 scans input and saved response text independently. Prompt/history are not transmitted; flagOnly=false is enforced for scoring.</div><label className="checkbox"><input type="checkbox" name="verbose" defaultChecked={item?.target.verbose??true}/>Include detailed scanner results</label></>}
      <label>Request timeout (ms)<Input name="timeoutMs" type="number" min="1" defaultValue={item?.target.timeoutMs??30000} required/></label>
      {item&&<p className="help">Target ID stays unchanged when you rename it. Changes apply to future tests.</p>}
    </fieldset><footer><Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy?'Saving…':item?'Save changes':'Create Target'}</Button></footer></form></Sheet>;
}
