import type { Attempt, Case, Grade, JsonObject } from '../shared/types.js';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {classificationMetrics, classificationMarkdown} from './classification.js';
import * as scoring from './scoring.js';
import { save } from './files.js';
import { adapterType, outputMode } from './provider.js';

const ratio = (a: number, b: number) => b ? a / b : null;
function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
export function summarize(records: Attempt[], cases: Case[], planned: number, grades?: Map<string, Grade>) {
  const byId = new Map(cases.map(c => [c.id, c]));
  const valid = records.filter(r => r.status === 'completed');
  const grade = (r: Attempt) => grades ? grades.get(r.attemptId) : scoring.score(r, byId.get(r.caseId)!);
  const scored = valid.filter(r => grade(r));
  const pass = scored.filter(r => grade(r)!.pass).length;
  const allow = valid.filter(r => byId.get(r.caseId)!.expected === 'allow');
  const block = valid.filter(r => byId.get(r.caseId)!.expected === 'block');
  const fps = allow.filter(r => grade(r)?.actionPass === false || (grade(r)?.actionPass === undefined && r.action !== 'allow')).length;
  const fns = block.filter(r => grade(r)?.actionPass === false || (grade(r)?.actionPass === undefined && r.action !== 'block')).length;
  const groups = new Map<string, string[]>();
  for (const r of valid) {
    const values = groups.get(r.caseId) || []; values.push(r.action!); groups.set(r.caseId, values);
  }
  const repeatGroups = [...groups.values()].filter(v => v.length >= 2);
  const latency = valid.map(r => r.latencyMs!);
  const allSteps = records.flatMap(r => r.steps || []);
  return {
    ...classificationMetrics(records, cases),
    plannedAttempts: planned, recordedAttempts: records.length,
    completed: valid.length, scored: scored.length, unscored: valid.length - scored.length, passed: pass, failed: scored.length - pass,
    errors: records.filter(r => r.status === 'error').length,
    skipped: records.filter(r => r.status === 'skipped').length,
    missing: Math.max(0, planned - records.length),
    coverage: ratio(valid.length, planned), accuracy: ratio(pass, scored.length), passRateAllAttempts: ratio(pass, planned),
    falsePositiveRate: ratio(fps, allow.length), falseNegativeRate: ratio(fns, block.length),
    expectedAllow: allow.length, falsePositives: fps, expectedBlock: block.length, falseNegatives: fns,
    repeatEligibleCases: repeatGroups.length,
    unstableCases: repeatGroups.filter(v => new Set(v).size > 1).length,
    unstableRate: ratio(repeatGroups.filter(v => new Set(v).size > 1).length, repeatGroups.length),
    latencyMs: { p50: percentile(latency, .5), p95: percentile(latency, .95), p99: percentile(latency, .99) },
    httpCalls: allSteps.length, inputHttpCalls: allSteps.filter(s => s.phase === 'input').length,
    outputHttpCalls: allSteps.filter(s => s.phase === 'output').length,
    guardCost: { status: 'unavailable', amount: null, currency: null },
  };
}
const fmt = (value: number | null) => value === null ? 'N/A' : (100 * value).toFixed(2) + '%';
const cell = (value: unknown) => {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function writeReport(out: string, snapshot: JsonObject, records: Attempt[], grades?: Map<string, Grade>, grading?: JsonObject) {
  const cases = snapshot.cases as Case[];
  const planned = cases.length * snapshot.repeat;
  const summary = summarize(records, cases, planned, grades);
  const grouped: Record<string, ReturnType<typeof summarize>> = {};
  for (const c of cases) {
    const key = `${c.dataset}/${c.phase}`;
    if (!grouped[key]) {
      const selected = cases.filter(x => x.dataset === c.dataset && x.phase === c.phase);
      const ids = new Set(selected.map(x => x.id));
      grouped[key] = summarize(records.filter(r => ids.has(r.caseId)), selected, selected.length * snapshot.repeat, grades);
    }
  }
  const datasets: Record<string, ReturnType<typeof summarize>> = {};
  for (const dataset of new Set(cases.map(c => c.dataset))) {
    const selected = cases.filter(c => c.dataset === dataset), ids = new Set(selected.map(c => c.id));
    datasets[dataset] = summarize(records.filter(r => ids.has(r.caseId)), selected, selected.length * snapshot.repeat, grades);
  }
  const adapter = adapterType(snapshot.target);
  const report = { schemaVersion: 3, runId: snapshot.runId, scorer: grading?.scorer ?? scoring.VERSION, scoring: grading ? {id:grading.id, name:grading.name, createdAt:grading.createdAt, config:grading.config, scorerHash:grading.scorerHash, sourceHash:grading.sourceHash, engine:grading.engine, offline:grading.offline, targetCallsAdded:grading.targetCallsAdded} : undefined,
    adapter, outputMode: outputMode(snapshot.target),
    evidence: snapshot.evidence, summary, datasets, groups: grouped,
    caveats: ['Endpoint decision testing, not model jailbreak success rate or certification.',
      'Latency is measured at the caller for the tested phase; input preparation is recorded separately.',
      'Unstable rate describes action variation; routing/model changes can also cause it.',
      'PII checks measure annotated value removal, not preservation of all useful content.',
      'Skipped output checks and transport errors are excluded from accuracy and included in coverage.',
      ...(adapter === 'f5-scan' ? ['F5 Scan tests text independently. Original prompt and conversation history are not transmitted or correlated; flagged is an unscorable execution error.'] : [])] };
  save(join(out, 'report.json'), report);
  const byId = new Map(cases.map(c => [c.id, c]));
  const csv: unknown[][] = [['case_id', 'attempt_id', 'dataset', 'phase', 'expected', 'actual', 'status', 'pass', 'latency_ms', 'reason', 'adapter', 'scan_id', 'scoring_id', 'scoring_name']];
  for (const r of records) {
    const c = byId.get(r.caseId)!, result = grades ? grades.get(r.attemptId) : scoring.score(r, c);
    csv.push([r.caseId, r.attemptId, r.dataset, r.phase, c.expected, r.action, r.status,
      r.status === 'completed' ? result?.pass ?? '' : '', r.latencyMs, result?.reason ?? r.error ?? r.skipReason ?? 'Unscored', adapter, r.scanId, grading?.id ?? 'original', grading?.name ?? snapshot.scorer]);
  }
  writeFileSync(join(out, 'results.csv'), csv.map(row => row.map(cell).join(',')).join('\n') + '\n', { mode: 0o600 });
  const md = [`# Guard Endpoint test report`, '', `Run: ${snapshot.runId}`, '',
    `Adapter: ${adapter} | Output mode: ${report.outputMode}`, '',
    snapshot.evidence === 'synthetic-local-demo' ? '**Synthetic samples and a local mock Endpoint: toolchain verification only.**' : '**Measured Endpoint decisions; not end-to-end model jailbreak success rate.**', '',
    '| Metric | Result |', '|---|---:|',
    `| Planned / completed | ${planned} / ${summary.completed} |`, `| Errors / skipped / missing | ${summary.errors} / ${summary.skipped} / ${summary.missing} |`,
    `| Coverage | ${fmt(summary.coverage)} |`, `| Completed-check accuracy | ${fmt(summary.accuracy)} |`,
    `| False-positive / false-negative rate | ${fmt(summary.falsePositiveRate)} / ${fmt(summary.falseNegativeRate)} |`,
    `| Unstable cases | ${fmt(summary.unstableRate)} |`,
    `| Check latency p50 / p95 / p99 (ms) | ${Object.values(summary.latencyMs).map(v => v?.toFixed(2) ?? 'N/A').join(' / ')} |`,
    `| HTTP calls: input / output | ${summary.inputHttpCalls} / ${summary.outputHttpCalls} |`, '| Guard cost | Unavailable |', '', `Scoring: ${grading?.name ?? snapshot.scorer} (${grading?.id ?? 'original'})`, grading?.offline ? 'Offline re-scoring: no additional Target calls. Latency and HTTP call counts come from the original evidence.' : '', '',
    'Accuracy uses completed checks as its denominator. Read it together with coverage. Action acceptance follows the selected scoring rules. Additional text/PII failures do not change the action false-positive/false-negative counts.', '',
    '| Dataset / phase | Completed | Accuracy | Coverage |', '|---|---:|---:|---:|',
    ...Object.entries(grouped).map(([name,s]) => `| ${name.replaceAll('|', '\\|')} | ${s.completed} | ${fmt(s.accuracy)} | ${fmt(s.coverage)} |`), '',
    classificationMarkdown(summary), ...report.caveats.map(x => '- ' + x), ''];
  writeFileSync(join(out, 'report.md'), md.join('\n'), { mode: 0o600 });
  return report;
}
