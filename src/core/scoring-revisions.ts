import {existsSync, mkdirSync, readdirSync, renameSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {json, save} from './files.js';
import {readEvidence, readGrades, evaluateSavedEvidence, persistGrading, nativeStats} from './grading.js';
import {writeReport} from './report.js';
import {gateReport} from './gates.js';
import {validateScorer, defaultScorer, type ScorerConfig} from '../shared/scorer.js';
import type {Grade, JsonObject} from '../shared/types.js';

const locks = new Set<string>();
export const scoringBusy = (dir: string) => locks.has(dir);
function failure(message: string, statusCode = 409): never {throw Object.assign(new Error(message), {statusCode});}
export function scoringDirectory(dir: string, id = 'original') {
  if (id === 'original') return dir;
  if (!/^s-[a-f0-9-]{36}$/.test(id)) failure('Unknown scoring version',404);
  const path = join(dir,'scorings',id);
  if (!existsSync(join(path,'report.json'))) failure('Scoring version not found',404);
  return path;
}
export function activeScoringId(dir: string) {return existsSync(join(dir,'active-scoring.json')) ? json(join(dir,'active-scoring.json')).id as string : 'original';}
export function scoringHistory(dir: string) {
  const snapshot = existsSync(join(dir,'snapshot.json')) ? json(join(dir,'snapshot.json')) : null;
  const original = {id:'original', name:snapshot?.scorerConfig?.name ?? 'Original scoring', createdAt:snapshot?.createdAt, config:snapshot?.scorerConfig ?? defaultScorer(), offline:false};
  const parent = join(dir,'scorings');
  const revisions = existsSync(parent) ? readdirSync(parent).filter(id => /^s-[a-f0-9-]{36}$/.test(id) && existsSync(join(parent,id,'report.json'))).map(id => {
    const g = json(join(parent,id,'grading.json'));return {id,name:g.name,createdAt:g.createdAt,config:g.config,offline:true};
  }).sort((a,b) => a.createdAt.localeCompare(b.createdAt)) : [];
  return [original,...revisions];
}
export function selectedScoring(dir: string, id = activeScoringId(dir)) {
  const path = scoringDirectory(dir,id), saved = readGrades(path,dir);
  const report = existsSync(join(path,'report.json')) ? json<JsonObject>(join(path,'report.json')) : null;
  if (saved && report && (report.scoring?.sourceHash !== saved.metadata.sourceHash || report.scoring?.scorerHash !== saved.metadata.scorerHash)) failure('Report scoring metadata does not match its saved grades');
  return {id,path,report,gate:existsSync(join(path,'gate.json')) ? json(join(path,'gate.json')) : undefined,saved};
}
export function evidenceGrades(dir: string, id = activeScoringId(dir)): Map<string, Grade> | undefined {
  return selectedScoring(dir,id).saved?.grades;
}
/** Publish only after all SDK grades and artifacts are complete; failed re-scores never replace a Report. */
export async function rescoreRun(dir: string, value: unknown, options: {signal?: AbortSignal} = {}) {
  const config: ScorerConfig = validateScorer(value);
  if (locks.has(dir)) failure('This Report is already being re-scored');
  if (!existsSync(join(dir,'execution.json')) || !json(join(dir,'execution.json')).finishedAt) failure('Wait for the original test execution to finish before re-scoring');
  const source = readEvidence(dir);
  if (!source.records.length) failure('No recorded checks are available to re-score');
  locks.add(dir);
  const id = 's-' + randomUUID(), parent = join(dir,'scorings'), staging = join(parent,'.pending-'+id), published = join(parent,id);
  try {
    mkdirSync(staging,{recursive:true,mode:0o700});
    const native = await evaluateSavedEvidence(dir,config,options.signal);
    if (readEvidence(dir).sourceHash !== source.sourceHash) failure('Request evidence changed during re-scoring');
    save(join(staging,'promptfoo-results.json'),native);
    const {metadata,grades} = persistGrading(staging,dir,native,config,id);
    const report = writeReport(staging,source.snapshot,source.records,grades,metadata);
    const stats = nativeStats(native), s = report.summary;
    if (!stats || stats.successes !== s.passed || stats.failures !== s.failed + s.skipped || stats.errors !== s.errors) throw new Error('SDK grades and Report totals differ');
    // A changed rule set is a new assessment. Original execution/baseline gates remain in the original Report.
    const gate = gateReport(report);
    const exitCode=s.errors || s.missing ? 2 : gate.pass ? 0 : 1;
    save(join(staging,'gate.json'),gate);
    save(join(staging,'execution.json'),{invocation:'promptfoo.evaluate',mode:'offline',targetCallsAdded:0,engineAligned:true,nativeStats:stats,gatePolicy:'default-absolute',exitCode,finishedAt:new Date().toISOString()});
    renameSync(staging,published);
    const pointer = join(dir,'.active-scoring-'+randomUUID()+'.json');save(pointer,{id});renameSync(pointer,join(dir,'active-scoring.json'));
    return {id,report,gate,directory:published,exitCode};
  } finally {rmSync(staging,{recursive:true,force:true});locks.delete(dir);}
}
