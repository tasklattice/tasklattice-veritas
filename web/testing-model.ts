import {validatePurpose,validateBenchmarkSelection,type TestPurpose} from '../src/shared/benchmark';
import {validateSampling,type SamplingConfig} from '../src/shared/testing';
import {defaultScorer,validateScorer,type ScorerConfig} from '../src/shared/scorer';
import type {DatasetCard,DatasetSelection,JsonObject,RunRequest,TargetItem} from '../src/shared/types';
export type TestingStep='datasets'|'target'|'settings'|'review';
export type DatasetOptions={sourceSpec:string;phase:''|'input'|'output';field:string;domain:string};
export type TestingInitial={datasetId?:string;targetId?:string};
export type TestingDraft={testPurpose:TestPurpose;samplingMethod:SamplingConfig['method'];seed:string;scorer:ScorerConfig;datasetIds:string[];targetId:string;scope:'full'|'limited';limit:string;concurrency:string;repeat:string;evidence:NonNullable<RunRequest['evidence']>;skipUnlabeled:boolean;options:Record<string,DatasetOptions>};
export const defaultDatasetOptions=():DatasetOptions=>({sourceSpec:'',phase:'',field:'',domain:''});
export const initialTestingDraft=(initial?:TestingInitial):TestingDraft=>({testPurpose:'endpoint-decisions',samplingMethod:'source-order',seed:'42',scorer:defaultScorer(),datasetIds:initial?.datasetId?[initial.datasetId]:[],targetId:initial?.targetId??'',scope:'full',limit:'20',concurrency:'2',repeat:'1',evidence:'endpoint',skipUnlabeled:false,options:{}});
function positive(value:string,label:string,max=Number.MAX_SAFE_INTEGER){const n=Number(value);if(!value.trim()||!Number.isSafeInteger(n)||n<1||n>max)throw new Error(label+(max===Number.MAX_SAFE_INTEGER?' must be a positive whole number.':' must be a whole number between 1 and '+max.toLocaleString()+'.'));return n;}
export function testingSelections(draft:TestingDraft,cards:DatasetCard[],catalog:JsonObject[]):DatasetSelection[]{
  const purpose=validatePurpose(draft.testPurpose);
  if(!draft.datasetIds.length)throw new Error('Choose at least one Dataset.');
  if(new Set(draft.datasetIds).size!==draft.datasetIds.length)throw new Error('Select each Dataset only once.');
  return draft.datasetIds.map(datasetId=>{
    const card=cards.find(c=>c.id===datasetId),entry=catalog.find(c=>c.id===datasetId),settings=draft.options[datasetId]??defaultDatasetOptions();
    if(!card?.rawAvailable)throw new Error('The pinned archive is unavailable for '+(card?.name??datasetId)+'.');
    if(!entry)throw new Error('Dataset configuration is unavailable for '+card.name+'.');
    let spec:JsonObject|undefined;
    if(settings.sourceSpec!==''){const n=Number(settings.sourceSpec);if(!Number.isSafeInteger(n)||n<0||!entry.files?.[n])throw new Error('Choose a valid source scope for '+card.name+'.');spec=entry.files[n];}
    if(settings.phase&&!['input','output'].includes(settings.phase))throw new Error('Choose a valid scan direction.');
    if(datasetId==='topic-control'&&!settings.domain.trim())throw new Error('Add a policy domain for CantTalkAboutThis in Dataset settings.');
    validateBenchmarkSelection(purpose,{datasetId,split:spec?.split,phase:settings.phase||undefined});
    return {datasetId,...(spec?{config:spec.config,split:spec.split}:{}),...(settings.phase?{phase:settings.phase}:{}),...(settings.field.trim()?{field:settings.field.trim()}:{}),...(settings.domain.trim()?{domain:settings.domain.trim()}: {})};
  });
}
export function testingTarget(draft:TestingDraft,targets:TargetItem[]){
  const target=targets.find(t=>t.id===draft.targetId);
  if(!target)throw new Error('Choose a Target.');
  if(!target.credentialAvailable)throw new Error('Set '+(target.target.apiKeyEnv??'the Target credential')+' on the server before starting.');
  return target;
}
export function buildTestingRequest(draft:TestingDraft,cards:DatasetCard[],targets:TargetItem[],catalog:JsonObject[]):RunRequest{
  const selections=testingSelections(draft,cards,catalog);testingTarget(draft,targets);
  if(!['full','limited'].includes(draft.scope))throw new Error('Choose a test scope.');
  const repeat=positive(draft.repeat,'Repeats',100),concurrency=positive(draft.concurrency,'Concurrency',100);
  if(!['endpoint','synthetic-local-demo'].includes(draft.evidence))throw new Error('Choose an evidence type.');
  const sampling=draft.scope==='limited'?validateSampling({method:draft.samplingMethod,...(draft.samplingMethod==='source-order'?{}:{seed:draft.seed.trim()?Number(draft.seed):NaN})}):undefined;
  return {testPurpose:validatePurpose(draft.testPurpose),...(sampling?{sampling}:{}),scorer:validateScorer(draft.scorer),datasets:selections,targetId:draft.targetId,repeat,concurrency,...(draft.scope==='limited'?{limitPerDataset:positive(draft.limit,'Max cases per Dataset')}:{}),skipUnlabeled:draft.skipUnlabeled,evidence:draft.evidence};
}
/** This is an upper bound on checks, never a raw-row count or HTTP-call estimate. */
export function testingCheckLimit(draft:TestingDraft):number|null{
  if(draft.scope!=='limited'||!draft.datasetIds.length)return null;
  try{const n=draft.datasetIds.length*positive(draft.limit,'Cases')*positive(draft.repeat,'Repeats',100);return Number.isSafeInteger(n)?n:null;}catch{return null;}
}
export function directionLabel(id:string,options:DatasetOptions,entry?:JsonObject){return options.phase==='output'?'Saved responses':options.phase==='input'?'Input checks':id==='aegis'?'Input + saved responses':entry?.defaultPhase==='output'?'Saved responses':'Input checks';}
