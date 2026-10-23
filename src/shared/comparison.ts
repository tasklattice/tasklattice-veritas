import type {Action,Phase,JsonObject} from './types.js';
export type ChangeKind = 'new-failure'|'fixed'|'still-failing'|'unchanged'|'unstable'|'not-comparable';
export interface ComparedCheck {attemptId:string;status:string;action?:Action;pass?:boolean;reason?:string;latencyMs?:number}
export interface ComparisonRow {
  caseId:string;dataset:string;phase:Phase;expected:Action|null;samplePreview:string;
  change:ChangeKind;reason:string;baseline:ComparedCheck[];candidate:ComparedCheck[];
}
export interface ReportComparison {
  baseline:{id:string;name:string;scoringId:string;scoringName:string};candidate:{id:string;name:string;scoringId:string;scoringName:string};
  counts:Record<ChangeKind,number>;issues:string[];warnings:string[];aggregateComparable:boolean;
  metrics:{name:string;baseline:number|null;candidate:number|null;delta:number|null;unit:'rate'|'ms'}[];
  total:number;offset:number;limit:number;items:ComparisonRow[];
}
