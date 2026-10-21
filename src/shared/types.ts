import type {ScorerConfig} from "./scorer.js";
export type Action = 'allow' | 'block' | 'transform';
export type Phase = 'input' | 'output';
export type Adapter = 'litellm-generic-guardrail' | 'f5-scan';
export type JsonObject = Record<string, any>;
export interface Case {
  id: string; dataset: string; phase: Phase; text: string; expected: Action | null;
  prompt?: string; pii?: string[]; messages?: { role: 'user' | 'assistant'; content: string }[];
  metadata?: JsonObject; [key: string]: unknown;
}
export interface Target {
  url: string; adapter: Adapter; outputMode: 'paired' | 'standalone'; timeoutMs?: number;
  apiKeyEnv?: string; flagOnly?: false; verbose?: boolean; model?: string; requestData?: JsonObject;
}
export interface Step {
  phase: Phase; request: JsonObject; response?: JsonObject; startedAt: string; httpStatus?: number;
  headers?: Record<string, string>; action?: Action; texts?: string[]; scanId?: string;
  status?: 'completed' | 'error'; error?: string; latencyMs: number;
}
export interface Attempt {
  schemaVersion: number; attemptId: string; caseId: string; dataset: string; phase: Phase;
  adapter: Adapter; contextMode: string; contextOmitted: string[]; callId: string | null; startedAt: string;
  steps: Step[]; status: 'completed' | 'skipped' | 'error'; error?: string; skipReason?: string;
  action?: Action; texts?: string[]; scanId?: string; latencyMs?: number; httpCalls?: number; totalHttpLatencyMs?: number;
}
export interface Grade { pass: boolean; score: number; reason: string; actionPass?: boolean; components?: {name: string; pass: boolean; score: number; reason: string}[] }
export interface SavedGrade {attemptId: string; caseId: string; grade: Grade}
export interface DatasetItem { id: string; name: string; path: string; cases: number; unlabeled: number; phases: Phase[]; datasets: string[]; configs?: string[]; splits?: string[]; revision?: string | null; category?: string | null }
export interface DatasetCard {
  id: string; name: string; repository: string | null; publisher: string; source: 'hf' | 'github' | 'local';
  url: string | null; description: string; license: string | null; revision: string | null;
  configs: string[]; splits: string[]; rawAvailable: boolean; selections: Omit<DatasetItem, 'path'>[];
}
export interface EndpointItem { id: string; name: string; endpoint: Target; credentialAvailable: boolean }
export interface TargetItem { id: string; name: string; target: Target; credentialAvailable: boolean; updatedAt?: string; version?: string }
export interface DatasetSelection { datasetId: string; config?: string; split?: string; field?: string; domain?: string; phase?: Phase }
export interface RunRequest { scorer?: ScorerConfig; datasets?: DatasetSelection[]; limitPerDataset?: number; selectionId?: string; endpointId?: string; config?: string; split?: string; field?: string; domain?: string; gate?: JsonObject; evidence?: 'endpoint' | 'synthetic-local-demo'; datasetId?: string; targetId?: string; repeat: number; concurrency: number; limit?: number; phase?: Phase; skipUnlabeled?: boolean; baselineId?: string }
export interface RunItem {
  id: string; name: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: string; targetName?: string; targetId?: string; finishedAt?: string; datasetIds?: string[]; datasetId?: string; selectionId?: string; endpointId?: string; endpointName?: string; adapter?: Adapter; dataset?: string; target?: string; error?: string;
  evidence?: string; progress?: { completed: number; total: number }; summary?: JsonObject; gate?: JsonObject; exitCode?: number;
}
