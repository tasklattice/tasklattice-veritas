import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, rmSync, renameSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, hash, json, lines, save } from '../core/files.js';
import { validateTarget } from '../core/provider.js';
import { catalog } from '../core/datasets.js';
import { prepareEvaluationDataset } from './prepare-evaluation.js';
import { buildDatasetCards, datasetIdForSelection } from './dataset-cards.js';
import { score } from '../core/scoring.js';
import {validateScorer} from '../shared/scorer.js';
import {activeScoringId,scoringDirectory,scoringHistory,selectedScoring,rescoreRun,scoringBusy} from '../core/scoring-revisions.js';
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
  private controllers = new Map<string, AbortController>();
  private queue: {id: string; options: RunOptions}[] = [];
  private busy = false;
  private scoringController?: AbortController;
  private baselines = new Map<string,string>();
  list(): RunItem[] {
    const jobsDir = join(root, 'data/jobs');
    const jobs = existsSync(jobsDir) ? readdirSync(jobsDir).filter(n => n.endsWith('.json')).flatMap(n => {try {return [json<RunItem>(join(jobsDir, n))];} catch {return [];}}) : [];
    const jobsByName = new Map(jobs.map(j => [j.name, j]));
    const dirs = new Set([...folders(join(root, 'runs')).filter(dir => existsSync(join(dir, 'snapshot.json'))), ...jobs.map(j => join(root, 'runs', j.name))]);
    return [...dirs].flatMap(dir => {
      try {
        const job = jobsByName.get(relative(join(root, 'runs'), dir));
        const snapshot = existsSync(join(dir, 'snapshot.json')) ? json(join(dir, 'snapshot.json')) : null;
        const scoringId=activeScoringId(dir),view=scoringDirectory(dir,scoringId);
        const report = existsSync(join(view, 'report.json')) ? json(join(view, 'report.json')) : null;
        const gate = existsSync(join(view, 'gate.json')) ? json(join(view, 'gate.json')) : undefined;
        const name = relative(join(root, 'runs'), dir), id = Buffer.from(name).toString('base64url');
        const deletedFile = join(root, 'data/deleted-reports', id + '.json'), deletedAt = existsSync(deletedFile) ? json(deletedFile).deletedAt : undefined;
        if (deletedAt) return [];
        let status = job?.status ?? (report ? ((report.summary?.errors || report.summary?.missing) ? 'failed' : 'completed') : 'interrupted');
        if ((status === 'running' || status === 'queued') && !this.controllers.has(id)) status = 'interrupted';
        return [{ ...job, id, name, status, targetId: job?.targetId ?? job?.endpointId ?? job?.target, targetName: job?.targetName ?? job?.endpointName, createdAt: job?.createdAt ?? snapshot?.createdAt ?? '', adapter: snapshot?.target?.adapter ?? report?.adapter ?? job?.adapter,
          datasetIds: job?.datasetIds ?? [...new Set<string>(snapshot?.cases?.map((c: Case) => c.dataset) ?? [])],
          evidence: snapshot?.evidence ?? report?.evidence ?? job?.evidence, dataset: job?.dataset ?? [...new Set(snapshot?.cases?.map((c: Case) => c.dataset))].join(', '),
          summary: report?.summary, gate, scoringId, scoringName:report?.scoring?.name, path: dir }];
      } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  directory(id: string) { const run = this.list().find(r => r.id === id) as RunItem & {path: string} | undefined; if (!run) failure('Report not found', 404); return run.path; }
  detail(id: string, scoringId?: string) {
    const run = this.list().find(r => r.id === id); if (!run) failure('Report not found',404);
    const path = this.directory(id);
    const snapshot = existsSync(join(path, 'snapshot.json')) ? json<JsonObject>(join(path, 'snapshot.json')) : null;
    const target = snapshot?.target,selected=selectedScoring(path,scoringId),history=scoringHistory(path);
    const report = selected.report && snapshot ? withClassification(selected.report, snapshot, existsSync(join(path,'attempts.jsonl')) ? lines<Attempt>(join(path,'attempts.jsonl')) : []) : selected.report;
    return {run:{...run,summary:report?.summary,gate:selected.gate}, report,
      scoring:{selectedId:selected.id,versions:history,config:history.find(v=>v.id===selected.id)?.config,canRescore:snapshot?.schemaVersion===3 && !['running','queued'].includes(run.status) && existsSync(join(path,'execution.json')) && existsSync(join(path,'attempts.jsonl')),busy:scoringBusy(path),offline:selected.id!=='original'},
      configuration: snapshot ? {gradesAvailable: !!selected.saved || snapshot.schemaVersion === 3 && snapshot.scorerHash === hash(readFileSync(join(root, 'src/core/scoring.ts'))), createdAt: snapshot.createdAt, repeat: snapshot.repeat, concurrency: snapshot.concurrency, caseCount: snapshot.cases?.length,
        engine: snapshot.engine, scorer: snapshot.scorer, skippedUnlabeled: snapshot.skippedUnlabeled, evidence: snapshot.evidence,
        target: target ? {url: target.url, adapter: target.adapter, outputMode: target.outputMode, timeoutMs: target.timeoutMs, apiKeyEnv: target.apiKeyEnv} : null,
        sources: snapshot.manifest?.sources ?? (snapshot.manifest ? [snapshot.manifest] : [])} : null};
  }
  activity(id: string): RunActivity {
    const run = this.list().find(r => r.id === id); if (!run) failure('Report not found',404);
    const path = this.directory(id);
    const saved = existsSync(join(path,'activity.json')) ? json<ActivitySnapshot>(join(path,'activity.json')) : null;
    const active = ['queued','running'].includes(run.status);
    return {...(saved ?? {schemaVersion:1, phase:active?'testing':'finished', updatedAt:run.createdAt,
      total:run.progress?.total??0, started:0, finished:0, completed:0, errors:0, skipped:0, active:[], recent:[]}),
      phase: active ? saved?.phase??'testing' : 'finished', available: !!saved, runStatus:run.status, serverTime:new Date().toISOString(),
      queuePosition:run.status==='queued'?Math.max(0,this.queue.findIndex(q=>q.id===id))+1:undefined,
      concurrency:saved?.concurrency, timeoutMs:saved?.timeoutMs, caseCount:saved?.caseCount,
      active:active?(saved?.active??[]):[], recent:(saved?.recent??[])} as RunActivity;
  }
  async start(request: RunRequest) {
    if (!request || typeof request !== 'object') throw new Error('Testing configuration is required');
    validateScorer(request.scorer);
    if (request.datasets === undefined && (request.selectionId || !catalog().some(e => e.id === request.datasetId))) return this.enqueue(request);
    const endpoint = targets().find(t => t.id === (request.endpointId ?? request.targetId));
    if (!endpoint) throw new Error('Target not found; create a Target first');
    if (!endpoint.credentialAvailable) throw new Error('Set ' + endpoint.target.apiKeyEnv + ' before running');
    for (const value of [request.repeat ?? 1, request.concurrency ?? 2]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Counts must be positive integers');
    const path = await prepareEvaluationDataset(request);
    try {
      const selection = datasets().find(d => d.path === path)!;
      return this.enqueue({...request, selectionId: selection.id});
    } catch (error) { rmSync(path, {recursive: true, force: true}); throw error; }
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
    const options: RunOptions = { scorer:request.scorer, data: dataset.path, target: targetPath(endpoint.id), out: path, repeat: request.repeat, concurrency: request.concurrency,
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
  private async pump() {
    if (this.busy) return; this.busy = true;
    try {
      for (;;) {
        const item = this.queue.shift(); if (!item) break;
        const controller = this.controllers.get(item.id)!;
        if (controller.signal.aborted) { this.update(item.id, { status: 'cancelled', finishedAt: new Date().toISOString() }); this.controllers.delete(item.id); this.baselines.delete(item.id); continue; }
        this.update(item.id, { status: 'running' });
        try {
          const result = await runEvaluation({ ...item.options, signal: controller.signal,
            onProgress: (completed, total) => this.update(item.id, { progress: { completed, total } }) });
          this.update(item.id, { status: controller.signal.aborted ? 'cancelled' : result.exitCode === 2 ? 'failed' : 'completed', exitCode: result.exitCode, finishedAt: new Date().toISOString() });
        } catch (error) { this.update(item.id, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : 'Testing failed', finishedAt: new Date().toISOString() }); }
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
    for(const dir of ['jobs','job-targets','deleted-reports'])rmSync(join(root,'data',dir,id+'.json'),{force:true});
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
    const records = existsSync(nested) ? lines<any>(nested) : existsSync(join(path, 'attempts.jsonl')) ? lines<any>(join(path, 'attempts.jsonl')) : [];
    const snapshot = existsSync(join(path, 'snapshot.json')) ? json<JsonObject>(join(path, 'snapshot.json')) : {};
    const cases = new Map<string, Case>((snapshot.cases ?? []).map((c: Case) => [c.id, c]));
    const saved=selectedScoring(path,scoringId).saved;
    const compatibleScorer = snapshot.schemaVersion === 3 && snapshot.scorerHash === hash(readFileSync(join(root, 'src/core/scoring.ts')));
    return records.map(r => {
      const c = cases.get(r.caseId);
      // Bound list previews and preserve Unicode without consulting mutable source files.
      const samplePreview = typeof c?.text === 'string' ? Array.from(c.text.slice(0, 640)).slice(0, 320).join('') : null;
      return {...r, expected: c?.expected, samplePreview, sampleTruncated: samplePreview !== null && c!.text.length > samplePreview.length, grade: saved ? saved.grades.get(r.attemptId) : c && compatibleScorer ? score(r, c) : undefined};
    });
  }
}
