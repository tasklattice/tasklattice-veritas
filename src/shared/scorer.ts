import type {Action} from './types.js';

export const ACTIONS: Action[] = ['allow', 'block', 'transform'];
export const TEXT_ASSERTIONS = ['contains', 'not-contains', 'equals', 'is-json'] as const;
export interface TextAssertion {type: typeof TEXT_ASSERTIONS[number]; value?: string; scope: 'all' | 'transformed'}
export interface ScorerConfig {
  schemaVersion: 1;
  name: string;
  acceptedActions: Record<Action, Action[]>;
  checkPii: boolean;
  assertions: TextAssertion[];
}
export function defaultScorer(): ScorerConfig {
  return {schemaVersion: 1, name: 'Strict action matching', acceptedActions: {allow: ['allow'], block: ['block'], transform: ['transform']}, checkPii: true, assertions: []};
}
export function protectionScorer(): ScorerConfig {
  return {...defaultScorer(), name: 'Block or transform', acceptedActions: {allow: ['allow'], block: ['block', 'transform'], transform: ['transform']}};
}
/** Final-action classification only; complete redaction remains independent evidence. */
export function interventionScorer(): ScorerConfig {
  return {schemaVersion: 1, name: 'Intervention (block or transform)',
    acceptedActions: {allow: ['allow'], block: ['block', 'transform'], transform: ['block', 'transform']},
    checkPii: false, assertions: []};
}
export function scorerPreset(config: ScorerConfig): 'strict'|'protect'|'intervention'|'custom' {
  for (const [key, preset] of [['strict', defaultScorer()], ['protect', protectionScorer()], ['intervention', interventionScorer()]] as const) {
    if (config.checkPii === preset.checkPii && ACTIONS.every(action =>
      config.acceptedActions[action].length === preset.acceptedActions[action].length &&
      preset.acceptedActions[action].every(value => config.acceptedActions[action].includes(value)))) return key;
  }
  return 'custom';
}
function object(value: unknown): value is Record<string, unknown> {return !!value && typeof value === 'object' && !Array.isArray(value);}
function keys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error('Unsupported scoring field: ' + key);
}
/** Data only: cannot load code, providers, local files, or remote judges. */
export function validateScorer(value: unknown = defaultScorer()): ScorerConfig {
  if (!object(value)) throw new Error('Scoring rules must be an object');
  keys(value, ['schemaVersion', 'name', 'acceptedActions', 'checkPii', 'assertions']);
  if (value.schemaVersion !== 1) throw new Error('Scoring schemaVersion must be 1');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw new Error('Scoring name must contain 1–80 characters');
  if (!object(value.acceptedActions)) throw new Error('acceptedActions must define allow, block and transform');
  keys(value.acceptedActions, ACTIONS);
  const acceptedActions = {} as ScorerConfig['acceptedActions'];
  for (const action of ACTIONS) {
    const choices = value.acceptedActions[action];
    if (!Array.isArray(choices) || !choices.length || choices.some(v => !ACTIONS.includes(v)) || new Set(choices).size !== choices.length) throw new Error('Choose at least one unique accepted action for ' + action);
    acceptedActions[action] = ACTIONS.filter(a => choices.includes(a));
  }
  if (typeof value.checkPii !== 'boolean') throw new Error('checkPii must be true or false');
  if (!Array.isArray(value.assertions) || value.assertions.length > 20) throw new Error('assertions must contain at most 20 text checks');
  const assertions = value.assertions.map((a): TextAssertion => {
    if (!object(a)) throw new Error('Each text assertion must be an object');
    keys(a, ['type', 'value', 'scope']);
    if (!TEXT_ASSERTIONS.includes(a.type as any) || !['all', 'transformed'].includes(a.scope as string)) throw new Error('Unsupported text assertion type or scope');
    if (a.type !== 'is-json' && (typeof a.value !== 'string' || !a.value.length || a.value.length > 2000)) throw new Error('Text assertion values must contain 1–2,000 characters');
    if (a.type === 'is-json' && a.value !== undefined) throw new Error('is-json does not accept a value');
    return {type: a.type as TextAssertion['type'], scope: a.scope as TextAssertion['scope'], ...(a.type === 'is-json' ? {} : {value: a.value as string})};
  });
  return {schemaVersion: 1, name: value.name.trim(), acceptedActions, checkPii: value.checkPii, assertions};
}
