import {attackTemplateCatalog} from './core/attack-templates.js';
import {freezeAdvBenchAttacks} from './core/attacks.js';
import {validatePurpose} from './shared/benchmark.js';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, importDataset, prepareDatasets } from './core/datasets.js';
import { downloadAll } from './core/raw.js';
import { json } from './core/files.js';
import {reconstructCredData} from './core/creddata.js';
import { compareRuns, gateReport, loadReport, runEvaluation } from './core/service.js';
import {validateSampling} from './shared/testing.js';
import {rescoreRun} from './core/scoring-revisions.js';
import type { Phase, JsonObject } from './shared/types.js';
export async function main(argv = process.argv.slice(2)): Promise<number> {
  process.umask(0o077);
  const [command, ...args] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log(`Veritas — TypeScript testing workbench powered by the promptfoo SDK

  npm run dev                         Start the desktop app and local API
  npm run veritas -- demo              Verify both adapters locally
  npm run veritas -- datasets list
  npm run veritas -- datasets download --verify-only
  npm run veritas -- datasets import wildjailbreak --file eval.tsv --config eval --split train --limit 0 --out data/wild-v1
  npm run veritas -- datasets prepare --out data/prepared-v1
  npm run veritas -- datasets reconstruct creddata --source-dir /path/to/CredData --out data/raw/creddata/REVISION
  npm run veritas -- datasets attacks advbench --goal-limit 20 --control-limit 60 --seed 42 --out data/imports/advbench-attacks-v2
  npm run veritas -- run --data data/wild-v1 --endpoint data/targets/my-f5.json --out runs/first
  npm run veritas -- rescore --run runs/first --scorer examples/scorer-protection.json
  npm run veritas -- report --run runs/first
  npm run veritas -- compare --baseline runs/first --run runs/second

Run options: --purpose endpoint-decisions|jailbreak-detection --sampling source-order|random|stratified --seed N --concurrency N --repeat N --limit N --phase input|output --skip-unlabeled --baseline DIR --gate FILE --scorer FILE
Report/compare options: --scoring ID --baseline-scoring ID (default: original)
Exit codes: 0 passed, 1 quality gate failed, 2 configuration/execution error.`);
    return 0;
  }
  if (command === 'demo') { const { demo } = await import('../scripts/demo.js'); await demo(); return 0; }
  if (command === 'datasets') {
    const [action, ...rest] = args;
    const { values: parsed, positionals } = parseArgs({ args: rest, allowPositionals: true, options: Object.fromEntries([
      ...['file', 'out', 'phase', 'split', 'config', 'field', 'domain', 'labels', 'limit', 'dataset', 'workers', 'goal-limit', 'control-limit', 'seed', 'strategies', 'templates', 'source-dir'].map(k => [k, { type: 'string' }]),
      ['verify-only', { type: 'boolean' }], ['plan', { type: 'boolean' }],
    ]) as any });
    const values = parsed as Record<string, string | boolean | undefined>;
    const dataset = positionals[0];
    if(action==='attack-templates'){console.log(JSON.stringify((await attackTemplateCatalog()).map(({body:_body,...metadata})=>metadata),null,2));return 0;}
    if (action === 'list') { console.log(JSON.stringify(catalog(), null, 2)); return 0; }
    if (action === 'download') { const result = await downloadAll({ dataset: values.dataset as string, verifyOnly: !!values['verify-only'], workers: values.workers ? Number(values.workers) : undefined }); console.log(JSON.stringify(result, null, 2)); return values.dataset ? result.datasets.find((d: JsonObject) => d.dataset === values.dataset)?.status === 'complete' ? 0 : 2 : result.completeDatasets === result.expectedDatasets ? 0 : 2; }
    if (!values.out) throw new Error('--out is required');
    if (action === 'reconstruct') {
      if (dataset !== 'creddata' || !values['source-dir']) throw new Error('datasets reconstruct creddata requires --source-dir and --out; see docs/creddata.md');
      console.log(JSON.stringify(reconstructCredData(String(values['source-dir']), String(values.out)), null, 2)); return 0;
    }
    if (action === 'attacks') {
      if(dataset!=='advbench')throw new Error('datasets attacks currently supports advbench');
      const abort=new AbortController(),stop=()=>abort.abort();process.once('SIGINT',stop);
      try{console.log(JSON.stringify(await freezeAdvBenchAttacks({out:String(values.out),seed:values.seed===undefined?undefined:Number(values.seed),goalLimit:values['goal-limit']===undefined?undefined:Number(values['goal-limit']),controlLimit:values['control-limit']===undefined?undefined:Number(values['control-limit']),strategies:values.strategies===undefined?undefined:String(values.strategies).split(','),templates:values.templates===undefined?undefined:String(values.templates).split(','),signal:abort.signal}),null,2));return 0;}finally{process.removeListener('SIGINT',stop);}
    }
    if (action === 'prepare') { console.log(JSON.stringify(await prepareDatasets(resolve(String(values.out)), { datasets: values.dataset ? [String(values.dataset)] : undefined, limit: values.limit ? Number(values.limit) : 0, plan: !!values.plan }), null, 2)); return 0; }
    if (!['import', 'fetch'].includes(action)) throw new Error('Unknown dataset command');
    console.log(JSON.stringify(await importDataset({ dataset: dataset!, file: values.file as string, out: String(values.out), phase: values.phase as Phase | 'both',
      split: values.split as string, config: values.config as string, field: values.field as string, domain: values.domain as string, labels: values.labels as string, limit: values.limit === undefined ? undefined : Number(values.limit), fetch: action === 'fetch' }), null, 2));
    return 0;
  }
  const { values: parsed } = parseArgs({ args, options: Object.fromEntries([...['data', 'target', 'endpoint', 'out', 'repeat', 'concurrency', 'limit', 'phase', 'run', 'baseline', 'gate', 'evidence', 'scorer', 'scoring', 'baseline-scoring','sampling','seed','purpose'].map(k => [k, { type: 'string' }]), ['skip-unlabeled', { type: 'boolean' }]]) as any });
  const values = parsed as Record<string, string | boolean | undefined>;
  if (command === 'run') {
    if (!values.data || !(values.endpoint || values.target) || !values.out) throw new Error('run requires --data, --endpoint and --out');
    if(values.seed!==undefined&&(!values.sampling||!String(values.seed).trim()))throw new Error('--seed requires an explicit sampling method and an integer value');
    const abort = new AbortController(); const stop = () => abort.abort(); process.once('SIGINT', stop);
    try {
      const result = await runEvaluation({ testPurpose:validatePurpose(values.purpose),sampling:values.sampling?validateSampling({method:values.sampling,...(values.seed===undefined?{}:{seed:Number(values.seed)})}):undefined, scorer:values.scorer as string, data: String(values.data), target: String(values.endpoint ?? values.target), out: String(values.out), repeat: values.repeat === undefined ? undefined : Number(values.repeat),
        concurrency: values.concurrency === undefined ? undefined : Number(values.concurrency), limit: values.limit === undefined ? undefined : Number(values.limit), phase: values.phase as Phase,
        skipUnlabeled: !!values['skip-unlabeled'], baseline: values.baseline as string, gate: values.gate as string, evidence: values.evidence as any, signal: abort.signal });
      console.log(JSON.stringify({ report: result.directory + '/report.md', ...result.report.summary, gate: result.gate }, null, 2)); return result.exitCode;
    } finally { process.removeListener('SIGINT', stop); }
  }
  if (!values.run) throw new Error('--run is required');
  if(command==='rescore'){
    if(!values.scorer)throw new Error('rescore requires --scorer FILE');
    const abort=new AbortController(),stop=()=>abort.abort();process.once('SIGINT',stop);
    try{const result=await rescoreRun(resolve(String(values.run)),json(resolve(String(values.scorer))),{signal:abort.signal});
      console.log(JSON.stringify({scoringId:result.id,report:result.directory+'/report.md',targetCallsAdded:0,summary:result.report.summary,gate:result.gate},null,2));return result.exitCode;
    }finally{process.removeListener('SIGINT',stop);}
  }
  if (command === 'report') { console.log(JSON.stringify(loadReport(String(values.run),values.scoring as string | undefined).summary, null, 2)); return 0; }
  if (command === 'compare' && values.baseline) { const comparison = compareRuns(String(values.baseline), String(values.run), values['baseline-scoring'] as string | undefined,values.scoring as string | undefined), gate = gateReport(loadReport(String(values.run),values.scoring as string | undefined), values.gate ? json(String(values.gate)) : {}, comparison); console.log(JSON.stringify({ comparison, gate }, null, 2)); return gate.pass ? 0 : 1; }
  throw new Error('Unknown command');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(`veritas: ${error.message}`); process.exitCode = 2; });
