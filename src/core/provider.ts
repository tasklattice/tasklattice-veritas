import type { Action, Attempt, Case, JsonObject, Phase, Step, Target } from '../shared/types.js';
import {executionFailure} from '../shared/detection.js';
import {guardContextPayload} from './guard-context.js';
import type {ActivityEvent} from '../shared/activity.js';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const actions: Record<string, Action> = { NONE: 'allow', BLOCKED: 'block', GUARDRAIL_INTERVENED: 'transform' };
const scanActions: Record<string, Action> = { cleared: 'allow', blocked: 'block', redacted: 'transform' };
export const adapterType = (target: Partial<Target> | undefined) => target?.adapter ?? 'litellm-generic-guardrail';
export const outputMode = (target: Partial<Target> | undefined) => target?.outputMode ?? (adapterType(target) === 'f5-scan' ? 'standalone' : 'paired');
export function validateTarget(input: unknown): Target {
  const target = input as Target & Record<string, unknown>;
  if (!target || typeof target.url !== 'string') throw new Error('target.url is required');
  const url = new URL(target.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) Endpoint URL without credentials, query parameters or fragments');
  }
  if (target.apiKey !== undefined || target.headers !== undefined) throw new Error('Use apiKeyEnv, not inline credentials or headers');
  const adapter = adapterType(target), mode = outputMode(target);
  if (!['litellm-generic-guardrail', 'f5-scan'].includes(adapter)) throw new Error('adapter must be litellm-generic-guardrail or f5-scan');
  if (!['paired', 'standalone'].includes(mode)) throw new Error('outputMode must be paired or standalone');
  if (adapter === 'f5-scan') {
    if (mode !== 'standalone') throw new Error('F5 Scan supports standalone text checks only; prompt/history are not correlated');
    if (target.flagOnly !== undefined && target.flagOnly !== false) throw new Error('F5 action scoring requires flagOnly=false');
    if (target.verbose !== undefined && typeof target.verbose !== 'boolean') throw new Error('verbose must be boolean');
    if (target.model !== undefined || target.requestData !== undefined) throw new Error('F5 Scan does not support model or requestData');
  } else if (target.flagOnly !== undefined || target.verbose !== undefined) {
    throw new Error('flagOnly and verbose are F5 Scan options');
  }
  if ((url.pathname.endsWith('/backend/v1/scans') && adapter !== 'f5-scan') ||
      (url.pathname.endsWith('/beta/litellm_basic_guardrail_api') && adapter !== 'litellm-generic-guardrail')) {
    throw new Error('Target adapter does not match the Endpoint URL');
  }
  if (!Number.isInteger(target.timeoutMs ?? 30000) || (target.timeoutMs ?? 30000) < 1) throw new Error('timeoutMs must be positive');
  if (target.apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/.test(target.apiKeyEnv)) throw new Error('Invalid apiKeyEnv');
  return { ...target, adapter, outputMode: mode,
    ...(adapter === 'f5-scan' ? { flagOnly: false, verbose: target.verbose ?? true } : {}) };
}

function decodeResult(response: JsonObject, phase: Phase, adapter: Target["adapter"]): {action: Action; texts: string[]; scanId?: string} {
  if (!response || typeof response !== 'object') throw new Error('Missing Guard result');
  if (adapter === 'f5-scan') {
    const outcome = response.result?.outcome;
    if (outcome === 'flagged') throw new Error('F5 returned ambiguous flagged outcome; cannot score allow/block/transform (flagOnly=false was requested)');
    const action = Object.hasOwn(scanActions, outcome) ? scanActions[outcome] : undefined;
    if (!action) throw new Error('Missing or invalid F5 result.outcome');
    if (typeof response.id !== 'string' || !response.id || typeof response.redactedInput !== 'string') {
      throw new Error('Invalid F5 scan id or redactedInput');
    }
    const text = phase === 'output' ? response.result.response : response.redactedInput;
    if (action !== 'block' && typeof text !== 'string') throw new Error('F5 response scan requires result.response text');
    return { action, texts: action === 'block' ? [] : [text], scanId: response.id };
  }
  const action = Object.hasOwn(actions, response.action) ? actions[response.action] : undefined;
  if (!action || response.evaluated === false) throw new Error('Missing or invalid Guard action');
  if (response.blocked_reason === 'No Router matches this request.') throw new Error('No routing rule matched; this is not a content rejection');
  if (action === 'transform' && (!Array.isArray(response.texts) || !response.texts.every(x => typeof x === 'string'))) {
    throw new Error('GUARDRAIL_INTERVENED requires texts for text evaluation');
  }
  return { action, texts: response.texts || [] };
}

export default class TaliProvider {
  config: { target?: unknown; evidencePath?: string };
  target: Target;
  private onActivity?: (event: ActivityEvent) => void;
  constructor(options: {config?: {target?: unknown; evidencePath?: string}; onActivity?: (event: ActivityEvent) => void} = {}) {
    this.onActivity = options.onActivity;
    this.config = options.config || {};
    this.target = validateTarget(this.config.target);
  }
  id() { return 'tali-endpoint'; }

  async check(testCase: Case, phase: Phase, text: string, callId: string | null, messages: Case["messages"], signal?: AbortSignal, attemptId?: string, preparation = false) {
    const scan = this.target.adapter === 'f5-scan';
    const boundary = guardContextPayload(testCase);
    if (scan && boundary) throw new Error('F5 Scan cannot preserve Guard boundary context; use a LiteLLM Target');
    const body: JsonObject = scan ? { input: text, scanDirection: phase === 'input' ? 'request' : 'response',
      flagOnly: false, verbose: this.target.verbose } : {
      input_type: phase === 'input' ? 'request' : 'response',
      texts: [text],
      structured_messages: messages,
      ...(boundary ? {guardrail_context: boundary} : {}),
      ...(callId ? { litellm_call_id: callId } : {}),
      ...(this.target.model ? { model: this.target.model } : {}),
      ...(this.target.requestData ? { request_data: this.target.requestData } : {}),
    };
    // Dataset instructions remain untrusted context; they never configure Guard policy.
    if (!scan && testCase.prompt && phase === 'output') body.guardrail_context = { query: testCase.prompt };
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-guard-evidence': 'evaluations-v1' };
    const secret = this.target.apiKeyEnv ? process.env[this.target.apiKeyEnv] : undefined;
    if (this.target.apiKeyEnv && !secret) throw new Error(`Missing environment variable ${this.target.apiKeyEnv}`);
    if (secret) headers[scan ? 'authorization' : 'x-api-key'] = scan ? `Bearer ${secret}` : secret;
    const step: Step = { phase, request: body, startedAt: new Date().toISOString(), latencyMs: 0 };
    if (attemptId) this.onActivity?.({type: 'step-start', attemptId, phase, preparation, startedAt: step.startedAt});
    const started = performance.now();
    try {
      const timeout = AbortSignal.timeout(this.target.timeoutMs ?? 30000);
      const response = await fetch(this.target.url, {
        method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      step.httpStatus = response.status;
      // Retain evidence headers, never request credentials or arbitrary response headers.
      step.headers = Object.fromEntries(['x-guard-runner-id', 'x-guard-route-assignment', 'x-request-id', 'x-tasklattice-scan-compatibility', 'x-guard-evaluation-evidence']
        .filter(key => response.headers.has(key)).map(key => [key, secret ? response.headers.get(key)!.split(secret).join('[REDACTED_CREDENTIAL]') : response.headers.get(key)!]));
      const reader = response.body?.getReader();
      let raw = '', bytes = 0;
      const decoder = new TextDecoder();
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Response exceeds 2 MiB'); }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
      // A misbehaving service must not persist the configured credential in its echo.
      if (secret) raw = raw.split(secret).join('[REDACTED_CREDENTIAL]');
      try { step.response = JSON.parse(raw); } catch { step.response = { raw }; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      Object.assign(step, decodeResult(step.response!, phase, this.target.adapter));
      const executionError=executionFailure(step);if(executionError)throw new Error(executionError);
      step.status = 'completed';
    } catch (error: any) {
      step.status = 'error';
      step.error = error.name === 'TimeoutError' ? 'Request timeout' : error.message;
      if (secret) step.error = step.error!.split(secret).join('[REDACTED_CREDENTIAL]');
    }
    step.latencyMs = performance.now() - started;
    return step;
  }

  async callApi(_prompt: string, context: {vars: {case: Case}}, options: {abortSignal?: AbortSignal} = {}) {
    const testCase = context.vars.case;
    const attemptId = randomUUID();
    const scan = this.target.adapter === 'f5-scan';
    const paired = this.target.outputMode === 'paired';
    // Standalone output deliberately omits litellm_call_id: an unknown correlated
    // output ID is rejected by composed Tali endpoints. Attempt ID stays in evidence.
    const callId = scan || (testCase.phase === 'output' && !paired) ? null : `veritas-${attemptId}`;
    const result: Attempt = { schemaVersion: 3, attemptId, caseId: testCase.id, dataset: testCase.dataset,
      adapter: this.target.adapter, contextMode: scan ? 'text-only' : 'conversation',
      contextOmitted: scan ? [testCase.prompt ? 'prompt' : null, testCase.messages?.length ? 'messages' : null].filter((x): x is string => x !== null) : [],
      phase: testCase.phase, callId, startedAt: new Date().toISOString(), steps: [], status: 'error' };
    this.onActivity?.({type: 'attempt-start', attemptId, caseId: testCase.id, startedAt: result.startedAt});
    const messages = testCase.messages || (testCase.prompt ? [{ role: 'user', content: testCase.prompt }] : []);
    try {
      if (testCase.phase === 'output' && paired) {
        if (!testCase.prompt?.trim()) throw new Error('Paired output needs the original prompt; use standalone explicitly if unavailable');
        const input = await this.check(testCase, 'input', testCase.prompt, callId, messages, options.abortSignal, attemptId, true);
        result.steps.push(input);
        if (input.status === 'error') throw new Error(`Input preparation failed: ${input.error}`);
        if (input.action === 'block') {
          result.status = 'skipped';
          result.skipReason = 'Input was blocked; output check was not executed';
        }
      }
      if (result.status !== 'skipped') {
        const step = await this.check(testCase, testCase.phase, testCase.text, callId, messages, options.abortSignal, attemptId);
        result.steps.push(step);
        if (step.status === 'error') throw new Error(step.error);
        result.status = 'completed';
        result.action = step.action!;
        result.texts = step.texts;
        if (step.scanId) result.scanId = step.scanId;
        result.latencyMs = step.latencyMs;
      }
    } catch (error: any) { result.error = error.message; }
    result.totalHttpLatencyMs = result.steps.reduce((sum, step) => sum + step.latencyMs, 0);
    result.httpCalls = result.steps.length;
    if (this.config.evidencePath) appendFileSync(this.config.evidencePath, JSON.stringify(result) + '\n', { mode: 0o600 });
    this.onActivity?.({type: 'attempt-finish', attempt: result});
    return {
      output: JSON.stringify(result),
      ...(result.status === 'error' ? { error: result.error } : {}),
      metadata: { attemptId, callId, adapter: this.target.adapter, scanId: result.scanId, phase: testCase.phase },
      cached: false,
    };
  }
}
