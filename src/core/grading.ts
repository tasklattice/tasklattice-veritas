import {withExecutionEvidence,executionEvidenceHash} from './execution-evidence.js';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {root, hash, json, lines, save, validateCase} from './files.js';
import {adapterType} from './provider.js';
import type {Attempt, Case, Grade, JsonObject, SavedGrade} from '../shared/types.js';
import {validateScorer, type ScorerConfig} from '../shared/scorer.js';

import {redactionCheck} from '../shared/pii.js';
export const GRADING_VERSION = 'guard-rules-v3-pii-alignment';
export function scorerFingerprint(config: ScorerConfig) {
  return hash({config: validateScorer(config), implementation: ['src/core/grading.ts', 'src/shared/scorer.ts', 'src/core/action-assertion.ts', 'src/core/pii-assertion.ts', 'src/core/text-transform.ts', 'src/core/execution-evidence.ts', 'src/shared/detection.ts', 'src/shared/pii.ts'].map(file => hash(readFileSync(join(root, file))))});
}
export function engineEnvironment() {
  Object.assign(process.env, {PROMPTFOO_DISABLE_TELEMETRY:'1', PROMPTFOO_DISABLE_UPDATE:'1', PROMPTFOO_DISABLE_REMOTE_GENERATION:'1',
    PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION:'true', PROMPTFOO_CACHE_ENABLED:'false', PROMPTFOO_DISABLE_PROGRESS_BAR:'1', LOG_LEVEL:'error'});
}
function parsed(output: string): Attempt {return JSON.parse(output);}
export const returnedText = (output: string) => (parsed(output).texts ?? []).join('\n');
export function actionGrade(result: Attempt, c: Case, config: ScorerConfig): Grade {
  if (result.status !== 'completed') return {pass:false, score:0, reason:result.error ?? result.skipReason ?? 'Check did not complete'};
  const accepted = c.expected ? config.acceptedActions[c.expected] : [];
  const pass = !!result.action && accepted.includes(result.action);
  return {pass, score:pass ? 1 : 0, reason:`Expected ${c.expected}; accepted ${accepted.join(' / ')}; observed ${result.action ?? 'none'}`};
}
/** Domain assertions are callbacks; text checks are native promptfoo assertions. */
export function piiGrade(output: string, c: Case): Grade {
  const result=parsed(output),check=redactionCheck(c,result.texts);
  const pass=result.status==='completed'&&result.action==='transform'&&check.status==='complete';
  const reason=result.action==='block'?'Blocked; complete redaction was not returned':result.action==='allow'?'Allowed; redaction was not performed':check.status==='complete'?'All annotated source spans were redacted':check.status==='partial'?`${check.remaining} annotated values remain wholly or partially visible`:check.status==='empty'?'Empty transformed output':'Cannot verify complete redaction against saved source spans';
  return {pass,score:pass?1:0,reason};
}
export function buildAssertions(c: Case, config: ScorerConfig, serializable = false): any[] {
  const file = (name: string) => 'file://' + join(root,'src/core',name);
  const assertions: any[] = [{type:'javascript', metric:'Action match', value:serializable ? file('action-assertion.ts') : (output: string) => actionGrade(parsed(output), c, config)}];
  if (config.checkPii && c.expected === 'transform' && c.pii?.length) assertions.push({type:'javascript', metric:'PII removal', value:serializable ? file('pii-assertion.ts') : (output: string) => piiGrade(output,c)});
  config.assertions.filter(a => a.scope === 'all' || c.expected === 'transform').forEach((a, index) => {
    assertions.push({type:a.type, ...(a.value === undefined ? {} : {value:a.value}), metric:`Text check ${index + 1}`, transform:serializable ? file('text-transform.ts') : returnedText});
  });
  return assertions;
}
export function readEvidence(dir: string) {
  const snapshot = json<JsonObject>(join(dir, 'snapshot.json'));
  if (snapshot.schemaVersion !== 3) throw new Error('Offline re-scoring requires schema-3 request evidence');
  const cases = (snapshot.cases as unknown[]).map(validateCase);
  if (hash(snapshot.cases) !== snapshot.caseHash || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Run case snapshot was modified');
  if (!Number.isSafeInteger(snapshot.repeat) || snapshot.repeat < 1) throw new Error('Invalid frozen repeat count');
  const records = existsSync(join(dir,'attempts.jsonl')) ? lines<Attempt>(join(dir,'attempts.jsonl')) : [];
  const byId = new Map(cases.map(c => [c.id, c])), seen = new Set<string>(), counts = new Map<string, number>();
  for (const r of records) {
    const c = byId.get(r.caseId);
    if (!c || typeof r.attemptId !== 'string' || !r.attemptId || seen.has(r.attemptId) || r.phase !== c.phase || r.dataset !== c.dataset || r.adapter !== adapterType(snapshot.target)) throw new Error('Unexpected, duplicate, or mismatched attempt evidence');
    seen.add(r.attemptId); counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    if (counts.get(c.id)! > snapshot.repeat || !['completed','error','skipped'].includes(r.status)) throw new Error('Invalid attempt count or status');
    if (r.status === 'completed' && !['allow','block','transform'].includes(r.action ?? '')) throw new Error('Completed evidence is missing its observed action');
  }
  return {snapshot, cases, records, sourceHash:hash({snapshot:hash(readFileSync(join(dir,'snapshot.json'))), evidence:existsSync(join(dir,'attempts.jsonl')) ? hash(readFileSync(join(dir,'attempts.jsonl'))) : hash('')})};
}
export function nativeRows(native: JsonObject): JsonObject[] {return Array.isArray(native.results) ? native.results : native.results?.results ?? [];}
export function nativeStats(native: JsonObject) {return native.stats ?? native.results?.stats;}
/** Retain SDK grades and identities without duplicating raw requests/responses already frozen in attempts.jsonl. */
export function gradeEvidenceSummary(native: JsonObject): JsonObject {
  return {version:native.version, timestamp:native.timestamp, stats:nativeStats(native), projection:'veritas-native-grades-v1',
    results:nativeRows(native).map(row => ({testIdx:row.testIdx, promptIdx:row.promptIdx, success:row.success,
      error:row.error, failureReason:row.failureReason, gradingResult:row.gradingResult,
      vars:{case:{id:row.vars?.case?.id}, ...(row.vars?.attempt ? {attempt:{attemptId:row.vars.attempt.attemptId}} : {})},
      response:{metadata:{attemptId:row.response?.metadata?.attemptId}}}))};
}
function addNativeStats(total: JsonObject, next: JsonObject) {
  for (const [key,value] of Object.entries(next)) {
    if (typeof value === 'number') total[key] = (total[key] ?? 0) + value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) addNativeStats(total[key] ??= {}, value as JsonObject);
  }
}
export function savedGrades(native: JsonObject, records: Attempt[]): SavedGrade[] {
  const rows = nativeRows(native), byId = new Map<string, JsonObject>();
  for (const row of rows) {
    const id = row.response?.metadata?.attemptId ?? row.vars?.attempt?.attemptId;
    if (!id || byId.has(id)) throw new Error('SDK results have a missing or duplicate attempt identity');
    byId.set(id, row);
  }
  if (byId.size !== records.length) throw new Error('SDK result count differs from the saved evidence');
  return records.map(record => {
    const row = byId.get(record.attemptId);
    if (!row || row.vars?.case?.id !== record.caseId) throw new Error('SDK grading result does not match its saved case');
    let grade: Grade;
    if (record.status !== 'completed') grade = {pass:false, score:0, reason:record.error ?? record.skipReason ?? 'Check did not complete'};
    else {
      const result = row.gradingResult;
      if (!result || typeof result.pass !== 'boolean' || !Number.isFinite(result.score)) throw new Error('SDK could not grade a completed check: ' + (row.error ?? 'missing grade'));
      const components = (result.componentResults ?? [result]).map((part: JsonObject, index: number) => ({name:part.assertion?.metric ?? (index === 0 ? 'Action match' : 'Additional check'), pass:part.pass === true, score:part.score, reason:String(part.reason ?? '')}));
      grade = {pass:result.pass, score:result.score, reason:String(result.reason ?? ''), actionPass:components[0]?.pass, components};
    }
    return {attemptId:record.attemptId, caseId:record.caseId, grade};
  });
}
export function persistGrading(out: string, evidenceDir: string, native: JsonObject, config: ScorerConfig, id = 'original') {
  const source = readEvidence(evidenceDir), executionHash=executionEvidenceHash(evidenceDir), grades = savedGrades(native, withExecutionEvidence(evidenceDir,source.records,executionHash));
  const contents = grades.map(g => JSON.stringify(g)).join('\n') + (grades.length ? '\n' : '');
  writeFileSync(join(out,'grades.jsonl'),contents,{mode:0o600});
  const metadata = {schemaVersion:1, id, name:config.name, createdAt:new Date().toISOString(), config:validateScorer(config), scorer:GRADING_VERSION,
    scorerHash:scorerFingerprint(config), sourceHash:source.sourceHash, executionEvidenceHash:executionHash, gradesHash:hash(contents), engine:{name:'promptfoo',version:json(join(root,'node_modules/promptfoo/package.json')).version},
    offline:id !== 'original', targetCallsAdded:0};
  save(join(out,'grading.json'),metadata);
  return {metadata, grades:new Map(grades.map(g => [g.attemptId,g.grade]))};
}
export function readGrades(out: string, evidenceDir: string) {
  if (!existsSync(join(out,'grading.json'))) return null;
  const metadata = json<JsonObject>(join(out,'grading.json')), source = readEvidence(evidenceDir);
  const bytes = readFileSync(join(out,'grades.jsonl'));
  if (metadata.sourceHash !== source.sourceHash || metadata.gradesHash !== hash(bytes)) throw new Error('Saved scoring or request evidence was modified');
  if(metadata.executionEvidenceHash && metadata.executionEvidenceHash!==executionEvidenceHash(evidenceDir))throw new Error('Verified execution evidence was modified');
  const rows = lines<SavedGrade>(join(out,'grades.jsonl')), records = new Map(source.records.map(r => [r.attemptId,r]));
  if (rows.length !== records.size || new Set(rows.map(g => g.attemptId)).size !== rows.length || rows.some(g => records.get(g.attemptId)?.caseId !== g.caseId || typeof g.grade?.pass !== 'boolean' || !Number.isFinite(g.grade.score))) throw new Error('Saved grades do not match the evidence');
  return {metadata, grades:new Map(rows.map(g => [g.attemptId,g.grade]))};
}

/** No Target configuration, credential lookup, fetch, or live provider is used here. */
export async function evaluateSavedEvidence(dir: string, config: ScorerConfig, signal?: AbortSignal) {
  const source=readEvidence(dir),cases=source.cases,records=withExecutionEvidence(dir,source.records), byId = new Map(cases.map(c => [c.id,c]));
  if (!records.length) throw new Error('No recorded checks are available to re-score');
  engineEnvironment();
  const {evaluate} = await import('promptfoo');
  const combined: JsonObject = {version:3, timestamp:new Date().toISOString(), projection:'veritas-native-grades-v1', results:[], stats:{}};
  // Bound SDK working memory and serialization size; every saved attempt is scored exactly once.
  for(let offset=0;offset<records.length;offset+=1000) {
  if(signal?.aborted) throw new Error('Re-scoring was cancelled');
  const batch=records.slice(offset,offset+1000);
  const result = await evaluate({description:'Veritas offline re-scoring', sharing:false, writeLatestResults:false, prompts:['Saved check {{attempt.attemptId}}'],
    providers:[{id:() => 'veritas-saved-evidence', config:{maxRetries:0}, callApi:async (_prompt: string, context: any) => {
      const attempt = context.vars.attempt as Attempt;
      return {output:JSON.stringify(attempt), ...(attempt.status === 'error' ? {error:attempt.error ?? 'Recorded transport error'} : {}), cached:false, cost:0,
        tokenUsage:{total:0,prompt:0,completion:0}, metadata:{attemptId:attempt.attemptId}};
    }}], tests:batch.map(attempt => {const c = byId.get(attempt.caseId)!;return {description:attempt.attemptId, vars:{case:c,attempt}, assert:buildAssertions(c,config), options:{disableConversationVar:true}};})},
    {cache:false, maxConcurrency:4, repeat:1, showProgressBar:false, abortSignal:signal});
  if (signal?.aborted) throw new Error('Re-scoring was cancelled');
  const summary=gradeEvidenceSummary(await result.toEvaluateSummary());
  combined.results.push(...summary.results);addNativeStats(combined.stats,summary.stats);
  }
  return combined;
}
