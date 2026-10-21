import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { parse } from 'csv-parse';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { decompress } from 'lzma-native';
import { root, json, hash, save, validateCase } from './files.js';
import type { Action, Case, JsonObject, Phase } from '../shared/types.js';
import { sourcePath, downloadFile } from './raw.js';

export const ADAPTER_VERSION = 'dataset-adapters-v2-typescript';
export const catalog = (): JsonObject[] => json(join(root, 'catalog/datasets.json')).datasets;
const bool = (v: unknown): boolean | null => [true, 1, '1', 'true', 'True'].includes(v as never) ? true : [false, 0, '0', 'false', 'False'].includes(v as never) ? false : null;
const safety = (v: unknown): Action | null => ({ safe: 'allow', unsafe: 'block' } as const)[String(v).toLowerCase() as 'safe' | 'unsafe'] ?? null;
const jsonSafe = (v: any): any => typeof v === 'bigint' ? (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : String(v)) : Array.isArray(v) ? v.map(jsonSafe) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,jsonSafe(x)])) : v;
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;

export async function* loadRows(path: string, field?: string): AsyncGenerator<JsonObject> {
  const suffix = extname(path);
  if (suffix === '.parquet') {
    for (const row of await parquetReadObjects({ file: await asyncBufferFromFile(path) })) yield jsonSafe(row);
    return;
  }
  let stream: NodeJS.ReadableStream = createReadStream(path);
  const format = suffix === '.gz' || suffix === '.xz' ? extname(path.slice(0, -suffix.length)) : suffix;
  if (suffix === '.gz') stream = createReadStream(path).pipe(createGunzip());
  if (suffix === '.xz') {
    const buffer = await new Promise<Buffer>((ok, fail) => decompress(readFileSync(path), (data, error) => error || !data ? fail(error || new Error('Invalid XZ')) : ok(Buffer.from(data))));
    const { Readable } = await import('node:stream'); stream = Readable.from([buffer]);
  }
  if (format === '.csv' || format === '.tsv') {
    const parser = (stream as NodeJS.ReadableStream & { pipe: Function }).pipe(parse({ columns: true, delimiter: format === '.tsv' ? '\t' : ',', bom: true, skip_empty_lines: true }));
    for await (const row of parser) yield row;
  } else if (format === '.jsonl') {
    let index = 0;
    for await (const line of createInterface({ input: stream })) {
      index++;
      if (line.trim()) { try { yield JSON.parse(line); } catch { throw new Error(`${basename(path)}:${index}: invalid JSON`); } }
    }
  } else if (format === '.json') {
    const decoder = new StringDecoder('utf8'); let text = ''; for await (const chunk of stream as AsyncIterable<Buffer>) text += decoder.write(chunk); text += decoder.end();
    const data = JSON.parse(text.replace(/^\uFEFF/, ''));
    const rows = field ? data[field] : data;
    if (!Array.isArray(rows)) throw new Error('Nested JSON requires --field CATEGORY');
    yield* rows;
  } else throw new Error(`Unsupported file format: ${basename(path)}`);
}

export function normalize(dataset: string, row: JsonObject, options: {phase: Phase | 'both'; split: string; config: string; field?: string; domain?: string}): Case[] {
  if (dataset === 'veritas') return [validateCase(row)];
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Source records must be objects');
  const { phase, split, config, field, domain } = options;
  const base: JsonObject = { dataset, split, config, metadata: { sourceId: row.id ?? row.Index, labelSource: 'source-label' } };
  const output: Case[] = [];
  function add(text: unknown, expected: Action | null, direction: Phase = 'input', prompt?: string, extra: JsonObject = {}) {
    if (typeof text !== 'string' || !text.trim() || text.trim() === 'REDACTED' || (phase !== 'both' && phase !== direction)) return;
    output.push({ ...base, metadata: { ...base.metadata }, phase: direction, text, expected, ...extra,
      ...(prompt ? { prompt } : {}), id: `${dataset}:${hash(canonical({ split, config, field: field ?? null, row, phase: direction, text })).slice(0, 24)}` } as Case);
  }
  const labelled = (label: boolean | null, positive: Action = 'block'): Action | null => label === null ? null : label ? positive : positive === 'block' ? 'allow' : 'block';
  switch (dataset) {
    case 'aegis':
      for (const [direction, key] of [['input', 'prompt'], ['output', 'response']] as const) {
        base.metadata = { sourceId: row.id, labelSource: row[key + '_label_source'], category: row.violated_categories };
        add(row[key], safety(row[key + '_label']), direction, direction === 'output' ? row.prompt : undefined);
      } break;
    case 'toxicchat': add(row.user_input, labelled(bool(row.toxicity))); break;
    case 'beavertails': base.metadata.category = row.category; add(row.response, labelled(bool(row.is_safe), 'allow'), 'output', row.prompt); break;
    case 'moderation': {
      const labels = row.labels ?? row, keys = ['S', 'H', 'V', 'HR', 'SH', 'S3', 'H2', 'V2'];
      const flags = keys.map(k => bool(labels[k])); base.metadata.labels = Object.fromEntries(keys.map(k => [k, labels[k]]));
      add(row.prompt ?? row.text, flags.includes(true) ? 'block' : flags.every(v => v === false) ? 'allow' : null); break;
    }
    case 'do-not-answer': Object.assign(base.metadata, { labelSource: 'strict-refusal-policy', category: row.risk_area }); add(row.question, 'block'); break;
    case 'harmbench':
      Object.assign(base.metadata, { labelSource: row.FunctionalCategory === 'standard' ? 'strict-refusal-policy' : 'needs-review', category: row.FunctionalCategory, context: row.ContextString });
      add(row.Behavior, row.FunctionalCategory === 'standard' ? 'block' : null); break;
    case 'jailbreakbench':
      if (!['harmful', 'benign'].includes(split)) throw new Error('JailbreakBench requires harmful or benign split');
      Object.assign(base.metadata, { labelSource: 'split-policy', category: row.Category }); add(row.Goal, split === 'harmful' ? 'block' : 'allow'); break;
    case 'wildjailbreak': {
      const kind = row.data_type;
      let expected: Action | null = ['vanilla_benign', 'adversarial_benign'].includes(kind) ? 'allow' : ['vanilla_harmful', 'adversarial_harmful'].includes(kind) ? 'block' : null;
      if ('label' in row) {
        const explicit = labelled(bool(row.label));
        if (expected && explicit && expected !== explicit) throw new Error('WildJailbreak label contradicts data_type');
        if (explicit === null) expected = null;
      }
      Object.assign(base.metadata, { dataType: kind, sourceLabel: row.label, labelSource: 'label' in row ? 'source-label' : 'data-type-policy' });
      add(row.adversarial || row.vanilla, expected); break;
    }
    case 'deepset': add(row.text, labelled(bool(row.label))); break;
    case 'gandalf': base.metadata.labelSource = 'adversarial-corpus-policy'; add(row.text ?? row.prompt, 'block'); break;
    case 'xstest': base.metadata.category = row.type; add(row.prompt, safety(row.label)); break;
    case 'or-bench':
      if (!['or-bench-80k', 'or-bench-hard-1k', 'or-bench-toxic'].includes(config)) throw new Error('Unknown OR-Bench config');
      Object.assign(base.metadata, { labelSource: 'subset-policy', category: row.category }); add(row.prompt, config === 'or-bench-toxic' ? 'block' : 'allow'); break;
    case 'pii': {
      const masks = typeof row.privacy_mask === 'string' ? JSON.parse(row.privacy_mask) : row.privacy_mask ?? [];
      if (!Array.isArray(masks) || masks.some(m => typeof m?.value !== 'string' || !m.value || !row.source_text?.includes(m.value))) throw new Error('Invalid PII annotation or value not present in source_text');
      const pii = masks.map(m => m.value);
      add(row.source_text, pii.length ? 'transform' : 'allow', phase === 'output' ? 'output' : 'input', undefined,
        { pii, referenceText: row.target_text, metadata: { ...base.metadata, language: row.language } }); break;
    }
    case 'topic-control':
      if (!domain) throw new Error('topic-control requires --domain matching the configured policy');
      if (row.domain !== domain) break;
      Object.assign(base.metadata, { labelSource: 'needs-policy-review', domain, scenario: row.scenario, referenceInstruction: row.system_instruction });
      for (const m of row.conversation ?? []) if (m.role === 'user') add(m.content, null);
      for (const d of row.distractors ?? []) add(d.distractor, null); break;
    case 'safety-prompts':
      if (!field) throw new Error('Safety-Prompts requires --field CATEGORY');
      Object.assign(base.metadata, { labelSource: 'needs-review', category: field }); add(row.prompt, null); add(row.response, null, 'output', row.prompt); break;
    default: throw new Error(`Unknown dataset adapter: ${dataset}`);
  }
  return output;
}

export interface ImportOptions { dataset: string; file?: string; out: string; phase?: Phase | 'both'; split?: string; config?: string; field?: string; domain?: string; labels?: string; limit?: number; fetch?: boolean }
export async function importDataset(options: ImportOptions) {
  const entry = options.dataset === 'veritas' ? { id: 'veritas', defaultPhase: 'both', files: [], license: 'user-supplied' } : catalog().find(e => e.id === options.dataset);
  if (!entry) throw new Error('Choose a dataset from datasets list');
  if (!Number.isInteger(options.limit ?? 1000) || (options.limit ?? 1000) < 0) throw new Error('limit must be a non-negative integer');
  const out = resolve(options.out);
  if (existsSync(out)) throw new Error('Output directory exists; choose a new dataset version');
  const specs = entry.files.filter((s: JsonObject) => (options.config || s.default !== false) && (!options.config || options.config === s.config) && (!options.split || options.split === s.split));
  if (!options.fetch && !options.file) throw new Error('import requires --file');
  if (options.file && entry.files.filter((s: JsonObject) => s.default !== false).length > 1 && !options.config && !options.split) throw new Error('Specify --config or --split for this multi-source dataset');
  const sources: {path: string; spec: JsonObject}[] = [];
  if (options.fetch) {
    if (!specs.length) throw new Error('No matching config/split');
    for (const spec of specs) sources.push({ path: await downloadFile(entry.id, spec.path), spec });
  } else sources.push({ path: resolve(options.file!), spec: { ...specs[0], config: options.config ?? specs[0]?.config ?? 'default', split: options.split ?? specs[0]?.split ?? 'local' } });
  const labels = options.labels ? json(options.labels) : {};
  if (!labels || Array.isArray(labels) || Object.values(labels).some(v => !['allow', 'block', 'transform'].includes(v as string))) throw new Error('Labels must map case IDs to reviewed actions');
  const cases: Case[] = [], seen = new Set<string>(), provenance: JsonObject[] = [], counts: JsonObject = {};
  const limit = options.limit ?? 1000;
  for (const { path, spec } of sources) {
    let scanned = 0, converted = 0, capped = false;
    for await (const row of loadRows(path, options.field)) {
      scanned++;
      const items = normalize(options.dataset, row, { ...options, phase: options.phase ?? entry.defaultPhase, config: spec.config, split: spec.split });
      if (!items.length) counts.rowsWithoutSelectedContent = (counts.rowsWithoutSelectedContent ?? 0) + 1;
      for (const item of items) {
        if (seen.has(item.id)) { counts.duplicateCases = (counts.duplicateCases ?? 0) + 1; continue; }
        if (item.id in labels) { item.expected = labels[item.id]; item.metadata = { ...item.metadata, labelSource: 'reviewed-override' }; }
        validateCase(item); seen.add(item.id); cases.push(item); converted++;
        const key = item.expected === null ? 'unlabeled' : 'labeled'; counts[key] = (counts[key] ?? 0) + 1;
        if (limit && converted >= limit) { capped = true; break; }
      }
      if (capped) break;
    }
    provenance.push({ file: spec.path ?? basename(path), sha256: hash(readFileSync(path)), split: spec.split, config: spec.config, scannedRows: scanned, cases: converted, limitReached: capped });
  }
  if (!cases.length) throw new Error('No cases produced; check phase, fields and source schema');
  if (Object.keys(labels).some(k => !seen.has(k))) throw new Error('Label overrides do not match selected cases');
  const data = cases.map(c => JSON.stringify(c)).join('\n') + '\n';
  mkdirSync(out, { recursive: true, mode: 0o700 }); writeFileSync(join(out, 'cases.jsonl'), data, { mode: 0o600 });
  const manifest = { schemaVersion: 1, adapterVersion: ADAPTER_VERSION, adapterSha256: hash(readFileSync(join(root, 'src/core/datasets.ts'))), dataset: options.dataset, source: entry.url ?? null,
    revision: options.fetch ? entry.revision : null, license: entry.license, phase: options.phase ?? entry.defaultPhase, field: options.field ?? null, domain: options.domain ?? null,
    sampling: 'source-order selection per file; not representative random sampling', limitPerSource: limit, files: provenance, counts: { cases: cases.length, ...counts }, casesSha256: hash(data), reviewLabelsSha256: options.labels ? hash(labels) : null };
  save(join(out, 'manifest.json'), manifest); save(join(out, 'review-template.json'), Object.fromEntries(cases.filter(c => c.expected === null).map(c => [c.id, null])));
  return { out, ...manifest.counts };
}

export async function prepareDatasets(out: string, options: {datasets?: string[]; limit?: number; plan?: boolean} = {}) {
  const plan: ImportOptions[] = [];
  for (const entry of catalog()) {
    if (options.datasets && !options.datasets.includes(entry.id)) continue;
    for (const spec of entry.files.filter((s: JsonObject) => s.default !== false)) {
      const file = sourcePath(entry.id, spec.path);
      const fields: (string | undefined)[] = entry.id === 'safety-prompts' ? Object.keys(json(file)) : [undefined];
      for (const field of fields) plan.push({ dataset: entry.id, file, phase: entry.id === 'aegis' ? 'both' : entry.defaultPhase, config: spec.config, split: spec.split,
        field, ...(entry.id === 'topic-control' ? { domain: 'banking' } : {}), limit: options.limit ?? 0,
        out: join(out, [entry.id, spec.config, spec.split, field].filter(Boolean).join('__')) });
    }
  }
  if (options.plan) return plan;
  if (existsSync(out)) throw new Error('Output root already exists');
  for (const item of plan) await importDataset(item);
  save(join(out, 'preparation-plan.json'), { limitPerPackage: options.limit ?? 0, packages: plan });
  return plan;
}
