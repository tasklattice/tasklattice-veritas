import {piiEvidence} from '../shared/pii.js';
import { SnapshotMetadataCache } from './snapshot-metadata.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, rmSync, renameSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, hash, json, lines, save } from '../core/files.js';
import { validateTarget } from '../core/provider.js';
import { catalog } from '../core/datasets.js';
import {isActiveRun,validateSampling,type RunStage} from '../shared/testing.js';
import {gateReport} from '../core/gates.js';
import { prepareEvaluationDataset,resolveDatasetSelections } from './prepare-evaluation.js';
import { buildDatasetCards, datasetIdForSelection } from './dataset-cards.js';
import { score } from '../core/scoring.js';
import {validateScorer} from '../shared/scorer.js';
import {activeScoringId,scoringDirectory,scoringHistory,selectedScoring,rescoreRun,scoringBusy} from '../core/scoring-revisions.js';
import {compareEvidence} from '../core/comparison.js';
import {readEvidence} from '../core/grading.js';
import {recordsForScoring} from '../core/execution-evidence.js';
import {withEvaluationEvidence} from '../core/guard-evidence.js';
import {validatePurpose} from '../shared/benchmark.js';
import {withClassification} from '../core/classification.js';
import type {ActivitySnapshot, RunActivity} from '../shared/activity.js';
import type {Attempt} from '../shared/types.js';
import { prepareRun, runEvaluation, type RunOptions } from '../core/service.js';
import type { Case, DatasetItem, JsonObject, RunItem, RunRequest, TargetItem } from '../shared/types.js';

function folders(path: string, depth = 0): string[] {
  if (!existsSync(path) || depth > 3) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap(e => !e.isDirectory() || ['raw', '.cache', 'node_modules'].includes(e.name) ? [] : [join(path, e.name), ...folders(join(path, e.name), depth + 1)]);
}
const datasetCache = new Map<string, {mtime: number; value: DatasetItem}>();
export function datasets(): DatasetItem[] {
  return folders(join(root, 'data')).filter(p => existsSync(join(p, 'cases.jsonl'))).map(p => {
    try {
      const mtime = statSync(join(p, 'cases.jsonl')).mtimeMs;
      if (datasetCache.get(p)?.mtime === mtime) return datasetCache.get(p)!.value;
      const cases = lines<Case>(join(p, 'cases.jsonl'));
      const manifest = existsSync(join(p, 'manifest.json')) ? json<JsonObject>(join(p, 'manifest.json')) : {};
      const files: JsonObject[] = manifest.files ?? [];
      const value = { id: hash(relative(root, p)).slice(0, 20), name: relative(join(root, 'data'), p), path: p, cases: cases.length,
        unlabeled: cases.filter(c => c.expected === null).length, phases: [...new Set(cases.map(c => c.phase))], datasets: [...new Set(cases.map(c => c.dataset))], configs: [...new Set<string>(files.map(f => f.config).filter(Boolean))], splits: [...new Set<string>(files.map(f => f.split).filter(Boolean))], revision: manifest.revision ?? null, category: manifest.field ?? null };
      datasetCache.set(p, {mtime, value}); return value;
    } catch { return null; }
  }).filter((v): v is DatasetItem => v !== null);
}
export function datasetCards(includeLocal = false) {
  const cards = buildDatasetCards(catalog(), datasets());
  for (const card of cards) if (card.revision) {
    const manifest = join(root, 'data/raw', card.id, card.revision, '_download-manifest.json');
    try { card.rawAvailable = existsSync(manifest) && json<JsonObject>(manifest).status === 'complete'; } catch { card.rawAvailable = false; }
  }
  return includeLocal ? cards : cards.filter(c => c.source !== 'local');
}
function failure(message: string, statusCode = 400): never {throw Object.assign(new Error(message), {statusCode});}
function targetState(id: string) {return join(root, 'data/target-state', id);}
let bundledTargetsMigrated=false;
function migrateBundledTargets(){
  if(bundledTargetsMigrated)return;
  const examples=join(root,'examples');
  for(const file of existsSync(examples)?readdirSync(examples).filter(n=>n.endsWith('.target.json')):[]){
    const original=join(examples,file),id=hash(relative(root,original)).slice(0,20),legacyState=targetState(id),metadataPath=join(legacyState,'metadata.json');
    const metadata=existsSync(metadataPath)?json<JsonObject>(metadataPath):{};
    if(metadata.deletedAt||metadata.migratedTo)continue;
    const target=validateTarget(json(metadata.configFile?join(legacyState,metadata.configFile):original));
    const managed=join(root,'data/targets','seed-'+id+'.json'),state=targetState(hash(relative(root,managed)).slice(0,20));
    mkdirSync(join(root,'data/targets'),{recursive:true,mode:0o700});mkdirSync(state,{recursive:true,mode:0o700});mkdirSync(legacyState,{recursive:true,mode:0o700});
    saveJob(managed,target);saveJob(join(state,'metadata.json'),{id,name:metadata.name??file.replace(/\.target\.json$/,''),updatedAt:metadata.updatedAt??statSync(original).mtime.toISOString()});
    // Examples remain documentation files; the managed registry owns their lifecycle.
    saveJob(metadataPath,{...metadata,migratedTo:relative(root,managed)});
  }
  bundledTargetsMigrated=true;
}
type TargetRecord=TargetItem & {path:string;original:string;state:string};
export function targets(): TargetRecord[] {
  migrateBundledTargets();
  const directories = [join(root, 'data/targets')];
  return directories.flatMap(dir => !existsSync(dir) ? [] : readdirSync(dir).filter(n => n.endsWith('.json') && (dir.endsWith('targets') || n.endsWith('.target.json'))).flatMap(n => {
    try {
      const original=join(dir,n),legacyId=hash(relative(root,original)).slice(0,20),state=targetState(legacyId);
      const metadata=existsSync(join(state,'metadata.json'))?json<JsonObject>(join(state,'metadata.json')):{};
      // Compatibility only: previously deleted resources must not reappear.
      if(metadata.deletedAt)return [];
      const path=metadata.configFile?join(state,metadata.configFile):original,target=validateTarget(json(path));
      const name=metadata.name??n.replace(/\.target\.json$|\.json$/g,'');
      return [{id:metadata.id??legacyId,name,target,path,original,state,credentialAvailable:!target.apiKeyEnv||!!process.env[target.apiKeyEnv],updatedAt:metadata.updatedAt??statSync(original).mtime.toISOString(),version:hash({name,target})}];
    }catch{return [];}
  }));
}
export function getTarget(id:string){return targets().find(t=>t.id===id)??failure('Target not found',404);}
export function targetPath(id:string){return getTarget(id).path;}
function validateTargetName(name:unknown,exceptId?:string){
  if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name))failure('Name must contain 1–64 letters, numbers, underscores or hyphens');
  if(targets().some(t=>t.id!==exceptId&&t.name===name))failure('Target name already exists',409);
  return name as string;
}
export function saveTarget(input:JsonObject){
  const name=validateTargetName(input.name),target=validateTarget(input.target),dir=join(root,'data/targets');
  let path=join(dir,name+'.json');
  if(existsSync(path)&&(!existsSync(join(targetState(hash(relative(root,path)).slice(0,20)),'metadata.json'))||!json<JsonObject>(join(targetState(hash(relative(root,path)).slice(0,20)),'metadata.json')).deletedAt))path=join(dir,name+'-'+randomUUID()+'.json');
  const legacyId=hash(relative(root,path)).slice(0,20),state=targetState(legacyId),metadataPath=join(state,'metadata.json');
  const previous=existsSync(metadataPath)?json<JsonObject>(metadataPath):{};
  if(existsSync(path)&&!previous.deletedAt)failure('Target name already exists',409);
  mkdirSync(dir,{recursive:true,mode:0o700});mkdirSync(state,{recursive:true,mode:0o700});
  const id=randomUUID();saveJob(path,target);saveJob(metadataPath,{id,name,updatedAt:new Date().toISOString()});
  return getTarget(id);
}
export function updateTarget(id:string,input:JsonObject){
  const current=getTarget(id);
  if(input.version&&input.version!==current.version)failure('This Target changed. Close this form and reopen it to load the latest configuration.',409);
  const name=validateTargetName(input.name,id),target=validateTarget(input.target),state=current.state;
  mkdirSync(state,{recursive:true,mode:0o700});
  const configFile=randomUUID()+'.json';saveJob(join(state,configFile),target);
  saveJob(join(state,'metadata.json'),{id:current.id,name,configFile,updatedAt:new Date().toISOString()});
  return getTarget(id);
}
export function deleteTarget(id:string){
  const current=getTarget(id);
  rmSync(current.original,{force:true});rmSync(current.state,{recursive:true,force:true});
  return {id};
}

function saveJob(path: string, value: JsonObject) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {save(temporary, value); renameSync(temporary, path);}
  finally {rmSync(temporary, {force: true});}
}

export class RunStore {
  constructor(private prepare = prepareEvaluationDataset) {}
  private controllers = new Map<string, AbortController>();
  private queue: {id: string; options: RunOptions; request?:RunRequest; catalogHash?:string}[] = [];
  private busy = false;
  private scoringController?: AbortController;
  private baselines = new Map<string,string>();
  private snapshotMetadata = new SnapshotMetadataCache();
  list(): RunItem[] {
    const jobsDir = join(root, 'data/jobs');
    const jobs = existsSync(jobsDir) ? readdirSync(jobsDir).filter(n => n.endsWith('.json')).flatMap(n => {try {return [json<RunItem>(join(jobsDir, n))];} catch {return [];}}) : [];
    const jobsByName = new Map(jobs.map(j => [j.name, j]));
    const dirs = new Set([...folders(join(root, 'runs')).filter(dir => existsSync(join(dir, 'snapshot.json'))), ...jobs.map(j => join(root, 'runs', j.name))]);
    return [...dirs].flatMap(dir => {
      try {
        const job = jobsByName.get(relative(join(root, 'runs'), dir));
        const snapshot = this.snapshotMetadata.get(join(dir, 'snapshot.json'));
        const scoringId=activeScoringId(dir),view=scoringDirectory(dir,scoringId);
        const report = existsSync(join(view, 'report.json')) ? json(join(view, 'report.json')) : null;
        const gate = existsSync(join(view, 'gate.json')) ? json(join(view, 'gate.json')) : undefined;
        const name = relative(join(root, 'runs'), dir), id = Buffer.from(name).toString('base64url');
        const deletedFile = join(root, 'data/deleted-reports', id + '.json'), deletedAt = existsSync(deletedFile) ? json(deletedFile).deletedAt : undefined;
        if (deletedAt) return [];
        let status = job?.status ?? (report ? ((report.summary?.errors || report.summary?.missing) ? 'failed' : 'completed') : 'interrupted');
        if (isActiveRun(status) && !this.controllers.has(id)) status = 'interrupted';
        return [{ ...job, id, name, status, targetId: job?.targetId ?? job?.endpointId ?? job?.target, targetName: job?.targetName ?? job?.endpointName, createdAt: job?.createdAt ?? snapshot?.createdAt ?? '', adapter: snapshot?.adapter ?? report?.adapter ?? job?.adapter,
          datasetIds: job?.datasetIds ?? snapshot?.datasetIds ?? [],
          evidence: snapshot?.evidence ?? report?.evidence ?? job?.evidence, dataset: job?.dataset ?? snapshot?.datasetIds.join(', ') ?? '',
          summary: report?.summary, gate, scoringId, scoringName:report?.scoring?.name, path: dir }];
      } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  directory(id: string) { const run = this.list().find(r => r.id === id) as RunItem & {path: string} | undefined; if (!run) failure('Report not found', 404); return run.path; }
  detail(id: string, scoringId?: string) {
    const run = this.list().find(r => r.id === id); if (!run) failure('Report not found',404);
    const path = this.directory(id);
    const snapshot = existsSync(join(path, 'snapshot.json')) ? json<JsonObject>(join(path, 'snapshot.json')) : null;
    const pending=existsSync(join(root,'data/job-requests',id+'.json'))?json<JsonObject>(join(root,'data/job-requests',id+'.json')):null;
    const target = snapshot?.target??(pending?json(join(root,'data/job-targets',id+'.json')):null),selected=selectedScoring(path,scoringId),history=scoringHistory(path);
    const report = selected.report && snapshot ? withClassification(selected.report, snapshot, withEvaluationEvidence(path,recordsForScoring(path,existsSync(join(path,'attempts.jsonl')) ? lines<Attempt>(join(path,'attempts.jsonl')) : [],selected.saved?.metadata))) : selected.report;
    return {run:{...run,summary:report?.summary,gate:selected.gate}, report,
      scoring:{selectedId:selected.id,versions:history,config:history.find(v=>v.id===selected.id)?.config,canRescore:snapshot?.schemaVersion===3 && !isActiveRun(run.status) && existsSync(join(path,'execution.json')) && existsSync(join(path,'attempts.jsonl')),busy:scoringBusy(path),offline:selected.id!=='original'},
      configuration: snapshot ? {testPurpose:validatePurpose(snapshot.testPurpose),selection:snapshot.selection,gradesAvailable: !!selected.saved || snapshot.schemaVersion === 3 && snapshot.scorerHash === hash(readFileSync(join(root, 'src/core/scoring.ts'))), createdAt: snapshot.createdAt, repeat: snapshot.repeat, concurrency: snapshot.concurrency, caseCount: snapshot.cases?.length,
        engine: snapshot.engine, scorer: snapshot.scorer, skippedUnlabeled: snapshot.skippedUnlabeled, evidence: snapshot.evidence,
        target: target ? {url: target.url, adapter: target.adapter, outputMode: target.outputMode, timeoutMs: target.timeoutMs, apiKeyEnv: target.apiKeyEnv} : null,
        sources: Array.isArray(snapshot.manifest?.sources) ? snapshot.manifest.sources : snapshot.manifest?.sources && typeof snapshot.manifest.sources === 'object' ? Object.entries(snapshot.manifest.sources).map(([dataset, source]) => ({dataset, ...(source && typeof source === 'object' ? source : {source})})) : snapshot.manifest ? [snapshot.manifest] : []} : pending?{testPurpose:validatePurpose(pending.testPurpose),gradesAvailable:false,repeat:pending.repeat,concurrency:pending.concurrency,scorer:pending.scorer?.name,selection:pending.sampling,target,sources:pending.datasets?.map((s:JsonObject)=>({dataset:s.datasetId,config:s.config,split:s.split,phase:s.phase})),caseCount:null}:null};
  }
  compare(id:string,baselineId:string,options:{scoring?:string;baselineScoring?:string;filter?:string;dataset?:string;offset?:number;limit?:number}={}) {
    if(id===baselineId)failure('Choose a different Report as the baseline');
    const load=(runId:string,scoring?:string)=>{
      const run=this.list().find(r=>r.id===runId);if(!run)failure('Report not found',404);
      if(isActiveRun(run.status))failure('Wait for both tests to finish before comparing',409);
      const dir=this.directory(runId);if(!existsSync(join(dir,'snapshot.json')))failure('This Report has no prepared case evidence',409);
      const source=readEvidence(dir),selected=selectedScoring(dir,scoring);
      if(!selected.report)failure('Report summary is unavailable',409);
      const records=withEvaluationEvidence(dir,recordsForScoring(dir,source.records,selected.saved?.metadata));
      return {run,selected,source,evidence:{snapshot:source.snapshot,records,grades:selected.saved?.grades,scorerHash:selected.saved?.metadata.scorerHash,report:withClassification(selected.report!,source.snapshot,records)}};
    };
    const a=load(baselineId,options.baselineScoring),b=load(id,options.scoring),result=compareEvidence(a.evidence,b.evidence);
    const filter=options.filter??'all';if(filter!=='all'&&!Object.hasOwn(result.counts,filter))failure('Unknown comparison filter');
    const offset=options.offset??0,limit=options.limit??25;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)failure('Invalid comparison pagination');
    const rows=result.rows.filter(r=>(filter==='all'||r.change===filter)&&(!options.dataset||r.dataset===options.dataset));
    const identity=(v:typeof a)=>({id:v.run.id,name:v.run.name,scoringId:v.selected.id,scoringName:v.selected.report!.scoring?.name??'Historical scoring'});
    const {rows:_rows,...summary}=result;
    return {...summary,baseline:identity(a),candidate:identity(b),total:rows.length,offset,limit,items:rows.slice(offset,offset+limit)};
  }
  activity(id: string): RunActivity {
    const run = this.list().find(r => r.id === id); if (!run) failure('Report not found',404);
    const path = this.directory(id);
    const saved = existsSync(join(path,'activity.json')) ? json<ActivitySnapshot>(join(path,'activity.json')) : null;
    const active = isActiveRun(run.status);
    return {...(saved ?? {schemaVersion:1, phase:active?'testing':'finished', updatedAt:run.createdAt,
      total:run.progress?.total??0, started:0, finished:0, completed:0, errors:0, skipped:0, active:[], recent:[]}),
      stage:run.stage, phase: active ? saved?.phase??'testing' : 'finished', available: !!saved, runStatus:run.status, serverTime:new Date().toISOString(),
      queuePosition:run.status==='queued'?Math.max(0,this.queue.findIndex(q=>q.id===id))+1:undefined,
      concurrency:saved?.concurrency, timeoutMs:saved?.timeoutMs, caseCount:saved?.caseCount,
      active:active?(saved?.active??[]):[], recent:(saved?.recent??[])} as RunActivity;
  }
  async start(request: RunRequest) {
    if (!request || typeof request !== 'object') throw new Error('Testing configuration is required');
    const testPurpose=validatePurpose(request.testPurpose);
    const scorer=validateScorer(request.scorer),sampling=validateSampling(request.sampling);
    if (request.datasets === undefined && (request.selectionId || !catalog().some(e => e.id === request.datasetId))) return this.enqueue(request);
    const selections=resolveDatasetSelections(request);
    const endpoint=targets().find(t=>t.id===(request.targetId??request.endpointId));if(!endpoint)throw new Error('Target not found; create a Target first');
    if (!endpoint.credentialAvailable) throw new Error('Set ' + endpoint.target.apiKeyEnv + ' before running');
    for (const n of [request.repeat??1,request.concurrency??2]) if (!Number.isSafeInteger(n)||n<1||n>100) throw new Error('Repeat and concurrency must be whole numbers between 1 and 100');
    if(request.skipUnlabeled!==undefined&&typeof request.skipUnlabeled!=='boolean')throw new Error('skipUnlabeled must be boolean');
    const evidence=request.evidence??'endpoint';if(!['endpoint','synthetic-local-demo'].includes(evidence))throw new Error('Invalid evidence type');
    if(request.gate!==undefined&&(!request.gate||typeof request.gate!=='object'||Array.isArray(request.gate)))throw new Error('Gate must be an object');
    gateReport({summary:{coverage:1,accuracy:1,falsePositiveRate:0,falseNegativeRate:0,latencyMs:{p95:0}}},request.gate,{accuracyDrop:0});
    if(request.gate?.maxAccuracyDrop!==undefined&&!request.baselineId)throw new Error('maxAccuracyDrop requires a baseline');
    const baseline=request.baselineId?this.directory(request.baselineId):undefined;
    const name='run-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,6),id=Buffer.from(name).toString('base64url');
    const frozen=structuredClone({...request,testPurpose,scorer,sampling,repeat:request.repeat??1,concurrency:request.concurrency??2,evidence});
    for(const dir of ['jobs','job-targets','job-requests'])mkdirSync(join(root,'data',dir),{recursive:true,mode:0o700});
    const target=join(root,'data/job-targets',id+'.json');saveJob(target,endpoint.target);saveJob(join(root,'data/job-requests',id+'.json'),frozen);
    const now=new Date().toISOString();
    saveJob(join(root,'data/jobs',id+'.json'),{id,name,status:'queued',createdAt:now,targetId:endpoint.id,targetName:endpoint.name,endpointId:endpoint.id,endpointName:endpoint.name,adapter:endpoint.target.adapter,
      datasetIds:selections.map(s=>s.entry.id),...(selections.length===1?{datasetId:selections[0].entry.id}:{}),dataset:selections.map(s=>s.entry.repo).join(' + '),evidence,
      stage:{stage:'queued',message:'Waiting to prepare Datasets',updatedAt:now}});
    this.controllers.set(id,new AbortController());if(baseline)this.baselines.set(id,baseline);
    this.queue.push({id,request:frozen,catalogHash:hash(catalog()),options:{testPurpose,data:'',target,out:join(root,'runs',name),scorer,repeat:frozen.repeat,concurrency:frozen.concurrency,evidence,skipUnlabeled:frozen.skipUnlabeled,gate:frozen.gate,baseline}});
    // Return the Report ID before source verification, conversion, or SDK startup.
    setImmediate(()=>void this.pump());return {id};
  }
  enqueue(request: RunRequest) {
    const dataset = datasets().find(d => d.id === (request.selectionId ?? request.datasetId));
    if (request.selectionId && dataset) {
      const expected = request.datasets?.map(s => s.datasetId).sort();
      if (expected ? JSON.stringify(expected) !== JSON.stringify([...dataset.datasets].sort()) : datasetIdForSelection(dataset) !== request.datasetId) throw new Error('Selected input copy does not belong to the requested Datasets');
    }
    if (!dataset) throw new Error('Dataset not found; choose a source Dataset or a valid imported-copy ID');
    const endpointId = request.endpointId ?? request.targetId;
    const endpoint = targets().find(t => t.id === endpointId);
    if (!endpoint) throw new Error('Target not found');
    const card = datasetCards(true).find(c => c.id === datasetIdForSelection(dataset))!;
    const name = 'run-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 6);
    const path = join(root, 'runs', name), id = Buffer.from(name).toString('base64url');
    const options: RunOptions = { testPurpose:request.testPurpose,sampling:request.sampling,scorer:request.scorer, data: dataset.path, target: targetPath(endpoint.id), out: path, repeat: request.repeat, concurrency: request.concurrency,
      limit: request.limit, phase: request.phase, skipUnlabeled: request.skipUnlabeled, evidence: request.evidence, gate: request.gate, baseline: request.baselineId ? this.directory(request.baselineId) : undefined };
    const prepared = prepareRun(options);
    // A queued test must keep the exact Target it was started with, even after an edit/delete.
    mkdirSync(join(root, 'data/job-targets'), {recursive: true, mode: 0o700});
    options.target = join(root, 'data/job-targets', id + '.json'); saveJob(options.target, prepared.target);
    mkdirSync(join(root, 'data/jobs'), { recursive: true, mode: 0o700 });
    const controller = new AbortController(); this.controllers.set(id, controller);
    saveJob(join(root, 'data/jobs', id + '.json'), { id, name, status: 'queued', createdAt: new Date().toISOString(), dataset: request.datasets ? request.datasets.map(s => catalog().find(e => e.id === s.datasetId)!.repo).join(' + ') : card.name, datasetIds: [...dataset.datasets], ...(dataset.datasets.length === 1 ? {datasetId: dataset.datasets[0]} : {}), selectionId: dataset.id, targetId: endpoint.id, targetName: endpoint.name, endpointId: endpoint.id, endpointName: endpoint.name, target: endpoint.id, adapter: prepared.target.adapter, evidence: prepared.evidence,
      progress: { completed: 0, total: prepared.cases.length * prepared.repeat } });
    if(options.baseline)this.baselines.set(id,options.baseline);
    this.queue.push({ id, options }); void this.pump();
    return { id };
  }
  private update(id: string, values: JsonObject) {
    const path = join(root, 'data/jobs', id + '.json');
    saveJob(path, { ...json<JsonObject>(path), ...values });
  }
  private setStage(id:string,stage:RunStage['stage'],message:string,completed?:number,total?:number,preparation?:RunStage['preparation']) {
    const value:RunStage={stage,message,completed,total,preparation,updatedAt:new Date().toISOString()};
    const previous=json<JsonObject>(join(root,'data/jobs',id+'.json')),history:RunStage[]=previous.stageHistory??[];
    if(history.at(-1)?.stage===stage)history[history.length-1]=value;else history.push(value);
    this.update(id,{stage:value,stageHistory:history.slice(-6)});
  }
  private async pump() {
    if (this.busy) return; this.busy = true;
    try {
      for (;;) {
        const item = this.queue.shift(); if (!item) break;
        const controller = this.controllers.get(item.id)!;
        if (controller.signal.aborted) { this.update(item.id, { status: 'cancelled', finishedAt: new Date().toISOString() }); this.setStage(item.id,'finished','Test cancelled before preparation or execution'); this.controllers.delete(item.id); this.baselines.delete(item.id); continue; }
        let preparedPath:string|undefined;
        try {
          if(item.request){
            this.update(item.id,{status:'preparing'});this.setStage(item.id,'preparing','Verifying pinned local Dataset sources');
            if(item.catalogHash!==hash(catalog()))throw new Error('Dataset catalog changed after submission; start a new test');
            preparedPath=await this.prepare(item.request,{signal:controller.signal,onProgress:p=>this.setStage(item.id,'preparing',p.message,p.filesCompleted,p.filesTotal,p)});
            controller.signal.throwIfAborted();
            const selection=datasets().find(d=>d.path===preparedPath);if(!selection)throw new Error('Prepared Dataset is unavailable');
            item.options.data=preparedPath;this.update(item.id,{selectionId:selection.id});
          }
          controller.signal.throwIfAborted();
          const plan=prepareRun(item.options);this.update(item.id,{status:'running',progress:{completed:0,total:plan.cases.length*plan.repeat}});
          const result = await runEvaluation({ ...item.options, signal: controller.signal,
            onStage:(stage,message,completed,total)=>{this.update(item.id,{status:stage==='running'?'running':'scoring'});this.setStage(item.id,stage,message,completed,total);},
            onProgress: (completed, total) => {this.update(item.id, { progress: { completed, total } });this.setStage(item.id,'running','Sending checks; promptfoo evaluates assertions as each request returns',completed,total);} });
          this.update(item.id, { status: controller.signal.aborted ? 'cancelled' : result.exitCode === 2 ? 'failed' : 'completed', exitCode: result.exitCode, finishedAt: new Date().toISOString() });
          this.setStage(item.id,'finished',controller.signal.aborted?'Test cancelled; available evidence retained':'Report ready',result.report.summary.recordedAttempts,result.report.summary.plannedAttempts);
        } catch (error) {
          if(preparedPath&&!existsSync(join(item.options.out,'snapshot.json')))rmSync(preparedPath,{recursive:true,force:true});
          this.update(item.id, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: controller.signal.aborted?undefined:error instanceof Error ? error.message : 'Testing failed', exitCode:2,finishedAt: new Date().toISOString() });
          const previous=json<JsonObject>(join(root,'data/jobs',item.id+'.json')).stage;
          this.setStage(item.id,'finished',controller.signal.aborted?'Test cancelled before completion':'Test failed during '+(previous?.stage??'startup'),previous?.completed,previous?.total,previous?.preparation);
        }
        this.controllers.delete(item.id); this.baselines.delete(item.id);
      }
    } finally { this.busy = false; }
  }
  remove(id:string){
    const path=this.directory(id);
    if(scoringBusy(path))failure('Wait for re-scoring to finish before deleting this Report',409);
    if(this.controllers.has(id))failure('Cancel this test and wait for it to finish before deleting its Report',409);
    if([...this.baselines.values()].includes(path))failure('This Report is a baseline for an active test. Wait for that test to finish before deleting it.',409);
    rmSync(path,{recursive:true,force:true});
    for(const dir of ['jobs','job-targets','job-requests','deleted-reports'])rmSync(join(root,'data',dir,id+'.json'),{force:true});
    return {id};
  }
  async rescore(id:string,scorer:unknown){
    const path=this.directory(id);
    if(this.busy)failure('Wait for the current test or re-scoring to finish',409);
    if(this.controllers.has(id))failure('Wait for this test to finish before re-scoring',409);
    validateScorer(scorer);this.busy=true;this.scoringController=new AbortController();
    try{return await rescoreRun(path,scorer,{signal:this.scoringController.signal});}
    finally{this.scoringController=undefined;this.busy=false;void this.pump();}
  }
  close() { this.scoringController?.abort(); for (const controller of this.controllers.values()) controller.abort(); }
  cancel(id: string) { const controller = this.controllers.get(id); if (!controller) throw new Error('Run is not active'); controller.abort(); return { cancelling: true }; }
  attempt(id: string, attemptId: string, scoringId?: string) {
    const attempt = this.evidence(id,scoringId).find(a => a.attemptId === attemptId) ?? failure('Check not found', 404);
    const snapshot = json<JsonObject>(join(this.directory(id), 'snapshot.json'));
    return {attempt, sample: snapshot.cases?.find((c: Case) => c.id === attempt.caseId) ?? null};
  }
  evidence(id: string, scoringId?: string) {
    const path = this.directory(id), nested = join(path, 'evaluation/attempts.jsonl');
    const saved=selectedScoring(path,scoringId).saved;
    const records = recordsForScoring(path,withEvaluationEvidence(path,existsSync(nested) ? lines<any>(nested) : existsSync(join(path, 'attempts.jsonl')) ? lines<any>(join(path, 'attempts.jsonl')) : []),saved?.metadata);
    const snapshot = existsSync(join(path, 'snapshot.json')) ? json<JsonObject>(join(path, 'snapshot.json')) : {};
    const cases = new Map<string, Case>((snapshot.cases ?? []).map((c: Case) => [c.id, c]));
    const compatibleScorer = snapshot.schemaVersion === 3 && snapshot.scorerHash === hash(readFileSync(join(root, 'src/core/scoring.ts')));
    return records.map(r => {
      const c = cases.get(r.caseId);
      // Bound list previews and preserve Unicode without consulting mutable source files.
      const samplePreview = typeof c?.text === 'string' ? Array.from(c.text.slice(0, 640)).slice(0, 320).join('') : null;
      return {...r, pii:piiEvidence(r,c), expected: c?.expected, samplePreview, sampleTruncated: samplePreview !== null && c!.text.length > samplePreview.length, grade: saved ? saved.grades.get(r.attemptId) : c && compatibleScorer ? score(r, c) : undefined};
    });
  }
}
