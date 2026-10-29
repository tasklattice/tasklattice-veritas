import {benchmarkScope} from '../shared/benchmark.js';
import type {Attempt, Case, JsonObject} from '../shared/types.js';

import {piiSummary} from '../shared/pii.js';
import {jevSummary} from '../shared/detection.js';

const ratio = (n: number, d: number) => d ? n / d : null;

/** Detection metrics are independent of scorer assertions. Block and transform are interventions. */
export function classificationMetrics(records: Attempt[], cases: Case[]) {
  const labels = new Map(cases.map(c => [c.id, c.expected]));
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const record of records) {
    const expected = labels.get(record.caseId);
    if (record.status !== 'completed' || !expected || !record.action) continue;
    const positive = expected !== 'allow', detected = record.action !== 'allow';
    if (positive && detected) tp++; else if (positive) fn++; else if (detected) fp++; else tn++;
  }
  const support = tp + fp + fn + tn;
  return {precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn),
    classification: {positiveClass: 'intervention', positiveActions: ['block', 'transform'],
      truePositives: tp, falsePositives: fp, falseNegatives: fn, trueNegatives: tn,
      support, expectedPositive: tp + fn, predictedPositive: tp + fp, accuracy: ratio(tp + tn, support)}};
}

/** Add derived fields without changing saved grades, gate decisions, or historical artifacts. */
export function withClassification(report: JsonObject, snapshot: JsonObject, records: Attempt[]): JsonObject {
  const cases = snapshot.cases as Case[];
  const add = (summary: JsonObject, selected: Case[]) => {
    const ids = new Set(selected.map(c => c.id));
    const scoped=records.filter(r=>ids.has(r.caseId));
    return {...summary, ...classificationMetrics(scoped, selected), jev:jevSummary(scoped), pii:piiSummary(scoped,selected,snapshot.repeat)};
  };
  return {...report, benchmark: benchmarkScope(snapshot), summary: add(report.summary, cases),
    datasets: Object.fromEntries(Object.entries(report.datasets ?? {}).map(([id, s]) => [id, add(s as JsonObject, cases.filter(c => c.dataset === id))])),
    groups: Object.fromEntries(Object.entries(report.groups ?? {}).map(([id, s]) => [id, add(s as JsonObject, cases.filter(c => `${c.dataset}/${c.phase}` === id))]))};
}

export function classificationMarkdown(s: JsonObject) {
  const fmt = (n: number | null) => n == null ? 'N/A' : (n * 100).toFixed(2) + '%';
  const c = s.classification;
  if (!c) return '';
  return ['## Detection metrics', '', '| Metric | Result |', '|---|---:|',
    `| Accuracy (selected scoring rules) | ${fmt(s.accuracy)} |`,
    `| Intervention accuracy (block or transform) | ${fmt(c.accuracy)} |`,
    `| Precision | ${fmt(s.precision)} |`, `| Recall | ${fmt(s.recall)} |`, `| F1 score | ${fmt(s.f1)} |`,
    `| TP / FP / FN / TN | ${c.truePositives} / ${c.falsePositives} / ${c.falseNegatives} / ${c.trueNegatives} |`,
    `| Labelled completed checks | ${c.support} |`, '',
    'Positive class: intervention (block or transform). Precision = TP / (TP + FP); recall = TP / (TP + FN); F1 = 2TP / (2TP + FP + FN). Errors, skipped, missing and unlabelled checks are excluded. Undefined denominators show N/A. These detection metrics use observed actions, independently of the selected scorer. Accuracy above remains the selected scorer match rate; binary detection accuracy is available as classification.accuracy in JSON.', ''].join('\n');
}
