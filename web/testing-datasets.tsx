import {useState} from 'react';
import {Search,X,Check,ChevronDown,SlidersHorizontal,ExternalLink} from 'lucide-react';
import type {DatasetCard,JsonObject} from '../src/shared/types';
import {Button,Input,NativeSelect} from './ui';
import {PublisherMark,SourceMark,datasetName,sourceName} from './brand';
import {directionLabel,type DatasetOptions} from './testing-model';

export function TestingDatasets({cards,selected,onChange,disabled}:{cards:DatasetCard[];selected:string[];onChange:(ids:string[])=>void;disabled:boolean}){
  const[search,setSearch]=useState('');
  const visible=cards.filter(c=>`${c.repository} ${c.name} ${datasetName(c)} ${c.publisher}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <fieldset className="testing-dataset-picker" disabled={disabled}><legend className="visually-hidden">Datasets</legend>
    <div className="testing-picker-toolbar"><div className="search-control"><Search aria-hidden="true"/><Input type="search" aria-label="Search Datasets" placeholder="Search Datasets by name or publisher…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<Button variant="ghost" className="search-clear" aria-label="Clear Dataset search" onClick={()=>setSearch('')}><X/></Button>}</div><span role="status">{selected.length} selected</span></div>
    {selected.length>0&&<div className="testing-selected-datasets" aria-label="Selected Datasets">{selected.map(id=>{const card=cards.find(c=>c.id===id);return <span key={id}><PublisherMark publisher={card?.publisher??'Local'} size="sm"/><span>{card?datasetName(card):id}</span><Button variant="ghost" aria-label={'Remove '+(card?datasetName(card):id)} onClick={()=>onChange(selected.filter(x=>x!==id))}><X/></Button></span>;})}</div>}
    <div className="testing-dataset-grid">{visible.map(card=><label className={'testing-dataset-choice'+(selected.includes(card.id)?' selected':'')} key={card.id}><input type="checkbox" aria-label={card.repository??card.id} checked={selected.includes(card.id)} disabled={!card.rawAvailable} onChange={e=>onChange(e.target.checked?[...selected,card.id]:selected.filter(id=>id!==card.id))}/><PublisherMark publisher={card.publisher} size="md"/><span className="testing-choice-text"><strong>{datasetName(card)}</strong><small title={card.repository??undefined}>{card.repository??card.publisher}</small><span className="testing-choice-source"><SourceMark source={card.source}/>{sourceName(card.source)}{!card.rawAvailable?' · Archive required':''}</span></span><Check className="testing-choice-check" aria-hidden="true"/></label>)}</div>
    {!visible.length&&<div className="testing-picker-empty"><Search aria-hidden="true"/><h3>No matching Datasets</h3><p>Try another name or publisher.</p><Button variant="outline" onClick={()=>setSearch('')}>Clear Dataset search</Button></div>}
  </fieldset>;
}

export function DatasetTestOptions({card,entry,value,onChange}:{card:DatasetCard;entry?:JsonObject;value:DatasetOptions;onChange:(value:DatasetOptions)=>void}){
  const id=card.id,directions=['aegis','safety-prompts','pii'].includes(id)?['input','output']:id==='beavertails'?['output']:['input'];
  const changed=value.sourceSpec!==''||value.phase!==''||value.field!==''||value.domain!=='';
  return <details className="testing-source-options" open={id==='topic-control'?true:undefined}>
    <summary><PublisherMark publisher={card.publisher} size="sm"/><span><strong>{datasetName(card)}</strong><small>{value.sourceSpec!==''?entry?.files[Number(value.sourceSpec)]?.config+' · '+entry?.files[Number(value.sourceSpec)]?.split:'Recommended scope'} · {directionLabel(id,value,entry)}</small></span><span className="testing-settings-label"><SlidersHorizontal aria-hidden="true"/>{changed?'Customized':'Settings'}<ChevronDown aria-hidden="true"/></span></summary>
    <div className="testing-source-options-body"><div className="testing-field-pair"><label>Source scope<NativeSelect aria-label={'Source scope for '+datasetName(card)} value={value.sourceSpec} onChange={e=>onChange({...value,sourceSpec:e.target.value})} disabled={!entry}><option value="">Recommended benchmark scope</option>{entry?.files.map((f:JsonObject,i:number)=><option value={i} key={i}>{f.config} · {f.split}</option>)}</NativeSelect></label><label>Scan direction<NativeSelect aria-label={'Scan direction for '+datasetName(card)} value={value.phase} onChange={e=>onChange({...value,phase:e.target.value as DatasetOptions['phase']})}><option value="">Dataset default · {directionLabel(id,{...value,phase:''},entry)}</option>{directions.map(d=><option key={d} value={d}>{d==='input'?'Input checks':'Saved response checks'}</option>)}</NativeSelect></label></div>
      {id==='safety-prompts'&&<label>Category (optional)<Input aria-label={'Category for '+datasetName(card)} value={value.field} onChange={e=>onChange({...value,field:e.target.value})} placeholder="All categories in the selected file"/></label>}
      {id==='topic-control'&&<label>Policy domain<Input aria-label={'Policy domain for '+datasetName(card)} value={value.domain} onChange={e=>onChange({...value,domain:e.target.value})} placeholder="Domain matching the Guard Endpoint policy" required/></label>}
      <p className="help">{entry?.notes??'Loading Dataset configuration…'}</p>{card.url&&<a className="testing-source-link" href={card.url} target="_blank" rel="noreferrer">View original source card<ExternalLink aria-hidden="true"/></a>}
    </div>
  </details>;
}
