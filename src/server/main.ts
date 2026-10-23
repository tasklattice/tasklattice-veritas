import {attackTemplateCatalog} from '../core/attack-templates.js';
import {freezeAdvBenchAttacks} from '../core/attacks.js';
import Fastify from 'fastify';
import {jevDetection,jevLabels} from '../shared/detection.js';
import {detectionCsv,detectionMarkdown} from '../core/guard-evidence.js';
import {piiLabels} from '../shared/pii.js';
import {piiCsv,piiMarkdown} from '../core/pii-report.js';
import {classificationMarkdown} from '../core/classification.js';
import {upstreamCard,upstreamCardAsset} from './upstream-card.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { root } from '../core/files.js';
import { catalog, importDataset } from '../core/datasets.js';
import { sourcePath } from '../core/raw.js';
import { datasets, datasetCards, targets, saveTarget, getTarget, updateTarget, deleteTarget, RunStore } from './store.js';
import {DatasetViewer, type ViewerQuery} from './dataset-viewer.js';
import {scoringDirectory,activeScoringId,scoringHistory} from '../core/scoring-revisions.js';
import type { JsonObject, RunRequest } from '../shared/types.js';

export async function buildServer(options: {ui?: boolean} = {}) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const store = new RunStore(), viewer = new DatasetViewer();
  app.addHook('onClose', async () => {store.close(); await viewer.close();});
  app.addHook('onRequest', async (request, reply) => {
    const host = new URL('http://' + request.headers.host).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return reply.code(403).send({ error: 'Local access only' });
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return reply.code(403).send({ error: 'Cross-origin requests are not allowed' });
  });
  app.setErrorHandler((error: any, _request, reply) => reply.code(error.statusCode ?? 400).send({ error: error.message }));
  app.get('/api/datasets', async () => ({ items: datasetCards() }));
  app.get('/api/dataset-selections', async () => ({ items: datasets().map(({path, ...d}) => d) }));
  app.get<{Params:{id:string}}>('/api/datasets/:id/viewer', async request => viewer.metadata(request.params.id));
  app.get<{Params:{id:string};Querystring:ViewerQuery}>('/api/datasets/:id/rows', async (request,reply) => {const page=viewer.rows(request.params.id,request.query);return reply.code(page.status==='indexing'?202:200).send(page);});
  app.get<{Params:{id:string;index:string};Querystring:ViewerQuery}>('/api/datasets/:id/rows/:index', async (request,reply) => {const row=viewer.row(request.params.id,request.params.index,request.query);return reply.code(row.status==='indexing'?202:200).send(row);});
  app.get<{Params:{id:string}}>('/api/datasets/:id/card',async request=>upstreamCard(request.params.id));
  app.get<{Params:{id:string}}>('/api/datasets/:id/card/raw',async(request,reply)=>{const card=upstreamCard(request.params.id);return reply.type('text/markdown; charset=utf-8').header('Content-Disposition','attachment; filename="README.md"').header('X-Content-Type-Options','nosniff').send(card.raw);});
  app.get<{Params:{id:string};Querystring:{path:string}}>('/api/datasets/:id/card/asset',async(request,reply)=>{const asset=upstreamCardAsset(request.params.id,request.query.path);return reply.type(asset.mime).header('X-Content-Type-Options','nosniff').send(asset.bytes);});
  app.get('/api/catalog', async () => ({ items: catalog() }));
  app.get('/api/datasets/advbench/attack-templates',async()=>({items:(await attackTemplateCatalog()).map(({body:_body,...metadata})=>metadata)}));
  app.post('/api/datasets/advbench/attacks', async request => {
    const input=(request.body??{}) as JsonObject;
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['seed','goalLimit','controlLimit','strategies','templates'].includes(k)))throw new Error('Expected seed, goalLimit, controlLimit, templates and offline strategies');
    const out=join(root,'data/imports','advbench-attacks-'+randomUUID().slice(0,8));
    await freezeAdvBenchAttacks({out,seed:input.seed,goalLimit:input.goalLimit,controlLimit:input.controlLimit,strategies:input.strategies,templates:input.templates});
    const selection=datasets().find(d=>d.path===out)!;const {path:_path,...item}=selection;return {item};
  });
  app.post('/api/datasets/import', async request => {
    const input = request.body as JsonObject, entry = catalog().find(e => e.id === input.dataset);
    if (!entry) throw new Error('Unknown dataset');
    const spec = entry.files.find((s: JsonObject) => (!input.config || s.config === input.config) && (!input.split || s.split === input.split) && s.default !== false);
    if (!spec) throw new Error('No matching source');
    const out = join(root, 'data/imports', `${entry.id}-${randomUUID().slice(0, 8)}`);
    await importDataset({ dataset: entry.id, file: sourcePath(entry.id, spec.path), out, phase: input.phase ?? entry.defaultPhase,
      config: spec.config, split: spec.split, field: input.field, domain: input.domain, limit: input.limit ?? 1000 });
    return { item: datasets().find(d => d.path === out) };
  });
  app.get('/api/endpoints', async () => ({items: targets().map(t => ({id: t.id, name: t.name, endpoint: t.target, credentialAvailable: t.credentialAvailable}))}));
  app.post('/api/endpoints', async request => { const input = request.body as JsonObject; const t = saveTarget({name: input.name, target: input.endpoint}); return {item: {id: t.id, name: t.name, endpoint: t.target, credentialAvailable: t.credentialAvailable}}; });
  const publicTarget = (t: ReturnType<typeof getTarget>) => {const {path:_path,original:_original,state:_state,...item}=t;return item;};
  app.get('/api/targets', async () => ({items:targets().map(publicTarget)}));
  app.get<{Params:{id:string}}>('/api/targets/:id', async request => ({item:publicTarget(getTarget(request.params.id))}));
  app.put<{Params:{id:string}}>('/api/targets/:id', async request => ({item:publicTarget(updateTarget(request.params.id,request.body as JsonObject))}));
  app.delete<{Params:{id:string}}>('/api/targets/:id', async request => ({deleted:deleteTarget(request.params.id).id}));
  app.post('/api/targets', async request => ({item:publicTarget(saveTarget(request.body as JsonObject))}));
  app.get<{Params:{id:string};Querystring:{baseline:string;scoring?:string;baselineScoring?:string;filter?:string;dataset?:string;offset?:string;limit?:string}}>('/api/runs/:id/compare',async request=>store.compare(request.params.id,request.query.baseline,{...request.query,offset:request.query.offset===undefined?undefined:Number(request.query.offset),limit:request.query.limit===undefined?undefined:Number(request.query.limit)}));
  app.get<{Params:{id:string}}>('/api/runs/:id/activity', async request => store.activity(request.params.id));
  app.get('/api/runs', async () => ({ items: store.list().filter(r => !r.name.endsWith('/evaluation')).map(({...r}) => { delete (r as any).path; return r; }) }));
  app.delete<{Params:{id:string}}>('/api/runs/:id', async request => ({deleted:store.remove(request.params.id).id}));
  app.get<{Params:{id:string;attemptId:string};Querystring:{scoring?:string}}>('/api/runs/:id/attempts/:attemptId', async request => store.attempt(request.params.id,request.params.attemptId,request.query.scoring));
  app.post<{Params:{id:string}}>('/api/runs/:id/rescore',async request=>{const input=request.body as JsonObject;if(!input?.scorer)throw new Error('scorer is required');const result=await store.rescore(request.params.id,input.scorer);return {id:result.id,report:result.report,gate:result.gate,exitCode:result.exitCode};});
  app.post('/api/runs', async (request, reply) => reply.code(202).send(await store.start(request.body as RunRequest)));
  app.get<{Params: {id: string};Querystring:{scoring?:string}}>('/api/runs/:id', async request => { const result = store.detail(request.params.id,request.query.scoring); delete (result.run as any).path; return result; });
  app.get<{Params: {id: string}; Querystring: {offset?: string; limit?: string; filter?: string; dataset?: string; scoring?: string}}>('/api/runs/:id/attempts', async request => {
    const offset = Math.max(0, Number(request.query.offset) || 0), limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
    const filter = request.query.filter ?? 'all';
    if (!['all', 'unexpected', 'error', 'skipped',...Object.keys(jevLabels).map(k=>'jev-'+k),...Object.keys(piiLabels).map(k=>'pii-'+k)].includes(filter)) throw new Error('Unknown result filter');
    const allEvidence = store.evidence(request.params.id,request.query.scoring);
    const evidence = request.query.dataset ? allEvidence.filter(a => a.dataset === request.query.dataset) : allEvidence, unexpected = evidence.filter(a => a.status === 'completed' && a.grade?.pass === false);
    const selected = filter.startsWith('pii-') ? evidence.filter(a=>a.pii?.status===filter.slice(4)) : filter.startsWith('jev-') ? evidence.filter(a=>a.status==='completed'&&jevDetection(a).status===filter.slice(4)) : filter === 'unexpected' ? unexpected : filter === 'error' || filter === 'skipped' ? evidence.filter(a => a.status === filter) : evidence;
    return {items: selected.slice(offset, offset + limit), total: selected.length, allTotal: allEvidence.length, datasetTotal: evidence.length, unexpected: unexpected.length, errors: evidence.filter(a => a.status === 'error').length, skipped: evidence.filter(a => a.status === 'skipped').length};
  });
  app.get<{Params: {id: string; file: string};Querystring:{scoring?:string}}>('/api/runs/:id/files/:file', async (request, reply) => {
    const dir=store.directory(request.params.id),scoringId=request.query.scoring??activeScoringId(dir);
    if(request.params.file==='scorer.json'){const config=scoringHistory(dir).find(v=>v.id===scoringId)?.config;if(!config)return reply.code(404).send({error:'Scoring version not found'});return reply.header('content-disposition','attachment; filename="scorer.json"').send(config);}
    if (!['report.md', 'results.csv', 'report.json'].includes(request.params.file)) return reply.code(404).send({ error: 'Unknown artifact' });
    const path = join(scoringDirectory(dir,scoringId), request.params.file);
    if (!existsSync(path)) return reply.code(404).send({ error: 'Artifact is not ready' });
    let content: string | Buffer = readFileSync(path);
    if(request.params.file==='results.csv')content=piiCsv(detectionCsv(content.toString(),store.evidence(request.params.id,scoringId)),store.evidence(request.params.id,scoringId));
    if(request.params.file==='report.md'&&!content.toString().includes('## PII outcomes'))content=content.toString()+'\n'+piiMarkdown(store.detail(request.params.id,scoringId).report!.summary);
    if(request.params.file==='report.md'&&!content.toString().includes('## JEV model evidence'))content=content.toString()+'\n'+detectionMarkdown(store.detail(request.params.id,scoringId).report!.summary);
    if (request.params.file === 'report.json') content = JSON.stringify(store.detail(request.params.id,scoringId).report,null,2) + '\n';
    if (request.params.file === 'report.md' && !content.toString().includes('## Detection metrics')) content = content.toString() + '\n' + classificationMarkdown(store.detail(request.params.id,scoringId).report!.summary);
    return reply.header('content-disposition', `attachment; filename="${request.params.file}"`).type(request.params.file.endsWith('.json') ? 'application/json' : request.params.file.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8').send(content);
  });
  app.post<{Params: {id: string}}>('/api/runs/:id/cancel', async request => store.cancel(request.params.id));
  if (options.ui === false) return {app, store};
  if (process.env.NODE_ENV === 'production') {
    const { default: serveStatic } = await import('@fastify/static');
    await app.register(serveStatic, { root: join(root, 'dist/web'), wildcard: true });
    app.setNotFoundHandler((request, reply) => (request.url.startsWith('/api/') || request.url.startsWith('/assets/')) ? reply.code(404).send({error: 'Not found'}) : reply.sendFile('index.html'));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: join(root, 'vite.config.ts'), server: { middlewareMode: true } });
    app.addHook('onClose', () => vite.close());
    app.setNotFoundHandler((request, reply) => { reply.hijack(); vite.middlewares(request.raw, reply.raw, () => { reply.raw.writeHead(404).end('Not found'); }); });
  }
  return { app, store };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { app } = await buildServer();
  await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 38100) });
  console.log(`Veritas: http://localhost:${process.env.PORT ?? 38100}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
