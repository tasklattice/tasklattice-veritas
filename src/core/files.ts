import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Case } from '../shared/types.js';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const json = <T = any>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));
export const lines = <T = any>(path: string): T[] => readFileSync(path, 'utf8').split(/\r?\n/).filter(x => x.trim()).map((line, i) => {
  try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${i + 1} of ${path}`); }
});
export const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const save = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
export function validateCase(input: unknown): Case {
  const c = input as Case;
  if (!c || typeof c.id !== 'string' || !c.id || typeof c.dataset !== 'string' || !c.dataset) throw new Error('Cases need id and dataset');
  if (!['input', 'output'].includes(c.phase)) throw new Error(`${c.id}: phase must be input or output`);
  if (typeof c.text !== 'string' || !c.text.trim()) throw new Error(`${c.id}: non-empty text is required`);
  if (!['allow', 'block', 'transform', null].includes(c.expected)) throw new Error(`${c.id}: expected must be allow, block, transform or null`);
  if (c.prompt !== undefined && typeof c.prompt !== 'string') throw new Error(`${c.id}: prompt must be text`);
  if (c.pii && (!Array.isArray(c.pii) || c.pii.some(x => typeof x !== 'string' || !x))) throw new Error(`${c.id}: invalid PII values`);
  if (c.messages && (!Array.isArray(c.messages) || c.messages.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string'))) throw new Error(`${c.id}: messages support user/assistant text only`);
  return c;
}
