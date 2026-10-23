import {validatePurpose, validateBenchmarkSelection, validateBenchmarkCases} from '../shared/benchmark.js';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catalog, importDataset, ADAPTER_VERSION } from '../core/datasets.js';
import { downloadFile } from '../core/raw.js';
import { root, hash, json, lines, save } from '../core/files.js';
import {sampleCases} from '../core/sampling.js';
import {validateSampling, type PreparationProgress} from '../shared/testing.js';
import type { Case, DatasetSelection, JsonObject, RunRequest } from '../shared/types.js';

/** Validate all source selections before reading files or creating any test traffic. */
export function resolveDatasetSelections(request: RunRequest) {
  const sampling=validateSampling(request.sampling);
  const purpose=validatePurpose(request.testPurpose);
  if(sampling.method!=='source-order' && (request.datasets ? request.limitPerDataset : request.limit)===undefined) throw new Error('Random sampling requires a case limit');
  const multiple = request.datasets !== undefined;
  if (multiple && (request.datasetId !== undefined || request.selectionId !== undefined || ['config','split','field','domain','phase','limit'].some(k => request[k as keyof RunRequest] !== undefined))) throw new Error('Use per-Dataset settings and limitPerDataset with datasets; do not mix legacy selectors');
  if (!multiple && request.limitPerDataset !== undefined) throw new Error('limitPerDataset requires datasets');
  const limit = multiple ? request.limitPerDataset : request.limit;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Maximum cases must be a positive integer');
  if (multiple && (!Array.isArray(request.datasets) || !request.datasets.length)) throw new Error('Select at least one Dataset');
  const choices: DatasetSelection[] = multiple ? request.datasets! : [{datasetId: request.datasetId!, config: request.config, split: request.split, field: request.field, domain: request.domain, phase: request.phase}];
  const seen = new Set<string>();
  return choices.map(selection => {
    if (!selection || typeof selection !== 'object' || typeof selection.datasetId !== 'string') throw new Error('Each Dataset selection requires a datasetId');
    validateBenchmarkSelection(purpose, selection);
    const entry = catalog().find(e => e.id === selection.datasetId);
    if (!entry) throw new Error('Dataset not found: ' + selection.datasetId);
    if (seen.has(entry.id)) throw new Error('Duplicate Dataset: ' + entry.id);
    seen.add(entry.id);
    if (selection.phase && !['input','output'].includes(selection.phase)) throw new Error('Invalid direction for ' + entry.id);
    for (const key of ['config','split','field','domain'] as const) if (selection[key] !== undefined && (typeof selection[key] !== 'string' || !selection[key]!.trim())) throw new Error('Invalid ' + key + ' for ' + entry.id);
    if (entry.id === 'topic-control' && !selection.domain?.trim()) throw new Error('topic-control requires a policy domain');
    const specs: JsonObject[] = entry.files.filter((s: JsonObject) => (selection.config ? s.config === selection.config : s.default !== false) && (!selection.split || s.split === selection.split));
    if (!specs.length) throw new Error('No matching Dataset configuration and split: ' + entry.id);
    return {selection, entry, specs};
  });
}

/** Freeze one or more original source Datasets into one input snapshot. Local files only. */
export async function prepareEvaluationDataset(request: RunRequest, options: {signal?:AbortSignal; onProgress?:(progress:PreparationProgress)=>void} = {}): Promise<string> {
  const selections = resolveDatasetSelections(request);
  const id = randomUUID(), work = join(root, '.cache/evaluation-preparation', id), out = join(root, 'data/evaluation-inputs', id);
  const cases: Case[] = [], sources: JsonObject[] = [], sampling=validateSampling(request.sampling);
  let scannedRows=0,convertedCases=0,filesCompleted=0;
  const filesTotal=selections.reduce((n,s)=>n+s.specs.length,0);
  const progress=(dataset:string,datasetIndex:number,file:string,message:string,rows=0,converted=0)=>{options.signal?.throwIfAborted();options.onProgress?.({dataset,datasetIndex,datasets:selections.length,file,filesCompleted,filesTotal,scannedRows:scannedRows+rows,convertedCases:convertedCases+converted,selectedCases:cases.length,message});};
  mkdirSync(work, {recursive: true, mode: 0o700});
  try {
    for (const [datasetIndex,{entry, selection, specs}] of selections.entries()) {
      const sourceCases: Case[] = [], seen = new Set<string>(), files: JsonObject[] = [];
      const cap = request.datasets ? request.limitPerDataset : request.limit;
      const phase = selection.phase ?? (entry.id === 'aegis' ? 'both' : entry.defaultPhase);
      for (const spec of specs) {
        progress(entry.id,datasetIndex+1,spec.path,'Verifying local source');
        await new Promise<void>(resolve=>setImmediate(resolve));
        const file = await downloadFile(entry.id, spec.path, true);
        const fields: (string | undefined)[] = entry.id === 'safety-prompts' ? (selection.field ? [selection.field] : Object.keys(json(file))) : [undefined];
        for (const field of fields) {
          const part = join(work, entry.id, String(files.length));
          let rows=0,converted=0;
          await importDataset({signal:options.signal,onProgress:(r,c)=>{rows=r;converted=c;progress(entry.id,datasetIndex+1,spec.path,'Converting source records',r,c);},dataset: entry.id, file, out: part, phase, config: spec.config, split: spec.split, field, domain: selection.domain, limit: sampling.method==='source-order' ? cap ?? 0 : 0});
          scannedRows+=rows;convertedCases+=converted;
          const manifest = json<JsonObject>(join(part, 'manifest.json'));
          files.push(...manifest.files.map((f: JsonObject) => ({...f, ...(field ? {field} : {})})));
          for (const c of lines<Case>(join(part, 'cases.jsonl'))) if (!seen.has(c.id)) {seen.add(c.id); sourceCases.push(c);}
        }
        filesCompleted++;
      }
      validateBenchmarkCases(request.testPurpose, sourceCases, false);
      const sampled=sampleCases(sourceCases,cap,sampling,!!request.skipUnlabeled),selected=sampled.cases;
      progress(entry.id,datasetIndex+1,'','Selecting and freezing cases');
      if (!selected.length) throw new Error('No cases match Dataset and direction: ' + entry.id);
      // Every requested source must contribute checks, even when skipping unreviewed labels.
      if (!selected.some(c => c.expected !== null)) throw new Error('No evaluable cases in ' + entry.id + '; reviewed expectations are required');
      cases.push(...selected);
      sources.push({dataset: entry.id, source: entry.url, revision: entry.revision, license: entry.license, phase,
        config: selection.config ?? null, split: selection.split ?? null, field: selection.field ?? null, domain: selection.domain ?? null,
        files, selection:sampled.selection, counts: {cases: selected.length, unlabeled: selected.filter(c => c.expected === null).length}});
    }
    if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Duplicate case IDs across Datasets');
    const data = cases.map(c => JSON.stringify(c)).join('\n') + '\n';
    mkdirSync(out, {recursive: true, mode: 0o700});
    writeFileSync(join(out, 'cases.jsonl'), data, {mode: 0o600});
    save(join(out, 'manifest.json'), {schemaVersion: 1, ...(sources.length === 1 ? sources[0] : {}),
      datasetIds: sources.map(s => s.dataset), sources,
      adapterVersion: ADAPTER_VERSION, adapterSha256: hash([readFileSync(join(root, 'src/core/datasets.ts'), 'utf8'), readFileSync(join(root, 'src/core/creddata.ts'), 'utf8')]),
      sampling:sampling.method==='source-order'?'source-order selection; not representative random sampling':sampling.method==='stratified'?'seeded proportional sampling by expected action, with at least one per present label':'seeded random sampling',
      selection:{algorithm:'case-sampling-v1',...sampling,caseIds:cases.map(c=>c.id)},
      ...(request.datasets ? {limitPerDataset: request.limitPerDataset ?? null} : {limitPerSource: request.limit ?? 0}),
      files: sources.flatMap(s => s.files.map((f: JsonObject) => ({...f, dataset: s.dataset}))),
      counts: {cases: cases.length, unlabeled: cases.filter(c => c.expected === null).length}, casesSha256: hash(data)});
    options.signal?.throwIfAborted();
    options.onProgress?.({datasetIndex:selections.length,datasets:selections.length,filesCompleted,filesTotal,scannedRows,convertedCases,selectedCases:cases.length,message:'Dataset preparation complete'});
    return out;
  } catch (error) {rmSync(out, {recursive: true, force: true}); throw error;}
  finally {rmSync(work, {recursive: true, force: true});}
}
