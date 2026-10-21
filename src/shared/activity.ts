import type {Action, Attempt, Phase, RunItem} from './types.js';

export type ActivityEvent =
  | {type: 'attempt-start'; attemptId: string; caseId: string; startedAt: string}
  | {type: 'step-start'; attemptId: string; phase: Phase; preparation: boolean; startedAt: string}
  | {type: 'attempt-finish'; attempt: Attempt};
export interface ActivityEntry {
  attemptId: string; caseId: string; dataset: string; phase: Phase; expected: Action | null;
  samplePreview?: string; caseNumber: number; repeat: number; repeats: number; startedAt: string;
  stage: 'starting' | 'preparing-input' | 'scanning-input' | 'scanning-output'; stageStartedAt: string;
  status?: Attempt['status']; finishedAt?: string; action?: Action; error?: string; latencyMs?: number;
}
export interface ActivitySnapshot {
  schemaVersion: 1; phase: 'testing' | 'finalizing' | 'finished'; updatedAt: string;
  concurrency?: number; timeoutMs?: number; caseCount?: number;
  total: number; started: number; finished: number; completed: number; errors: number; skipped: number;
  active: ActivityEntry[]; recent: ActivityEntry[];
}
export interface RunActivity extends ActivitySnapshot {
  runStatus: RunItem['status']; available: boolean; serverTime: string; queuePosition?: number;
  concurrency?: number; timeoutMs?: number; caseCount?: number;
  active: (ActivityEntry & {samplePreview?: string})[];
  recent: (ActivityEntry & {samplePreview?: string})[];
}
