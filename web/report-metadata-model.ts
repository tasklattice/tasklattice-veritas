import type {JsonObject} from '../src/shared/types';

/** Historical combined tests wrap each frozen source in its original manifest. */
export function reportSource(source:JsonObject){
  const manifest=source.manifest&&typeof source.manifest==='object'?source.manifest:source;
  const id=source.dataset??manifest.dataset??source.datasetIds?.join(', ')??'Local inputs';
  const selection=source.sampling??manifest.selection??source.selection;
  const cases=selection?.count??selection?.selectedCases??selection?.caseIds?.length;
  let url:string|undefined;
  try{const parsed=new URL(manifest.source??source.source);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)url=parsed.href;}catch{}
  return {id:String(id),manifest,raw:source,url,revision:manifest.revision??source.revision??null,license:manifest.license??source.license??null,
    scope:[manifest.config,manifest.split].filter(Boolean).join(' / ')||'Not recorded',phase:manifest.phase??source.phase,
    files:Array.isArray(manifest.files)?manifest.files:[],selection,cases:typeof cases==='number'?cases:null};
}
export function reportSampling(configuration:JsonObject,sources:ReturnType<typeof reportSource>[]){
  const selected=configuration.selection;
  if(selected){const method=selected.method??selected.algorithm,label=({'source-order':'Source order',random:'Random',stratified:'Stratified'} as Record<string,string>)[method]??method;return label?label+(selected.seed!==undefined?' · seed '+selected.seed:''):'Not recorded';}
  return sources.some(source=>source.selection?.method||source.selection?.algorithm)?'Per Dataset':'Not recorded';
}
