import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { JsonObject } from '../src/shared/types.js';
import { randomUUID } from 'node:crypto';
export async function startMock({ apiKey, port = 0 }: {apiKey?: string; port?: number} = {}) {
  const requests: JsonObject[] = [], contexts = new Set<string>();
  let inFlight = 0, maxInFlight = 0;
  const server = createServer(async (req, res) => {
    inFlight++; maxInFlight = Math.max(inFlight, maxInFlight); res.once('close', () => inFlight--);
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body: JsonObject;
    try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
    const scan = req.url?.endsWith('/backend/v1/scans');
    const authValid = !apiKey || (scan ? req.headers.authorization === `Bearer ${apiKey}` : req.headers['x-api-key'] === apiKey);
    requests.push({ body, adapter: scan ? 'f5-scan' : 'litellm-generic-guardrail',
      apiKeyPresent: !!req.headers['x-api-key'], bearerPresent: !!req.headers.authorization?.startsWith('Bearer '), authValid });
    const text = scan ? body.input || '' : body.texts?.[0] || '';
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-guard-runner-id', 'synthetic-test-runner');
    if (!authValid) { res.writeHead(401).end(JSON.stringify({ detail: 'invalid credential' })); return; }
    if (scan && (typeof body.input !== 'string' || !['request', 'response'].includes(body.scanDirection) ||
        typeof body.flagOnly !== 'boolean' || typeof body.verbose !== 'boolean' || body.texts !== undefined || body.input_type !== undefined)) {
      res.writeHead(422).end(JSON.stringify({ detail: 'invalid Scan request' })); return;
    }
    if (text.includes('[ERROR]')) { res.writeHead(503).end(JSON.stringify({ detail: 'fixture unavailable' })); return; }
    if (text.includes('[MALFORMED]')) { res.end('{not-json'); return; }
    if (text.includes('[UNKNOWN]')) { res.end(JSON.stringify(scan ? { result: { outcome: 'UNKNOWN' } } : { action: 'UNKNOWN' })); return; }
    if (text.includes('[NO_ROUTE]')) {
      if (scan) res.writeHead(503).end(JSON.stringify({ detail: { code: 'scan_unavailable' } }));
      else res.end(JSON.stringify({ action: 'BLOCKED', blocked_reason: 'No Router matches this request.' }));
      return;
    }
    if (text.includes('[SLOW]')) await new Promise(resolve => setTimeout(resolve, 80));
    if (text.includes('[TIMEOUT]')) await new Promise(resolve => setTimeout(resolve, 150));
    if (scan) {
      const id = randomUUID();
      res.setHeader('x-request-id', id);
      res.setHeader('x-tasklattice-scan-compatibility', 'v1');
      let outcome = text.includes('[BLOCK]') ? 'blocked' : text.includes('person@example.test') ? 'redacted' : 'cleared';
      if (text.includes('[FLAGGED]') || (body.flagOnly && outcome !== 'cleared')) outcome = 'flagged';
      const redactedInput = outcome === 'redacted' ? text.replaceAll('person@example.test', '[EMAIL]') : text;
      const result: JsonObject = { id, redactedInput, result: { outcome,
        response: body.scanDirection === 'response' && outcome !== 'blocked' ? redactedInput : null,
        scannerResults: [] }, scanners: null };
      if (text.includes('[MISSING_TEXT]')) delete result.redactedInput;
      if (text.includes('[MISSING_ID]')) delete result.id;
      if (text.includes('[BAD_OUTPUT]')) result.result.response = null;
      if (text.includes('[LEAK_OUTPUT]')) result.result.response = text;
      if (text.includes('[ECHO_CREDENTIAL]')) result.note = req.headers.authorization;
      res.end(JSON.stringify(result)); return;
    }
    if (body.input_type === 'request' && body.litellm_call_id) contexts.add(body.litellm_call_id);
    if (body.input_type === 'response' && body.litellm_call_id && !contexts.has(body.litellm_call_id)) {
      res.writeHead(503).end(JSON.stringify({ detail: 'call_context_expired' })); return;
    }
    if (text.includes('[BLOCK]')) { res.end(JSON.stringify({ action: 'BLOCKED', blocked_reason: 'synthetic fixture' })); return; }
    if (text.includes('person@example.test')) {
      res.end(JSON.stringify({ action: 'GUARDRAIL_INTERVENED', texts: [text.replaceAll('person@example.test', '[EMAIL]')] })); return;
    }
    res.end(JSON.stringify({ action: 'NONE' }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/runtime/v1/endpoints/demo/beta/litellm_basic_guardrail_api`, requests, get maxInFlight() { return maxInFlight; },
    f5Url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/runtime/v1/endpoints/demo/backend/v1/scans`,
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
}
