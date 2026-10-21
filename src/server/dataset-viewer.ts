import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,statSync,renameSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {catalog,loadRows} from '../core/datasets.js';
import {sourcePath} from '../core/raw.js';
import {hash,json,root} from '../core/files.js';
import type {JsonObject} from '../shared/types.js';

type Scope={config:string;split:string;recommended:boolean;files:string[];available:boolean;fields:string[]};
export type Column={name:string;type:string;stats?:{count:number;missing:number;min:number;max:number;bins:number[];values?:{value:string;count:number}[]}};
type Stats={count:number;min:number;max:number;bins:number[];values:Map<string,number>|null};
const jsonPath=(name:string)=>'$.'+JSON.stringify(name);
type Job={indexedRows:number;error?:string;controller:AbortController;promise:Promise<void>};
export type ViewerQuery={config?:string;split?:string;field?:string;offset?:string;limit?:string;search?:string;sort?:string;order?:string;column?:string;value?:string};
const fail=(message:string,statusCode=400):never=>{throw Object.assign(new Error(message),{statusCode});};
function integer(value:string|undefined,fallback:number,min:number,max:number){
  const n=value===undefined?fallback:Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max||value==='')fail('Invalid pagination parameter');
  return n;
}
const fieldType=(value:unknown)=>value===null?'null':Array.isArray(value)?'list':typeof value==='object'?'object':typeof value;

/** Index original records once. Pages and searches never send the whole corpus to the browser. */
export async function buildRowIndex(file:string,sources:string[],field?:string,options:{signal?:AbortSignal;onProgress?:(count:number)=>void}={}){
  const temporary=file+'.'+randomUUID()+'.partial',columns=new Map<string,string>(),stats=new Map<string,Stats>();
  mkdirSync(join(file,'..'),{recursive:true,mode:0o700});
  const db=new DatabaseSync(temporary);chmodSync(temporary,0o600);let count=0;
  try{
    db.exec('CREATE TABLE records (row_index INTEGER PRIMARY KEY, source TEXT NOT NULL, data TEXT NOT NULL, search_text TEXT NOT NULL); CREATE TABLE metadata (data TEXT NOT NULL); BEGIN');
    const insert=db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)');
    for(const source of sources)for await(const value of loadRows(source,field)){
      if(options.signal?.aborted)throw new Error('Viewer preparation cancelled');
      const row=value&&typeof value==='object'&&!Array.isArray(value)?value:{value};
      for(const [name,v] of Object.entries(row)){
        const type=fieldType(v),prior=columns.get(name);
        columns.set(name,!prior||prior==='null'?type:type==='null'||prior===type?prior:'mixed');
        if(v!==null&&v!==undefined){
          const stat=stats.get(name)??{count:0,min:Infinity,max:-Infinity,bins:Array(16).fill(0),values:new Map<string,number>()};
          const text=typeof v==='string'?v:JSON.stringify(v),n=typeof v==='number'?v:text.length;
          stat.count++;stat.min=Math.min(stat.min,n);stat.max=Math.max(stat.max,n);stat.bins[Math.min(15,Math.floor(Math.log2((typeof v==='number'?Math.abs(v):text.length)+1)))]++;
          if(stat.values){const value=JSON.stringify(v);if(value.length>100||(!stat.values.has(value)&&stat.values.size>=24))stat.values=null;else stat.values.set(value,(stat.values.get(value)??0)+1);}
          stats.set(name,stat);
        }
      }
      const data=JSON.stringify(row);insert.run(count++,source.split('/').at(-1)!,data,data.toLowerCase());
      if(count%500===0){options.onProgress?.(count);db.exec('COMMIT; BEGIN');await setImmediate();}
    }
    const metadata={total:count,columns:[...columns].map(([name,type])=>{const s=stats.get(name);return {name,type,stats:{count:s?.count??0,missing:count-(s?.count??0),min:s?.min??0,max:s?.max??0,bins:s?.bins??[],...(s?.values?{values:[...s.values].map(([value,n])=>({value,count:n})).sort((a,b)=>b.count-a.count)}:{})}};})};
    db.prepare('INSERT INTO metadata VALUES (?)').run(JSON.stringify(metadata));db.exec('COMMIT');db.close();
    renameSync(temporary,file);options.onProgress?.(count);return metadata;
  }catch(error){try{db.close();}catch{}throw error;}
  finally{rmSync(temporary,{force:true});rmSync(temporary+'-journal',{force:true});}
}
export function readRowPage(file:string,query:ViewerQuery={}){
  const offset=integer(query.offset,0,0,Number.MAX_SAFE_INTEGER),limit=integer(query.limit,25,1,100),search=query.search?.trim()??'';
  if(search.length>200)fail('Search must be 200 characters or fewer');
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const metadata=JSON.parse(String(db.prepare('SELECT data FROM metadata').get()!.data));
    const names=metadata.columns.map((c:Column)=>c.name);
    if(query.sort&&!names.includes(query.sort))fail('Unknown sort column');
    if(query.order&&!['asc','desc'].includes(query.order))fail('Sort order must be asc or desc');
    if(query.column&&!names.includes(query.column))fail('Unknown filter column');
    if(query.column&&query.value===undefined)fail('A filter value is required');
    if((query.value?.length??0)>1000)fail('Filter value is too long');
    if(query.column){try{JSON.parse(query.value!);}catch{fail('Filter value must be JSON');}}
    const conditions:string[]=[],bindings:(string|number)[]=[];
    if(search){conditions.push('instr(search_text, ?) > 0');bindings.push(search.toLowerCase());}
    if(query.column){conditions.push('json_quote(json_extract(data, ?)) = ?');bindings.push(jsonPath(query.column),query.value!);}
    const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
    const total=conditions.length?Number(db.prepare('SELECT COUNT(*) AS n FROM records'+where).get(...bindings)!.n):metadata.total;
    const order=query.sort?'json_extract(data, ?) '+(query.order==='desc'?'DESC':'ASC')+', row_index':'row_index';
    const records=db.prepare('SELECT row_index, data FROM records'+where+' ORDER BY '+order+' LIMIT ? OFFSET ?').all(...bindings,...(query.sort?[jsonPath(query.sort)]:[]),limit,offset);
    const items=records.map(record=>{
      const data=JSON.parse(String(record.data)),truncatedFields:string[]=[];
      const values=Object.fromEntries(Object.entries(data).map(([key,value])=>{
        const text=typeof value==='string'?value:JSON.stringify(value);
        if(text.length>400)truncatedFields.push(key);
        return [key,text.length>400?text.slice(0,400)+'…':text];
      }));
      return {index:Number(record.row_index),values,truncatedFields};
    });
    return {status:'ready' as const,items,total,allTotal:metadata.total,columns:metadata.columns as Column[],offset,limit};
  }finally{db.close();}
}
export function readRow(file:string,index:string){
  const n=integer(index,0,0,Number.MAX_SAFE_INTEGER),db=new DatabaseSync(file,{readOnly:true});
  try{
    const row=db.prepare('SELECT data, source FROM records WHERE row_index = ?').get(n);
    if(!row)fail('Row not found',404);
    return {index:n,source:row!.source,data:JSON.parse(String(row!.data))};
  }finally{db.close();}
}

export class DatasetViewer{
  private jobs=new Map<string,Job>();
  private categories=new Map<string,{mtime:number;fields:string[]}>();
  metadata(id:string){
    const entry=catalog().find(e=>e.id===id)??fail('Dataset not found',404);
    const groups=new Map<string,JsonObject>();
    for(const spec of entry.files){
      const key=JSON.stringify([spec.config,spec.split]);
      if(!groups.has(key))groups.set(key,{config:spec.config,split:spec.split,recommended:spec.default!==false,files:[]});
      groups.get(key)!.files.push(spec.path);
    }
    // Browsing archived training rows never changes the held-out Testing default.
    if(id==='aegis')for(const split of ['train','validation'])groups.set(JSON.stringify(['default',split]),{config:'default',split,recommended:false,files:[split+'.json','refusals_'+split+'.json']});
    const scopes:Scope[]=[...groups.values()].map(scope=>{
      const paths=scope.files.map((p:string)=>sourcePath(id,p)),available=paths.every((p:string)=>existsSync(p));
      let fields:string[]=[];
      if(id==='safety-prompts'&&available){
        const path=paths[0],mtime=statSync(path).mtimeMs,cached=this.categories.get(path);
        if(cached?.mtime===mtime)fields=cached.fields;
        else{fields=Object.entries(json<JsonObject>(path)).filter(([,v])=>Array.isArray(v)).map(([key])=>key);this.categories.set(path,{mtime,fields});}
      }
      return {...scope,available,fields} as Scope;
    });
    return {id:entry.id,revision:entry.revision,source:entry.url,notes:entry.notes,scopes};
  }
  private index(id:string,query:ViewerQuery){
    const metadata=this.metadata(id),first=metadata.scopes.find(s=>s.recommended)??metadata.scopes[0];
    const config=query.config??first?.config,split=query.split??metadata.scopes.find(s=>s.config===config)?.split;
    const scope=metadata.scopes.find(s=>s.config===config&&s.split===split)??fail('Unknown Dataset subset or split');
    if(!scope.available)fail('This scope is not archived locally. Download the pinned raw files with the CLI first.');
    const field=scope.fields.length?(query.field??scope.fields[0]):undefined;
    if(query.field&&(!field||!scope.fields.includes(query.field)))fail('Unknown Dataset category');
    const paths=scope.files.map((p:string)=>sourcePath(id,p));
    const key=hash({version:3,id,revision:metadata.revision,field,files:paths.map((path:string)=>({path,size:statSync(path).size,mtime:statSync(path).mtimeMs}))});
    const file=join(root,'.cache/dataset-viewer',key+'.sqlite');
    if(existsSync(file))return {file,scope,field};
    const existing=this.jobs.get(key);
    if(existing?.error){this.jobs.delete(key);fail('Could not prepare the local viewer: '+existing.error);}
    if(!existing&&[...this.jobs.values()].filter(job=>!job.error).length>=2)return {status:'indexing' as const,indexedRows:0,scope,field,queued:true};
    if(!existing){
      const controller=new AbortController(),job:Job={indexedRows:0,controller,promise:Promise.resolve()};this.jobs.set(key,job);
      job.promise=buildRowIndex(file,paths,field,{signal:controller.signal,onProgress:n=>{job.indexedRows=n;}}).then(()=>{this.jobs.delete(key);}).catch(error=>{job.error=error instanceof Error?error.message:'Unknown source error';});
    }
    return {status:'indexing' as const,indexedRows:this.jobs.get(key)!.indexedRows,scope,field};
  }
  rows(id:string,query:ViewerQuery){
    integer(query.offset,0,0,Number.MAX_SAFE_INTEGER);integer(query.limit,25,1,100);
    if((query.search?.length??0)>200)fail('Search must be 200 characters or fewer');
    const index=this.index(id,query);
    return 'file'in index?{...readRowPage(index.file!,query),scope:index.scope,field:index.field}:index;
  }
  row(id:string,index:string,query:ViewerQuery){
    integer(index,0,0,Number.MAX_SAFE_INTEGER);
    const state=this.index(id,query);
    return 'file'in state?{status:'ready',...readRow(state.file!,index)}:state;
  }
  async close(){for(const job of this.jobs.values())job.controller.abort();await Promise.allSettled([...this.jobs.values()].map(job=>job.promise));}
}
