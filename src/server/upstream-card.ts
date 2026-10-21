import {existsSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseDocument} from 'yaml';
import {json,root} from '../core/files.js';
import {sourcePath} from '../core/raw.js';
import {catalog} from '../core/datasets.js';
import {cardHeadings} from '../shared/card-markdown.js';
import type {UpstreamDatasetCard} from '../shared/dataset-card.js';
import type {JsonObject} from '../shared/types.js';
const fail=(message:string,statusCode=400):never=>{throw Object.assign(new Error(message),{statusCode});};
const imageTypes:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'};

/** Read only pinned, lock-listed documentation; never fetch on a page request. */
function entryFor(id:string){
  const declared=catalog().find(c=>c.id===id)??fail('Dataset not found',404),entry=json<JsonObject>(join(root,'catalog/raw-datasets.lock.json')).datasets.find((e:JsonObject)=>e.id===id)??fail('Dataset archive not found',404);
  if(declared.revision!==entry.revision)fail('The Dataset catalog and raw archive revisions do not match',409);
  return entry;
}
export function readPinnedCardFile(id:string,entry:JsonObject,filename:string,maxBytes:number){
  const spec=entry.files.find((f:JsonObject)=>f.path===filename)??fail('File is not in the pinned archive',404),path=sourcePath(id,filename);
  if(!existsSync(path))fail('The upstream Dataset card is not archived locally. Download the pinned raw archive with the CLI.',404);
  if(statSync(path).size>maxBytes)fail('This archived card file exceeds the display limit',413);
  const bytes=readFileSync(path),sha256=createHash('sha256').update(bytes).digest('hex'),gitBlob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(bytes.length!==spec.size||(spec.sha256?sha256!==spec.sha256:gitBlob!==spec.gitBlob))fail('The local Dataset card does not match its pinned archive. Restore the original raw snapshot.',409);
  return {bytes,sha256};
}
export function parseCardDocument(raw:string){
  const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw),frontmatter=match?.[1]??'',markdown=match?raw.slice(match[0].length):raw;
  let metadata:Record<string,unknown>={},metadataError:string|undefined;
  if(match)try{const doc=parseDocument(frontmatter,{uniqueKeys:false});if(doc.errors.length)throw doc.errors[0];const value=doc.toJS({maxAliasCount:50});if(value&&typeof value==='object'&&!Array.isArray(value))metadata=value;else throw new Error('Metadata must be a mapping');}catch{metadataError='Upstream metadata could not be parsed; the original YAML is preserved below.';}
  return {frontmatter,markdown,metadata,...(metadataError?{metadataError}:{})};
}
export function upstreamCard(id:string):UpstreamDatasetCard{
  const entry=entryFor(id),filename=entry.files.find((f:JsonObject)=>/^readme\.(md|markdown)$/i.test(f.path))?.path??fail('No upstream README is listed in this archive',404),file=readPinnedCardFile(id,entry,filename,2*1024*1024),raw=file.bytes.toString('utf8'),parsed=parseCardDocument(raw);
  return {id,repository:entry.repo,publisher:entry.repo.split('/')[0],source:entry.source,revision:entry.revision,filename,sourceUrl:entry.url,readmeUrl:(entry.source==='hf'?'https://huggingface.co/datasets/':'https://github.com/')+entry.repo+'/blob/'+entry.revision+'/'+filename,license:entry.license??null,bytes:file.bytes.length,sha256:file.sha256,...parsed,raw,headings:cardHeadings(parsed.markdown),assets:entry.files.filter((f:JsonObject)=>imageTypes[f.path.split('.').at(-1)!.toLowerCase()]&&existsSync(sourcePath(id,f.path))).map((f:JsonObject)=>f.path)};
}
export function upstreamCardAsset(id:string,path:string){
  if(typeof path!=='string')fail('An archived image path is required');
  const entry=entryFor(id),mime=imageTypes[path.split('.').at(-1)!.toLowerCase()];
  if(!mime)fail('Only archived raster images are supported',404);
  const file=readPinnedCardFile(id,entry,path,10*1024*1024);return {...file,mime};
}
