import {gradeEvidenceSummary} from './grading.js';
import {validatePurpose, validateBenchmarkCases} from '../shared/benchmark.js';
import {recordsForScoring} from './execution-evidence.js';
import {withEvaluationEvidence} from './guard-evidence.js';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, json, lines, hash, save, validateCase } from './files.js';
import Provider, { adapterType, outputMode, validateTarget } from './provider.js';
import {validateScorer, type ScorerConfig} from '../shared/scorer.js';
import {GRADING_VERSION, scorerFingerprint, buildAssertions, engineEnvironment, persistGrading, nativeStats} from './grading.js';
import {selectedScoring} from './scoring-revisions.js';
import {sampleCases} from './sampling.js';
import type {SamplingConfig} from '../shared/testing.js';
import {ActivityTracker} from './activity.js';
import {withClassification} from './classification.js';
import { writeReport } from './report.js';
import type { Attempt, Case, JsonObject, Phase } from '../shared/types.js';

export interface RunOptions { testPurpose?: import('../shared/benchmark.js').TestPurpose; sampling?:SamplingConfig; onStage?:(stage:'running'|'scoring'|'reporting',message:string,completed:number,total:number)=>void; scorer?: ScorerConfig | string; data: string; target: string; out: string; repeat?: number; concurrency?: number; limit?: number; phase?: Phase; skipUnlabeled?: boolean; baseline?: string; gate?: string | JsonObject; evidence?: 'endpoint' | 'synthetic-local-demo'; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void }
const positive = (n: number): number => { if (!Number.isSafeInteger(n) || n < 1) throw new Error('Counts must be positive integers'); return n; };
export {gateReport} from './gates.js';
import {gateReport} from './gates.js';
export function compatibleSnapshots(a: JsonObject, b: JsonObject) {
  if (validatePurpose(a.testPurpose) !== validatePurpose(b.testPurpose)) throw new Error('Incompatible baseline: test purposes differ');
  if (['schemaVersion', 'caseHash', 'scorerHash', 'providerHash', 'repeat', 'concurrency', 'evidence'].some(k => a[k] !== b[k]) ||
    a.engine.version !== b.engine.version || adapterType(a.target) !== adapterType(b.target) || outputMode(a.target) !== outputMode(b.target)) {
    throw new Error('Incompatible baseline: cases, scorer, adapter, engine, repeats, concurrency, output mode and evidence type must match');
  }
}
export function loadReport(dir: string, scoringId = 'original') {
  const selected = selectedScoring(dir,scoringId);
  if (selected.saved && selected.report) return withClassification(selected.report, json(join(dir, 'snapshot.json')), withEvaluationEvidence(dir,recordsForScoring(dir,lines<Attempt>(join(dir, 'attempts.jsonl')),selected.saved.metadata)));
  const snapshot = json(join(dir, 'snapshot.json'));
  if (snapshot.schemaVersion !== 3 || snapshot.scorerHash !== hash(readFileSync(join(root, 'src/core/scoring.ts')))) throw new Error('Scorer differs from the frozen run; preserve its historical report and rerun with the recorded implementation');
  if (snapshot.caseHash !== hash(snapshot.cases)) throw new Error('Run case snapshot was modified');
  const records = existsSync(join(dir, 'attempts.jsonl')) ? lines<Attempt>(join(dir, 'attempts.jsonl')) : [];
  const cases = new Map<string, Case>(snapshot.cases.map((c: Case) => [c.id, c])), seen = new Set(), counts = new Map<string, number>();
  for (const record of records) {
    const c = cases.get(record.caseId);
    if (!c || seen.has(record.attemptId) || c.phase !== record.phase || c.dataset !== record.dataset || record.adapter !== adapterType(snapshot.target)) throw new Error('Unexpected, duplicate, or mismatched attempt evidence');
    seen.add(record.attemptId); counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    if (counts.get(c.id)! > snapshot.repeat || !['completed', 'error', 'skipped'].includes(record.status)) throw new Error('Invalid attempt count or status');
  }
  return writeReport(dir, snapshot, records);
}
export function compareRuns(baseline: string, current: string, baselineScoring = 'original', currentScoring = 'original') {
  const a = json(join(baseline, 'snapshot.json')), b = json(join(current, 'snapshot.json'));
  if (baselineScoring === 'original' && currentScoring === 'original') compatibleSnapshots(a,b);
  else {const left={...a,scorerHash:null},right={...b,scorerHash:null};compatibleSnapshots(left,right);}
  const ar=loadReport(baseline,baselineScoring),br=loadReport(current,currentScoring);
  if ((ar.scoring?.scorerHash ?? a.scorerHash) !== (br.scoring?.scorerHash ?? b.scorerHash)) throw new Error('Incompatible baseline: scoring rules must match');
  const x = ar.summary, y = br.summary;
  if (x.coverage !== 1 || y.coverage !== 1) throw new Error('Baseline comparison requires complete coverage');
  return { baselineRunId: a.runId, currentRunId: b.runId, baselineScoring, currentScoring, accuracyDrop: x.accuracy! - y.accuracy!,
    falsePositiveRateDelta: x.falsePositiveRate === null || y.falsePositiveRate === null ? null : y.falsePositiveRate - x.falsePositiveRate,
    p95DeltaMs: y.latencyMs.p95! - x.latencyMs.p95! };
}
export function prepareRun(options: RunOptions) {
  const testPurpose = validatePurpose(options.testPurpose);
  const scorer = validateScorer(typeof options.scorer === 'string' ? json(resolve(options.scorer)) : options.scorer);
  const target = validateTarget(json(resolve(options.target)));
  if (target.apiKeyEnv && !process.env[target.apiKeyEnv]) throw new Error(`Set ${target.apiKeyEnv} before running`);
  const dataset = resolve(options.data), manifest = existsSync(join(dataset, 'manifest.json')) ? json(join(dataset, 'manifest.json')) : null;
  if (manifest?.casesSha256 && manifest.casesSha256 !== hash(readFileSync(join(dataset, 'cases.jsonl')))) throw new Error('Dataset was modified after import; create a new version');
  let cases = lines<Case>(join(dataset, 'cases.jsonl')).map(validateCase);
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Duplicate case IDs');
  if (options.phase && !['input', 'output'].includes(options.phase)) throw new Error('Invalid phase');
  if (options.phase) cases = cases.filter(c => c.phase === options.phase);
  validateBenchmarkCases(testPurpose, cases);
  const unlabeled = cases.filter(c => c.expected === null).length;
  if (unlabeled && !options.skipUnlabeled) throw new Error(`${unlabeled} cases need reviewed expectations; import --labels FILE or explicitly skip unreviewed cases`);
  const sampled=options.sampling?sampleCases(cases.filter(c=>c.expected!==null),options.limit,options.sampling):null;
  cases = sampled?.cases ?? cases.filter(c => c.expected !== null).slice(0, options.limit === undefined ? undefined : positive(options.limit));
  if (!cases.length) throw new Error('No evaluable cases');
  validateBenchmarkCases(testPurpose, cases);
  if (target.outputMode === 'paired' && cases.some(c => c.phase === 'output' && !c.prompt?.trim())) throw new Error('Paired output requires original prompt; use standalone explicitly');
  const repeat = positive(options.repeat ?? 1), concurrency = positive(options.concurrency ?? 2);
  const evidence = options.evidence ?? 'endpoint';
  if (!['endpoint', 'synthetic-local-demo'].includes(evidence)) throw new Error('Invalid evidence type');
  const gate = typeof options.gate === 'string' ? json(resolve(options.gate)) : options.gate ?? {};
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) throw new Error('Gate must be an object');
  gateReport({ summary: { coverage: 1, accuracy: 1, falsePositiveRate: 0, falseNegativeRate: 0, latencyMs: { p95: 0 } } }, gate, { accuracyDrop: 0 });
  if (gate.maxAccuracyDrop !== undefined && !options.baseline) throw new Error('maxAccuracyDrop requires --baseline');
  const snapshot = { schemaVersion: 3, testPurpose, runId: randomUUID(), createdAt: new Date().toISOString(), target, repeat, concurrency, evidence, skippedUnlabeled: unlabeled,
    engine: { name: 'promptfoo', version: json(join(root, 'node_modules/promptfoo/package.json')).version, api: 'evaluate' },
    scorer: GRADING_VERSION, scorerConfig:scorer, scorerHash:scorerFingerprint(scorer), gate,
    selection:(sampled?.selection??manifest?.selection)?{...(sampled?.selection??manifest.selection),caseIds:cases.map(c=>c.id)}:undefined,
    providerHash: hash(['provider.ts', 'files.ts', 'service.ts'].map(p => hash(readFileSync(join(root, 'src/core', p))))), manifest, cases, caseHash: hash(cases) };
  if (options.baseline) { compatibleSnapshots(json(join(options.baseline, 'snapshot.json')), snapshot); if (loadReport(options.baseline).summary.coverage !== 1) throw new Error('Baseline has incomplete coverage'); }
  return { target, cases, repeat, concurrency, evidence, gate, snapshot, scorer };
}
export async function runEvaluation(options: RunOptions) {
  const { target, cases, repeat, concurrency, gate, snapshot, scorer } = prepareRun(options);
  const out = resolve(options.out);
  if (existsSync(out)) throw new Error('Output directory already exists');
  mkdirSync(out, { recursive: true, mode: 0o700 }); save(join(out, 'snapshot.json'), snapshot);
  const evidencePath = join(out, 'attempts.jsonl');
  const config = { description: `Veritas ${snapshot.runId}`, sharing: false, writeLatestResults: false,
    prompts: ['{{case.text}}'], providers: [{ id: `file://${join(root, 'src/core/provider.ts')}`, config: { target, evidencePath, maxRetries: 0 } }],
    tests: cases.map(c => ({ description:c.id,vars:{case:c,scorer},assert:buildAssertions(c,scorer,true),options:{disableConversationVar:true} })),
    evaluateOptions: { cache: false, maxConcurrency: concurrency, repeat, showProgressBar: false } };
  save(join(out, 'promptfooconfig.json'), config);
  const activity = new ActivityTracker(cases, repeat, join(out, 'activity.json'), {concurrency, timeoutMs:target.timeoutMs??30000});
  const provider = new Provider({ config: { target, evidencePath }, onActivity: event => activity.event(event) });
  const sdkProvider = { id: () => provider.id(), config:{maxRetries:0}, callApi: (prompt: string, context: any, opts?: any) => provider.callApi(prompt, context, opts) };
  let code = 0, error: string | undefined;
  engineEnvironment();
  options.onStage?.('running','Sending checks; promptfoo evaluates assertions as each request returns',0,cases.length*repeat);
  await new Promise<void>(resolve=>setImmediate(resolve));
  try {
    const { evaluate } = await import('promptfoo');
    const result = await evaluate({ ...config, providers: [sdkProvider], tests: cases.map(c => ({ description: c.id, vars: { case: c, scorer }, assert: buildAssertions(c,scorer), options: { disableConversationVar: true } })) },
      { ...config.evaluateOptions, abortSignal: options.signal, progressCallback(completed, total) {
        const event = { completed, total, at: new Date().toISOString() };
        const { appendFileSync } = requireAppend; appendFileSync(join(out, 'engine-events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 }); options.onProgress?.(completed, total);
      } });
    save(join(out, 'promptfoo-results.json'), gradeEvidenceSummary(await result.toEvaluateSummary()));
  } catch (e) { code = 2; error = e instanceof Error ? e.name : 'SDK error'; }
  activity.phase('finalizing');
  const recorded=existsSync(evidencePath)?lines<Attempt>(evidencePath).length:0;
  options.onStage?.('scoring','Validating and saving promptfoo grades',0,recorded);
  await new Promise<void>(resolve=>setImmediate(resolve));
  const native = existsSync(join(out,'promptfoo-results.json')) ? json(join(out,'promptfoo-results.json')) : null;
  let grading: ReturnType<typeof persistGrading> | undefined;
  if (native) {try {grading = persistGrading(out,out,native,scorer);} catch (e) {code=2;error=e instanceof Error ? e.message : 'Cannot persist grades';}}
  options.onStage?.('scoring','Saved promptfoo grades',grading?.grades.size??0,recorded);
  options.onStage?.('reporting','Writing summaries, exports and quality thresholds',0,1);
  await new Promise<void>(resolve=>setImmediate(resolve));
  const records=existsSync(evidencePath) ? lines<Attempt>(evidencePath) : [];
  const report=writeReport(out,snapshot,records,grading?.grades ?? new Map(),grading?.metadata);
  const stats = native ? nativeStats(native) : null;
  const s = report.summary;
  const engineAligned = !!stats && stats.successes === s.passed && stats.failures === s.failed + s.skipped && stats.errors === s.errors;
  save(join(out, 'execution.json'), { code, error, invocation: 'promptfoo.evaluate', finishedAt: new Date().toISOString(), engineAligned, nativeStats: stats });
  const comparison = options.baseline && s.coverage === 1 ? compareRuns(options.baseline, out) : undefined;
  if (comparison) save(join(out, 'comparison.json'), comparison);
  const verdict = gateReport(report, gate, comparison);
  if (!engineAligned) { verdict.pass = false; verdict.failures.push({ metric: 'engineConsistency', reason: 'Missing or inconsistent native SDK evidence' }); }
  save(join(out, 'gate.json'), verdict);
  const exitCode = code || s.missing || s.errors || !engineAligned || options.signal?.aborted ? 2 : verdict.pass ? 0 : 1;
  options.onStage?.('reporting','Report files and quality thresholds saved',1,1);
  activity.phase('finished');
  return { directory: out, exitCode, report, gate: verdict };
}
import * as requireAppend from 'node:fs';
