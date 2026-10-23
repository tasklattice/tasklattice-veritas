import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, realpathSync, mkdirSync, writeFileSync, copyFileSync, openSync, writeSync, closeSync, renameSync, rmSync} from 'node:fs';
import {join, dirname, resolve, sep} from 'node:path';
import {parse} from 'csv-parse/sync';
import {hash, json, root} from './files.js';
import type {JsonObject, Case, Phase} from '../shared/types.js';

export const CREDDATA_REVISION = '9a7a7e10b929de46a075ef4f5c83c4a310f3be57';
export const CREDDATA_CONVERTER = 'creddata-context-v1';
export type CredentialType = 'password' | 'api-key' | 'token' | 'private-key';
export interface CredAnnotation {
  Id: string; FileID: string; RepoName: string; FilePath: string;
  LineStart: number; LineEnd: number; ValueStart: number; ValueEnd: number;
  GroundTruth: 'T' | 'F' | 'X'; Category: string; CryptographyKey: string; PredefinedPattern: string;
}

/** Scope is explicit: UUIDs, salts, nonces, bucket names and domains alone are not secrets. */
export function credentialTypes(category: string): CredentialType[] {
  const tags = category.split(':');
  const types = new Set<CredentialType>();
  for (const tag of tags) {
    if (/private key|^JWK$|^NKEY Seed$|^PASERK Keys$/i.test(tag)) types.add('private-key');
    else if (/password|^URL Credentials$|^Basic Authorization$/i.test(tag)) types.add('password');
    else if (/token|bearer|oauth|otp|2fa/i.test(tag)) types.add('token');
    else if (/^(API|Key|Secret|Credential|Auth)$|api key|app secret|credentials|access key|^AWS Client ID$|^(AWS|Google|Alibaba|Twilio) Multi$|^CMD Secret$/i.test(tag)) types.add('api-key');
  }
  return [...types].sort();
}

export function parseCredAnnotations(csv: string): CredAnnotation[] {
  return (parse(csv, {columns:true, bom:true, skip_empty_lines:true}) as JsonObject[]).map((r: JsonObject) => {
    if (!/^[0-9]+$/.test(r.Id) || !['T','F','X'].includes(r.GroundTruth) || typeof r.Category !== 'string' || !r.Category) throw new Error('Invalid CredData annotation');
    const row = {...r};
    for (const key of ['LineStart','LineEnd','ValueStart','ValueEnd']) {
      row[key] = r[key] === '' ? -1 : Number(r[key]);
      if (!Number.isSafeInteger(row[key])) throw new Error('Invalid CredData position');
    }
    if (row.LineStart < 1 || row.LineEnd < row.LineStart) throw new Error('Invalid CredData line interval');
    if (!/^data\/[a-f0-9]{8}\//.test(r.FilePath) || r.FilePath.split('/').some((p:string) => !p || p === '.' || p === '..') || r.FilePath.includes('\\')) throw new Error('Invalid CredData file path');
    return row as CredAnnotation;
  });
}

function invalidSpan(row: CredAnnotation, line: string): boolean {
  return row.LineStart === row.LineEnd && row.ValueStart >= 0 && row.ValueEnd >= 0 && (row.ValueEnd < row.ValueStart || row.ValueEnd > [...line].length);
}

/** Merge overlapping annotated lines: a negative annotation beside a secret is not a safe request. */
export function credDataRecords(text: string, annotations: CredAnnotation[], sourceFile: string): JsonObject[] {
  const normalized = text.replace(/\r\n?/g, '\n'), lines = normalized.split('\n');
  const sorted = [...annotations].sort((a,b) => a.LineStart-b.LineStart || a.LineEnd-b.LineEnd || Number(a.Id)-Number(b.Id));
  const groups: {start:number; end:number; rows:CredAnnotation[]}[] = [];
  for (const row of sorted) {
    if (row.FilePath !== sourceFile || row.LineEnd > lines.length || row.LineStart < 1) throw new Error('CredData annotation is outside its source file');
    const last = groups.at(-1);
    if (last && row.LineStart <= last.end) {last.end = Math.max(last.end, row.LineEnd); last.rows.push(row);}
    else groups.push({start:row.LineStart, end:row.LineEnd, rows:[row]});
  }
  const sourceSha256 = hash(text);
  return groups.map(group => {
    const positive = group.rows.filter(r => r.GroundTruth === 'T');
    const eligible = positive.filter(r => credentialTypes(r.Category).length);
    const uncertain = group.rows.some(r => r.GroundTruth === 'X');
    const invalidAnnotations = group.rows.filter(r=>invalidSpan(r, lines[r.LineStart-1])).map(r=>r.Id);
    const expected = invalidAnnotations.length ? null : eligible.length ? 'block' : positive.length || uncertain ? null : 'allow';
    const content = lines.slice(group.start-1,group.end).join('\n');
    if (!content.trim()) throw new Error('Empty annotated CredData request');
    return {schemaVersion:1, converter:CREDDATA_CONVERTER,
      id:hash({sourceFile,start:group.start,end:group.end}).slice(0,24), text:content, expected,
      credentialTypes:[...new Set((positive.length ? positive : group.rows).flatMap(r=>credentialTypes(r.Category)))].sort(),
      categories:[...new Set(group.rows.flatMap(r=>r.Category.split(':')))].sort(),
      sourceLabels:[...new Set(group.rows.map(r=>r.GroundTruth))].sort(),
      invalidAnnotations, reviewReason:invalidAnnotations.length ? 'invalid-source-value-span' : expected === null ? positive.length ? 'positive-outside-credential-scope' : 'upstream-unknown' : null,
      sourceFile, sourceSha256, sourceRevision:CREDDATA_REVISION,
      lineStart:group.start, lineEnd:group.end, annotations:group.rows,
      preprocessing:'upstream-obfuscate_creds-noise-0'};
  });
}

export function normalizeCredData(row: JsonObject, options: {phase:Phase|'both';config:string;split:string}): Case[] {
  if (row.schemaVersion !== 1 || row.converter !== CREDDATA_CONVERTER || row.sourceRevision !== CREDDATA_REVISION || row.preprocessing !== 'upstream-obfuscate_creds-noise-0' || typeof row.text !== 'string' || !row.text.trim() || !Array.isArray(row.annotations) || !row.annotations.length) throw new Error('CredData requires the pinned reconstructed records; run datasets reconstruct creddata first');
  if (!['allow','block',null].includes(row.expected)) throw new Error('Invalid CredData expected action');
  const positive = row.annotations.filter((a:CredAnnotation) => a.GroundTruth === 'T');
  const requestLines = row.text.split('\n');
  if (!Number.isSafeInteger(row.lineStart) || !Number.isSafeInteger(row.lineEnd) || row.lineEnd-row.lineStart+1 !== requestLines.length || row.annotations.some((a:CredAnnotation)=>a.LineStart<row.lineStart || a.LineEnd>row.lineEnd || a.LineStart>a.LineEnd)) throw new Error('CredData annotations do not match request lines');
  const invalidAnnotations = row.annotations.filter((a:CredAnnotation)=>invalidSpan(a,requestLines[a.LineStart-row.lineStart])).map((a:CredAnnotation)=>a.Id);
  const expected = invalidAnnotations.length ? null : positive.some((a:CredAnnotation)=>credentialTypes(a.Category).length) ? 'block' : positive.length || row.annotations.some((a:CredAnnotation)=>a.GroundTruth==='X') ? null : 'allow';
  if (row.annotations.some((a:CredAnnotation)=>!['T','F','X'].includes(a.GroundTruth)) || expected !== row.expected) throw new Error('CredData expected action contradicts source annotations');
  const phases:Phase[] = options.phase === 'both' ? ['input','output'] : [options.phase];
  return phases.map(phase=>({id:'creddata:'+hash({revision:CREDDATA_REVISION,converter:CREDDATA_CONVERTER,row,phase,config:options.config,split:options.split}).slice(0,24),
    dataset:'creddata',phase,text:row.text,expected,config:options.config,split:options.split,
    metadata:{sourceId:row.id,sourceRevision:row.sourceRevision,sourceFile:row.sourceFile,sourceSha256:row.sourceSha256,
      lineStart:row.lineStart,lineEnd:row.lineEnd,sourceLabels:row.sourceLabels,category:row.categories,credentialTypes:row.credentialTypes,
      annotations:row.annotations,invalidAnnotations,reviewReason:row.reviewReason,preprocessing:row.preprocessing,labelSource:'source-annotations-credential-block-policy'}}));
}

function safeFile(base: string, relative: string) {
  const path = resolve(base,relative), real = realpathSync(path), realBase = realpathSync(base);
  if (!path.startsWith(resolve(base)+sep) || !real.startsWith(realBase+sep)) throw new Error('CredData path escapes its reconstruction');
  return path;
}
function walk(base:string, relative=''):string[] {
  return readdirSync(join(base,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=>{
    if (e.isSymbolicLink()) throw new Error('Symlinks are not supported in a CredData archive');
    const path=relative?relative+'/'+e.name:e.name;
    return e.isDirectory()?walk(base,path):e.isFile()?[path]:[];
  });
}

/** Package official obfuscated output; never downloads repositories or runs untrusted source code. */
export function reconstructCredData(sourceDir:string, out:string) {
  const source = resolve(sourceDir), destination=resolve(out);
  if (existsSync(destination)) throw new Error('Archive output exists; choose a new directory');
  const entry = json<JsonObject>(join(root,'catalog/raw-datasets.lock.json')).datasets.find((e:JsonObject)=>e.id==='creddata');
  if (entry?.revision !== CREDDATA_REVISION) throw new Error('CredData lock revision mismatch');
  const work = destination+'.partial';
  if (existsSync(work)) throw new Error('Incomplete archive exists; inspect it before retrying');
  mkdirSync(work,{recursive:true,mode:0o700});
  const files:JsonObject[] = [], all:CredAnnotation[] = [], ids=new Set<string>();
  const counts:JsonObject={annotations:0,sourceLabels:{T:0,F:0,X:0},sourceFiles:0,requests:0,block:0,allow:0,needsReview:0,credentialTypes:{},multilineRequests:0};
  try {
    for (const spec of entry.files.filter((f:JsonObject)=>!f.generated)) {
      const path=safeFile(source,spec.path), bytes=readFileSync(path);
      const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (bytes.length!==spec.size || (spec.gitBlob ? blob!==spec.gitBlob : hash(bytes)!==spec.sha256)) throw new Error('CredData pinned source mismatch: '+spec.path);
      const target=join(work,spec.path);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,bytes,{mode:0o600});
      if (spec.path.startsWith('meta/') && spec.path.endsWith('.csv')) for(const annotation of parseCredAnnotations(bytes.toString('utf8'))) {
        if (ids.has(annotation.Id)) throw new Error('Duplicate CredData annotation ID');
        ids.add(annotation.Id);all.push(annotation);counts.annotations++;counts.sourceLabels[annotation.GroundTruth]++;
      }
    }
    // Keep all reconstructed files and their licenses, but never copy tmp/ source checkouts.
    for(const relative of walk(join(source,'data'))) {
      const path=safeFile(source,'data/'+relative),bytes=readFileSync(path),target=join(work,'data',relative);
      mkdirSync(dirname(target),{recursive:true,mode:0o700});copyFileSync(path,target);
      files.push({path:'data/'+relative,size:bytes.length,sha256:hash(bytes)});
    }
    const byFile=new Map<string,CredAnnotation[]>();
    for(const row of all) {const rows=byFile.get(row.FilePath)??[];rows.push(row);byFile.set(row.FilePath,rows);}
    mkdirSync(join(work,'records'),{mode:0o700});
    const reviewed=openSync(join(work,'records/reviewed.jsonl'),'wx',0o600),unknown=openSync(join(work,'records/needs-review.jsonl'),'wx',0o600);
    try {
      for(const [file,rows] of [...byFile].sort(([a],[b])=>a.localeCompare(b,'en'))) {
        const content=readFileSync(safeFile(work,file),'utf8');counts.sourceFiles++;
        for(const record of credDataRecords(content,rows,file)) {
          counts.requests++;counts[record.expected??'needsReview']++;if(record.lineEnd>record.lineStart)counts.multilineRequests++;
          if(record.expected==='block')for(const type of record.credentialTypes)counts.credentialTypes[type]=(counts.credentialTypes[type]??0)+1;
          writeSync(record.expected===null?unknown:reviewed,JSON.stringify(record)+'\n');
        }
      }
    } finally {closeSync(reviewed);closeSync(unknown);}
    writeFileSync(join(work,'reconstruction.json'),JSON.stringify({schemaVersion:1,source:'https://github.com/Samsung/CredData',revision:CREDDATA_REVISION,converter:CREDDATA_CONVERTER,preprocessing:'upstream-obfuscate_creds-noise-0',counts,files},null,2)+'\n',{mode:0o600});
    const generated=['records/reviewed.jsonl','records/needs-review.jsonl','reconstruction.json'].map(path=>{const bytes=readFileSync(join(work,path));return {path,size:bytes.length,sha256:hash(bytes),generated:true};});
    for(const spec of entry.files.filter((f:JsonObject)=>f.generated)) {
      const actual=generated.find(f=>f.path===spec.path);
      if(!actual || actual.size!==spec.size || actual.sha256!==spec.sha256)throw new Error('CredData reconstruction differs from the pinned output: '+spec.path);
    }
    renameSync(work,destination);return {directory:destination,revision:CREDDATA_REVISION,counts,generated};
  } catch(error) {rmSync(work,{recursive:true,force:true});throw error;}
}
