import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { root, json, save, hash } from './files.js';
import type { JsonObject } from '../shared/types.js';
const locks = (): JsonObject[] => json(join(root, 'catalog/raw-datasets.lock.json')).datasets;
export function sourcePath(dataset: string, file: string) {
  const entry = locks().find(e => e.id === dataset);
  if (!entry || !entry.files.some((f: JsonObject) => f.path === file)) throw new Error('Source is not in the immutable raw lock');
  const base = join(root, 'data/raw', entry.id, entry.revision), path = resolve(base, file);
  if (!path.startsWith(base + sep)) throw new Error('Invalid raw path');
  return path;
}
async function verify(path: string, spec: JsonObject) {
  const size = statSync(path).size;
  if (size !== spec.size) throw new Error('Upstream size mismatch');
  const sha = createHash('sha256'), git = createHash('sha1').update(`blob ${size}\0`);
  for await (const chunk of createReadStream(path)) { sha.update(chunk); git.update(chunk); }
  const digest = sha.digest('hex');
  if (spec.sha256 ? digest !== spec.sha256 : git.digest('hex') !== spec.gitBlob) throw new Error('Upstream hash mismatch');
  return { bytes: size, sha256: digest, verification: spec.generated ? 'pinned-reconstruction-sha256' : spec.sha256 ? 'upstream-lfs-sha256' : 'upstream-git-blob-sha1' };
}
function hfToken() {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  const path = process.env.HF_TOKEN_PATH ?? join(process.env.HF_HOME ?? join(homedir(), '.cache/huggingface'), 'token');
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined;
}
export async function downloadFile(dataset: string, file: string, verifyOnly = false) {
  const entry = locks().find(e => e.id === dataset)!;
  const spec = entry?.files.find((f: JsonObject) => f.path === file);
  const path = sourcePath(dataset, file);
  if (!existsSync(path)) {
    if (spec.generated) throw new Error('Reconstructed CredData file is missing. Follow docs/creddata.md and run datasets reconstruct creddata; this file is not an upstream download.');
    if (verifyOnly) throw new Error('Raw file is missing');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const url = entry.source === 'hf' ? `https://huggingface.co/datasets/${entry.repo}/resolve/${entry.revision}/${file}` : `https://raw.githubusercontent.com/${entry.repo}/${entry.revision}/${file}`;
    const token = entry.source === 'hf' ? hfToken() : undefined;
    const response = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`Source download failed: HTTP ${response.status}; gated HF sources require approved access and HF_TOKEN or a local HF login`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(path + '.partial', { mode: 0o600 }));
    await verify(path + '.partial', spec); renameSync(path + '.partial', path);
  }
  await verify(path, spec); return path;
}
export async function downloadAll(options: {dataset?: string; verifyOnly?: boolean; workers?: number} = {}) {
  const entries = locks().filter(e => !options.dataset || options.dataset === e.id);
  if (!entries.length) throw new Error('Unknown dataset ID');
  const workers = options.workers ?? 6;
  if (!Number.isInteger(workers) || workers < 1) throw new Error('workers must be positive');
  const tasks = entries.flatMap(e => e.files.map((f: JsonObject) => ({ entry: e, spec: f }))), results: JsonObject[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, async () => {
    for (;;) {
      const task = tasks[next++]; if (!task) break;
      const { entry, spec } = task;
      try {
        const path = await downloadFile(entry.id, spec.path, options.verifyOnly);
        results.push({ dataset: entry.id, path: spec.path, status: 'verified', ...await verify(path, spec) });
      } catch (error) { results.push({ dataset: entry.id, path: spec.path, status: 'missing', errorType: error instanceof Error ? error.name : 'Error', ...(spec.generated ? {message:'Reconstruct this derived file with datasets reconstruct creddata; see docs/creddata.md.'} : {}) }); }
    }
  }));
  const summary: JsonObject = { schemaVersion: 1, updatedAt: new Date().toISOString(), lockSha256: hash(readFileSync(join(root, 'catalog/raw-datasets.lock.json'))), datasets: [] };
  for (const entry of locks()) {
    const files = results.filter(f => f.dataset === entry.id).map(({ dataset: _, ...f }) => f);
    const dir = join(root, 'data/raw', entry.id, entry.revision);
    if (files.length) {
      const valid = files.filter(f => f.status === 'verified');
      const manifest = { schemaVersion: 1, dataset: entry.id, source: entry.url, revision: entry.revision, scope: entry.scope, license: entry.license,
        finishedAt: summary.updatedAt, status: valid.length === entry.files.length ? 'complete' : 'incomplete', expectedFiles: entry.files.length, verifiedFiles: valid.length,
        verifiedBytes: valid.reduce((n, f) => n + f.bytes, 0), files };
      mkdirSync(dir, { recursive: true, mode: 0o700 }); save(join(dir, '_download-manifest.json'), manifest);
      const { writeFileSync } = await import('node:fs'); writeFileSync(join(dir, 'SHA256SUMS'), valid.map(f => `${f.sha256}  ${f.path}\n`).join(''), { mode: 0o600 });
    }
    if (existsSync(join(dir, '_download-manifest.json'))) {
      const m = json(join(dir, '_download-manifest.json'));
      summary.datasets.push({ dataset: entry.id, revision: entry.revision, status: m.status, expectedFiles: m.expectedFiles, verifiedFiles: m.verifiedFiles,
        verifiedBytes: m.verifiedBytes, missingFiles: m.files.filter((f: JsonObject) => f.status !== 'verified') });
    }
  }
  summary.completeDatasets = summary.datasets.filter((e: JsonObject) => e.status === 'complete').length;
  summary.expectedDatasets = locks().length; summary.verifiedFiles = summary.datasets.reduce((n: number, e: JsonObject) => n + e.verifiedFiles, 0);
  summary.verifiedBytes = summary.datasets.reduce((n: number, e: JsonObject) => n + e.verifiedBytes, 0);
  save(join(root, 'data/raw/download-summary.json'), summary); return summary;
}
