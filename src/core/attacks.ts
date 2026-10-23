import {attackTemplateCatalog,renderAttackTemplate,ATTACK_TEMPLATE_IDS,type AttackTemplate} from './attack-templates.js';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {loadRows, normalize} from './datasets.js';
import {downloadFile} from './raw.js';
import {hash, json, root, save, validateCase} from './files.js';
import {sampleCases} from './sampling.js';
import type {Case, JsonObject} from '../shared/types.js';

export const ATTACK_GENERATOR_VERSION = 'advbench-attacks-v2';
export const ATTACK_STRATEGIES = ['jailbreak-templates', 'base64+jailbreak-templates', 'rot13+jailbreak-templates'] as const;
export type AttackStrategy = typeof ATTACK_STRATEGIES[number];
export interface AttackOptions {out:string; seed?:number; goalLimit?:number; controlLimit?:number; strategies?:string[]; templates?:string[]; signal?:AbortSignal}

/** Only deterministic, local promptfoo strategies are allowed in a frozen corpus. */
export async function constructAttack(goal:Case, chain:AttackStrategy, signal?:AbortSignal, template?:AttackTemplate):Promise<Case> {
  if (!ATTACK_STRATEGIES.includes(chain)) throw new Error('Unsupported offline attack strategy: '+chain);
  if (goal.dataset!=='advbench'||goal.phase!=='input'||goal.expected!=='block') throw new Error('Attack construction requires a labeled AdvBench input goal');
  process.env.PROMPTFOO_DISABLE_TELEMETRY ??= '1';
  process.env.PROMPTFOO_DISABLE_UPDATE ??= '1';
  const {redteam} = await import('promptfoo');
  const version=json(join(root,'node_modules/promptfoo/package.json')).version;
  let text=goal.text;
  const steps:JsonObject[]=[];
  for(const id of chain.split('+')) {
    signal?.throwIfAborted();
    const strategy=redteam.Strategies.find(s=>s.id===id);
    if(!strategy)throw new Error('Installed promptfoo does not provide strategy '+id);
    // sample=1 uses the upstream fixed template and avoids random template sorting.
    const config=id==='jailbreak-templates'?{sample:1}:{};
    const result=template&&id==='jailbreak-templates'?[{vars:{prompt:renderAttackTemplate(template,text)}}]:await strategy.action([{vars:{prompt:text},metadata:{pluginId:'harmful:advbench'}}],'prompt',config);
    if(result.length!==1||typeof result[0]?.vars?.prompt!=='string'||!result[0].vars.prompt.trim())throw new Error('promptfoo must return exactly one non-empty attack per goal');
    const next=result[0].vars.prompt;
    if(next===text||!next.includes(text)&&id==='jailbreak-templates')throw new Error('Strategy discarded or did not transform its input');
    steps.push({id,config:template&&id==='jailbreak-templates'?{templateId:template.id,templateSha256:template.sha256,payloadPlacement:template.payloadPlacement}:config,inputSha256:hash(text),outputSha256:hash(next)});text=next;
  }
  if(text===goal.text)throw new Error('A behavior goal cannot be labeled as an attack without transformation');
  const generatorVersion=template?ATTACK_GENERATOR_VERSION:'advbench-attacks-v1',strategyId=template?chain+':'+template.id:chain;
  return validateCase({id:'advbench-attacks:'+hash({version:generatorVersion,sourceGoalId:goal.id,chain,text}).slice(0,24),
    dataset:'advbench-attacks',phase:'input',config:strategyId,split:'attacks',text,expected:'block',
    metadata:{...goal.metadata,labelSource:'constructed-bypass-attempt-policy',attack:{schemaVersion:template?2:1,frozen:true,generatorVersion,promptfooVersion:version,
      sourceGoalId:goal.id,goal:goal.text,goalSha256:hash(goal.text),promptSha256:hash(text),strategy:strategyId,strategyChain:chain,...(template?{attackType:template.id,template:{id:template.id,label:template.label,sha256:template.sha256,payloadPlacement:template.payloadPlacement}}:{}),steps}}});
}

/** Verify pinned local sources, construct once, and atomically save an immutable input version. */
export async function freezeAdvBenchAttacks(options:AttackOptions) {
  const out=resolve(options.out),seed=options.seed??42,goalLimit=options.goalLimit??20,controlLimit=options.controlLimit??60;
  if(existsSync(out))throw new Error('Output directory exists; choose a new frozen dataset version');
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('seed must be an integer between 0 and 4294967295');
  for(const [name,value]of Object.entries({goalLimit,controlLimit}))if(!Number.isSafeInteger(value)||value<1)throw new Error(name+' must be a positive integer');
  const strategies=options.strategies??['jailbreak-templates'];
  if(!Array.isArray(strategies)||!strategies.length||new Set(strategies).size!==strategies.length||strategies.some(s=>typeof s!=='string'||!ATTACK_STRATEGIES.includes(s as AttackStrategy)))throw new Error('Choose unique supported offline attack strategies: '+ATTACK_STRATEGIES.join(', '));
  const templateIds=options.templates??[...ATTACK_TEMPLATE_IDS];
  if(!Array.isArray(templateIds)||!templateIds.length||new Set(templateIds).size!==templateIds.length||templateIds.some(id=>!ATTACK_TEMPLATE_IDS.includes(id as any)))throw new Error('Choose unique supported templates: '+ATTACK_TEMPLATE_IDS.join(', '));
  options.signal?.throwIfAborted();
  const selectedTemplates=(await attackTemplateCatalog()).filter(t=>templateIds.includes(t.id));
  const locks=json(join(root,'catalog/raw-datasets.lock.json')).datasets as JsonObject[];
  const specs=[{dataset:'harmbench',file:'data/behavior_datasets/extra_behavior_datasets/advbench_behaviors.csv'},
    {dataset:'jailbreakbench',file:'data/benign-behaviors.csv'}];
  const sources:JsonObject[]=[],pools:Case[][]=[];
  for(const spec of specs){
    const entry=locks.find(e=>e.id===spec.dataset);if(!entry)throw new Error('Missing pinned source '+spec.dataset);
    const path=await downloadFile(spec.dataset,spec.file,true),sha256=hash(readFileSync(path)),pool:Case[]=[];
    for await(const row of loadRows(path)){
      options.signal?.throwIfAborted();
      if(spec.dataset==='harmbench'){
        if(typeof row.Behavior!=='string'||!row.Behavior.trim()||typeof row.BehaviorID!=='string'||!row.BehaviorID)throw new Error('Unexpected AdvBench source schema');
        pool.push(validateCase({id:'advbench:'+hash({revision:entry.revision,file:spec.file,sourceId:row.BehaviorID,text:row.Behavior}).slice(0,24),dataset:'advbench',phase:'input',text:row.Behavior,expected:'block',
          metadata:{sourceId:row.BehaviorID,archiveRepository:entry.repo,archiveRevision:entry.revision,archiveFile:spec.file,sourceSha256:sha256,labelSource:'strict-refusal-policy'}}));
      }else{
        const items=normalize('jailbreakbench',row,{phase:'input',config:'behaviors',split:'benign'});
        if(items.length!==1||items[0].expected!=='allow')throw new Error('Unexpected JBB benign source schema');
        pool.push({...items[0],metadata:{...items[0].metadata,archiveRepository:entry.repo,archiveRevision:entry.revision,archiveFile:spec.file,sourceSha256:sha256}});
      }
    }
    if(new Set(pool.map(c=>c.id)).size!==pool.length||new Set(pool.map(c=>c.text)).size!==pool.length)throw new Error('Duplicate source rows require review before construction');
    pools.push(pool);sources.push({dataset:spec.dataset,repository:entry.repo,source:entry.url,revision:entry.revision,license:entry.license,files:[{file:spec.file,sha256,rows:pool.length}]});
  }
  if(goalLimit>pools[0].length||controlLimit>pools[1].length)throw new Error('Requested sample size exceeds the pinned source population');
  const goals=sampleCases(pools[0],goalLimit,{method:'random',seed}),controls=sampleCases(pools[1],controlLimit,{method:'random',seed});
  const attacks:Case[]=[];
  for(const goal of goals.cases)for(const template of selectedTemplates)for(const strategy of strategies)attacks.push(await constructAttack(goal,strategy as AttackStrategy,options.signal,template));
  const cases=[...attacks,...controls.cases].sort((a,b)=>hash({seed,id:a.id}).localeCompare(hash({seed,id:b.id}))||a.id.localeCompare(b.id));
  if(new Set(cases.map(c=>c.id)).size!==cases.length||new Set(cases.map(c=>c.text)).size!==cases.length)throw new Error('Duplicate constructed samples require review');
  const overlap=new Set(attacks.map(c=>c.text));if(controls.cases.some(c=>overlap.has(c.text)))throw new Error('Attack/control text overlap');
  const data=cases.map(c=>JSON.stringify(c)).join('\n')+'\n';
  const manifest={schemaVersion:1,kind:'frozen-attack-corpus',datasetIds:['advbench-attacks','jailbreakbench'],generatorVersion:ATTACK_GENERATOR_VERSION,
    generatorSha256:hash(readFileSync(join(root,'src/core/attacks.ts'))),engine:{name:'promptfoo',version:json(join(root,'node_modules/promptfoo/package.json')).version,api:'redteam.Strategies',remoteGeneration:false},
    strategies:strategies.map(id=>({id,steps:id.split('+')})),templates:selectedTemplates,templateCatalog:{selection:'semantic family selector, then lowest content hash; never selected by detector results',poolSize:selectedTemplates[0].poolSize,poolSha256:selectedTemplates[0].poolSha256},sources,
    selection:{algorithm:ATTACK_GENERATOR_VERSION,method:'random',seed,goals:goals.selection,controls:controls.selection,caseIds:cases.map(c=>c.id)},
    counts:{sourceGoals:goals.cases.length,attackTypes:selectedTemplates.length,attacks:attacks.length,benign:controls.cases.length,cases:cases.length},casesSha256:hash(data),
    notes:['Constructed attack attempts, not verified successful jailbreaks against a victim LLM. This is not the original AdvBench ASR protocol.',
      'All variants from one goal are correlated; report by strategy as well as overall. Repeats are repeated checks, not independent new goals.',
      'JBB benign controls are preserved without jailbreak wrappers. Their role is false-positive measurement.',
      'Templates are fixed upstream examples and may overlap model training data; results do not establish unseen-attack generalization.']};
  options.signal?.throwIfAborted();mkdirSync(dirname(out),{recursive:true,mode:0o700});const work=mkdtempSync(join(dirname(out),'.freeze-attacks-'));
  try{writeFileSync(join(work,'cases.jsonl'),data,{mode:0o600});save(join(work,'manifest.json'),manifest);
    if(existsSync(out))throw new Error('Output directory exists; choose a new frozen dataset version');renameSync(work,out);
  }finally{rmSync(work,{recursive:true,force:true});}
  return {out,...manifest.counts,casesSha256:manifest.casesSha256,seed,strategies,templates:templateIds};
}
