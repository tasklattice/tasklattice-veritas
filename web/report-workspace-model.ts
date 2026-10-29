import type {DatasetCard,RunItem,TargetItem} from '../src/shared/types';
import {isActiveRun} from '../src/shared/testing';

export const MAX_COMPARED_REPORTS=4;
export function reportDatasets(run:RunItem):string[]{return [...new Set(run.datasetIds?.length?run.datasetIds:run.datasetId?[run.datasetId]:[])].sort();}
export function reportScopeKey(run:RunItem){return JSON.stringify(reportDatasets(run));}
export function reportTargetKey(run:RunItem){const id=run.targetId??run.endpointId;return id?'target:'+id:'legacy:'+JSON.stringify([run.adapter,run.targetName??run.endpointName??run.target??run.id]);}
export function targetLabel(run:RunItem){return run.targetName??run.endpointName??'Historical Target';}
export function scopeLabel(run:RunItem,cards:DatasetCard[]){const ids=reportDatasets(run);return ids.length?ids.map(id=>{const card=cards.find(c=>c.id===id);return card?shortDatasetName(card):id;}).join(' + '):run.dataset||'Historical dataset scope';}
function shortDatasetName(card:DatasetCard){return ({aegis:'Aegis 2.0',deepset:'Prompt Injections',pii:'PII Masking 300K'} as Record<string,string>)[card.id]??card.name;}
/** A visual history must not join unrelated source combinations or evidence types. */
export function trendCohort(runs:RunItem[]){const latest=[...runs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).find(r=>r.summary);return latest?runs.filter(r=>r.summary&&reportScopeKey(r)===reportScopeKey(latest)&&r.evidence===latest.evidence):[];}
export function finishedReports(runs:RunItem[]){return runs.filter(r=>!isActiveRun(r.status)&&r.summary);}
export function reportGroups(runs:RunItem[],targets:TargetItem[]){
  const groups=new Map<string,{key:string;name:string;target?:TargetItem;runs:RunItem[]}>(targets.map(target=>['target:'+target.id,{key:'target:'+target.id,name:target.name,target,runs:[]}]));
  for(const run of [...runs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){const key=reportTargetKey(run);if(!groups.has(key))groups.set(key,{key,name:targetLabel(run),runs:[]});groups.get(key)!.runs.push(run);}
  return [...groups.values()].sort((a,b)=>(b.runs[0]?.createdAt??'').localeCompare(a.runs[0]?.createdAt??'')||a.name.localeCompare(b.name));
}
export function comparisonHref(ids:string[],mode:'history'|'targets'='history',scorings?:string[]){
  const reports=[...new Set(ids)].slice(0,MAX_COMPARED_REPORTS),params=new URLSearchParams({reports:reports.join(','),mode});
  if(scorings?.some(Boolean))params.set('scorings',reports.map(id=>scorings[ids.indexOf(id)]??'').join(','));
  return '#/compare?'+params;
}
export function comparisonCasesHref(baseline:string,candidate:string,baselineScoring:string,scoring:string,mode:'history'|'targets'='history'){
  return comparisonHref([baseline,candidate],mode,[baselineScoring,scoring])+'&view=cases';
}
export function legacyReportComparisonHref(id:string,params:URLSearchParams){
  const requested=params.get('tab'),baseline=params.get('baseline');
  if(requested&&requested!=='compare'||!baseline&&requested!=='compare')return null;
  return baseline&&baseline!==id?comparisonCasesHref(baseline,id,params.get('baselineScoring')??'original',params.get('scoring')??''):comparisonHref([id],'history',[params.get('scoring')??'']);
}
export function parseComparisonIds(value:string|null){return [...new Set((value??'').split(',').filter(Boolean))].slice(0,MAX_COMPARED_REPORTS);}
export function finiteMetric(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null;}
