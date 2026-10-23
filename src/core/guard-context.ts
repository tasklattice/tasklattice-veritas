import type {Case, JsonObject} from '../shared/types.js';

/** Map only explicit boundary evidence. Expected labels and metadata never enter requests. */
export function guardContextPayload(testCase: Case): JsonObject | undefined {
  const value = testCase.guardContext;
  if (value === undefined) return undefined;
  const fail = (): never => { throw new Error(testCase.id + ': invalid input Guard context'); };
  const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= 100_000);
  if (testCase.phase !== 'input' || !object(value) || Object.keys(value).some(k => !['query','targetSource','memory'].includes(k))) fail();
  if (!text(value.query) || (value.targetSource !== undefined && !['user_input','retrieved_content','tool_output'].includes(value.targetSource))) fail();
  if (value.targetSource === undefined && value.memory === undefined) fail();
  const result: JsonObject = {};
  if (value.query !== undefined) result.query = value.query;
  if (value.targetSource !== undefined) result.target_source = value.targetSource;
  if (value.memory !== undefined) {
    const memory = value.memory;
    if (!object(memory) || Object.keys(memory).some(k => !['operation','sourceQuery'].includes(k)) || !['read','write'].includes(memory.operation) || !text(memory.sourceQuery)) fail();
    const source = memory.operation === 'read' ? 'retrieved_content' : 'tool_output';
    if (value.targetSource !== undefined && value.targetSource !== source) fail();
    result.memory = {operation: memory.operation, ...(memory.sourceQuery !== undefined ? {source_query: memory.sourceQuery} : {})};
  }
  return result;
}
