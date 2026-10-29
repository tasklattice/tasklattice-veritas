import type {JsonObject} from '../shared/types.js';
import {DEFAULT_QUALITY_THRESHOLDS} from '../shared/quality-thresholds.js';
export function gateReport(report: JsonObject, gate: JsonObject = {}, comparison?: JsonObject) {
  const allowed = new Set(['minCoverage', 'minAccuracy', 'maxFalsePositiveRate', 'maxFalseNegativeRate', 'maxP95Ms', 'maxAccuracyDrop']);
  for (const [key, value] of Object.entries(gate)) if (!allowed.has(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key !== 'maxP95Ms' && value > 1)) throw new Error(`Invalid gate: ${key}`);
  const s = report.summary, failures: JsonObject[] = [];
  for (const [key, actual, direction, fallback] of [
    ['minCoverage', s.coverage, 'min', DEFAULT_QUALITY_THRESHOLDS.minCoverage], ['minAccuracy', s.accuracy, 'min', DEFAULT_QUALITY_THRESHOLDS.minAccuracy], ['maxFalsePositiveRate', s.falsePositiveRate, 'max'],
    ['maxFalseNegativeRate', s.falseNegativeRate, 'max'], ['maxP95Ms', s.latencyMs.p95, 'max'], ['maxAccuracyDrop', comparison?.accuracyDrop, 'max'],
  ] as [string, number | null | undefined, string, number?][]) {
    const threshold = gate[key] ?? fallback;
    if (threshold !== undefined && (actual == null || (direction === 'min' ? actual < threshold : actual > threshold))) failures.push({ metric: key, threshold, actual: actual ?? null });
  }
  return { pass: failures.length === 0, failures };
}
