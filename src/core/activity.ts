import {renameSync, rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {save} from './files.js';
import type {Case} from '../shared/types.js';
import type {ActivityEvent, ActivitySnapshot, ActivityEntry} from '../shared/activity.js';

/** Bounded lifecycle state. promptfoo remains responsible for scheduling and concurrency. */
export class ActivityTracker {
  private cases: Map<string, {sample: Case; number: number}>;
  private repeats = new Map<string, number>();
  private value: ActivitySnapshot;
  constructor(cases: Case[], private repeat: number, private path: string, metadata?: {concurrency: number; timeoutMs: number}) {
    this.cases = new Map(cases.map((sample, i) => [sample.id, {sample, number: i + 1}]));
    this.value = {...metadata, caseCount: cases.length, schemaVersion: 1, phase: 'testing', updatedAt: new Date().toISOString(), total: cases.length * repeat,
      started: 0, finished: 0, completed: 0, errors: 0, skipped: 0, active: [], recent: []};
    this.persist();
  }
  snapshot(): ActivitySnapshot {return structuredClone(this.value);}
  event(event: ActivityEvent) {
    if (this.value.phase !== 'testing') return;
    if (event.type === 'attempt-start') {
      const c = this.cases.get(event.caseId);
      if (!c || this.value.active.some(a => a.attemptId === event.attemptId)) return;
      const repeat = (this.repeats.get(event.caseId) ?? 0) + 1; this.repeats.set(event.caseId, repeat);
      this.value.active.push({attemptId: event.attemptId, caseId: event.caseId, dataset: c.sample.dataset,
        phase: c.sample.phase, expected: c.sample.expected, samplePreview: Array.from(c.sample.text.slice(0,480)).slice(0,240).join(''), caseNumber: c.number, repeat, repeats: this.repeat,
        startedAt: event.startedAt, stage: 'starting', stageStartedAt: event.startedAt});
      this.value.started++;
    } else if (event.type === 'step-start') {
      const a = this.value.active.find(a => a.attemptId === event.attemptId);
      if (!a) return;
      a.stage = event.preparation ? 'preparing-input' : event.phase === 'input' ? 'scanning-input' : 'scanning-output';
      a.stageStartedAt = event.startedAt;
    } else {
      const index = this.value.active.findIndex(a => a.attemptId === event.attempt.attemptId);
      if (index < 0) return;
      const [a] = this.value.active.splice(index, 1), r = event.attempt;
      const recent: ActivityEntry = {...a, status: r.status, action: r.action,
        error: r.error ?? r.skipReason, finishedAt: new Date().toISOString(), latencyMs: r.totalHttpLatencyMs};
      this.value.recent.unshift(recent); this.value.recent.length = Math.min(20, this.value.recent.length);
      this.value.finished++; if (r.status === 'completed') this.value.completed++;
      else if (r.status === 'error') this.value.errors++; else this.value.skipped++;
    }
    this.persist();
  }
  phase(phase: ActivitySnapshot['phase']) {this.value.phase = phase; this.value.active = []; this.persist();}
  private persist() {
    this.value.updatedAt = new Date().toISOString();
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {save(temporary, this.value); renameSync(temporary, this.path);} finally {rmSync(temporary, {force: true});}
  }
}
