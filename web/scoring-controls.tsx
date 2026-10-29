import {useState} from 'react';
import {Plus,Trash2,RotateCcw,X,SlidersHorizontal} from 'lucide-react';
import {useMutation} from '@tanstack/react-query';
import {defaultScorer,protectionScorer,ACTIONS,validateScorer,type ScorerConfig,type TextAssertion} from '../src/shared/scorer';
import {api} from './api';
import {Button,Input,NativeSelect,Sheet,SheetTitle,SheetDescription} from './ui';

function policy(config:ScorerConfig){return JSON.stringify(config.acceptedActions)===JSON.stringify(defaultScorer().acceptedActions)?'strict':JSON.stringify(config.acceptedActions)===JSON.stringify(protectionScorer().acceptedActions)?'protect':'custom';}
export function ScoringFields({config,onChange}:{config:ScorerConfig;onChange:(config:ScorerConfig)=>void}){
  const[custom,setCustom]=useState(false);
  const mode=custom?'custom':policy(config);
  const update=(patch:Partial<ScorerConfig>)=>onChange({...config,...patch});
  const updateAssertion=(index:number,patch:Partial<TextAssertion>)=>update({assertions:config.assertions.map((a,i)=>i===index?{...a,...patch}:a)});
  return <div className="scoring-fields">
    <label>Rule set name<Input value={config.name} maxLength={80} required onChange={e=>update({name:e.target.value})}/></label>
    <label>Action matching<NativeSelect value={mode} onChange={e=>{const value=e.target.value;setCustom(value==='custom');if(value==='strict')onChange({...config,name:'Strict action matching',acceptedActions:defaultScorer().acceptedActions});else if(value==='protect')onChange({...config,name:'Block or transform',acceptedActions:protectionScorer().acceptedActions});else update({name:'Custom action matching'});}}><option value="strict">Exact action match</option><option value="protect">Accept block or transform for expected block</option><option value="custom">Custom accepted actions</option></NativeSelect></label>
    <p className="help">{mode==='strict'?'The observed action must match the Dataset expectation exactly.':mode==='protect'?'An expected block also passes when the Target transforms the content. Expected allow and transform still require an exact match.':'Choose which observed actions satisfy each Dataset expectation.'}</p>
    {mode==='custom'&&<div className="scoring-action-matrix"><table><caption>Accepted observed actions</caption><thead><tr><th>Expected</th>{ACTIONS.map(a=><th key={a}>{a}</th>)}</tr></thead><tbody>{ACTIONS.map(expected=><tr key={expected}><th>{expected}</th>{ACTIONS.map(observed=><td key={observed}><label><input type="checkbox" aria-label={`Accept ${observed} for expected ${expected}`} checked={config.acceptedActions[expected].includes(observed)} onChange={e=>{const current=config.acceptedActions[expected];update({acceptedActions:{...config.acceptedActions,[expected]:e.target.checked?[...current,observed]:current.filter(a=>a!==observed)}});}}/></label></td>)}</tr>)}</tbody></table></div>}
    <label className="checkbox"><input type="checkbox" checked={config.checkPii} onChange={e=>update({checkPii:e.target.checked})}/>Check removal of annotated PII values</label>
    <p className="help">For expected transformations with PII annotations, returned text must be non-empty and contain none of those values.</p>
    <details className="scoring-extra-checks" open={config.assertions.length>0}><summary>Additional text checks {config.assertions.length>0&&`(${config.assertions.length})`}</summary><p className="help">Native promptfoo assertions check the Target's returned text. These checks are local and make no model calls.</p>
      {config.assertions.map((a,index)=><div className="scoring-text-check" key={index}><div><label>Check {index+1}<NativeSelect value={a.type} onChange={e=>updateAssertion(index,{type:e.target.value as TextAssertion['type'],value:e.target.value==='is-json'?undefined:a.value??''})}><option value="contains">Contains</option><option value="not-contains">Does not contain</option><option value="equals">Equals</option><option value="is-json">Valid JSON</option></NativeSelect></label><label>Apply to<NativeSelect value={a.scope} onChange={e=>updateAssertion(index,{scope:e.target.value as TextAssertion['scope']})}><option value="transformed">Expected transformations</option><option value="all">All completed checks</option></NativeSelect></label><Button variant="ghost" aria-label={'Remove text check '+(index+1)} onClick={()=>update({assertions:config.assertions.filter((_,i)=>i!==index)})}><Trash2/></Button></div>{a.type!=='is-json'&&<label>Value<Input aria-label={'Text check '+(index+1)+' value'} value={a.value??''} maxLength={2000} required onChange={e=>updateAssertion(index,{value:e.target.value})}/></label>}</div>)}
      <Button variant="outline" disabled={config.assertions.length>=20} onClick={()=>update({assertions:[...config.assertions,{type:'contains',value:'',scope:'transformed'}]})}><Plus/>Add text check</Button>
    </details>
  </div>;
}
export function RescoreForm({id,initial,close,done}:{id:string;initial?:ScorerConfig;close:()=>void;done:(id:string)=>void}){
  const[config,setConfig]=useState<ScorerConfig>(()=>initial?structuredClone(initial):defaultScorer()),[validation,setValidation]=useState('');
  const mutation=useMutation({mutationFn:(scorer:ScorerConfig)=>api<{id:string}>('/runs/'+id+'/rescore',{scorer}),onSuccess:result=>done(result.id)});
  const busy=mutation.isPending,error=validation||mutation.error?.message;
  return <Sheet onClose={close} busy={busy} className="rescore-sheet"><form onSubmit={e=>{e.preventDefault();try{setValidation('');const scorer=validateScorer(config);mutation.mutate(scorer);}catch(e){setValidation((e as Error).message);}}}>
    <div className="dialog-header"><div><SheetTitle><SlidersHorizontal aria-hidden="true"/>Re-score saved results</SheetTitle><SheetDescription>Apply different scoring rules to this Report's recorded requests and responses.</SheetDescription></div><Button variant="ghost" disabled={busy} onClick={close} aria-label="Close re-scoring"><X/></Button></div>
    <fieldset className="dialog-body" disabled={busy}>{error&&<div className="notice error" role="alert">{error}</div>}<div className="scoring-offline-note"><RotateCcw aria-hidden="true"/><div><strong>No additional Target calls</strong><p>Original evidence, timing and earlier scores are preserved. A new scoring version appears in this Report.</p></div></div><ScoringFields config={config} onChange={value=>{setConfig(value);setValidation('');}}/><p className="help">This version uses Veritas default evaluation thresholds: 100% completed coverage and 100% scoring match rate. Thresholds and their source appear in Metadata. Select Original scoring to inspect the original test's custom thresholds and baseline assessment.</p></fieldset>
    <footer><span className="help" role="status">{busy?'Re-scoring saved checks with promptfoo…':'Local scoring · no Target or model calls'}</span><Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}><RotateCcw/>{busy?'Re-scoring…':'Re-score results'}</Button></footer>
  </form></Sheet>;
}
