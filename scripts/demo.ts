import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { root, save } from '../src/core/files.js';
import { importDataset } from '../src/core/datasets.js';
import {rescoreRun} from '../src/core/scoring-revisions.js';
import {protectionScorer} from '../src/shared/scorer.js';
import { runEvaluation } from '../src/core/service.js';
import { startMock } from './mock-endpoint.js';
export async function demo() {
  const base = join(root, 'runs', 'demo-ts-' + Date.now());
  mkdirSync(base, {recursive: true, mode: 0o700});
  const mock = await startMock();
  try {
    await importDataset({dataset: 'veritas', file: join(root, 'examples/endpoint-smoke.jsonl'), out: join(base, 'dataset'), limit: 0});
    for (const [adapter, url] of [['litellm-generic-guardrail', mock.url], ['f5-scan', mock.f5Url]] as const) {
      const target = join(base, adapter + '.target.json'); save(target, {adapter, url});
      const result = await runEvaluation({data: join(base, 'dataset'), target, out: join(base, adapter), repeat: 2, concurrency: 2, evidence: 'synthetic-local-demo'});
      if (result.exitCode !== 0 || result.report.summary.completed !== 12) throw new Error(`${adapter}: SDK demo failed: ${JSON.stringify(result.gate)}`);
      const before=mock.requests.length;const rescored=await rescoreRun(result.directory,protectionScorer());
      if(rescored.exitCode!==0||mock.requests.length!==before||rescored.report.summary.completed!==12)throw new Error('Offline demo added requests or lost checks');
      console.log('Offline re-scoring: '+rescored.id+'; 0 additional Target calls');
      console.log(`${adapter}: 12/12 checks passed; ${result.report.summary.httpCalls} HTTP calls; ${result.directory}/report.md`);
    }
    return base;
  } finally { await mock.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await demo();
