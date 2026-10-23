import type {RunItem} from './types.js';
export interface SamplingConfig {method: 'source-order' | 'random' | 'stratified'; seed?: number}
export function validateSampling(value: unknown = {method:'source-order'}): SamplingConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sampling configuration is required');
  const v = value as Record<string,unknown>;
  if (Object.keys(v).some(k => !['method','seed'].includes(k)) || !['source-order','random','stratified'].includes(String(v.method))) throw new Error('Choose source-order, random or stratified sampling');
  if (v.method === 'source-order') {
    if (v.seed !== undefined) throw new Error('Source-order sampling does not use a seed');
    return {method:'source-order'};
  }
  if (!Number.isSafeInteger(v.seed) || Number(v.seed)<0 || Number(v.seed)>4294967295) throw new Error('Random seed must be a whole number between 0 and 4294967295');
  return {method:v.method as SamplingConfig['method'],seed:v.seed as number};
}
export const isActiveRun = (status: RunItem['status']) => ['queued','preparing','running','scoring'].includes(status);
export interface PreparationProgress {
  dataset?: string; datasetIndex: number; datasets: number; file?: string; filesCompleted: number; filesTotal: number;
  scannedRows: number; convertedCases: number; selectedCases: number; message: string;
}
export interface RunStage {
  stage: 'queued' | 'preparing' | 'running' | 'scoring' | 'reporting' | 'finished';
  updatedAt: string; message: string; completed?: number; total?: number; preparation?: PreparationProgress;
}
