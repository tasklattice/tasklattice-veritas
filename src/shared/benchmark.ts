import {ATTACK_TEMPLATE_IDS} from './attack-templates.js';
import type {Case, DatasetSelection, JsonObject} from './types.js';

export type TestPurpose = 'endpoint-decisions' | 'jailbreak-detection';
export const purposeLabels: Record<TestPurpose, string> = {
  'endpoint-decisions': 'Endpoint decisions',
  'jailbreak-detection': 'Jailbreak checks',
};
export function validatePurpose(value: unknown = 'endpoint-decisions'): TestPurpose {
  if (value !== 'endpoint-decisions' && value !== 'jailbreak-detection') throw new Error('Choose endpoint-decisions or jailbreak-detection as the test purpose');
  return value;
}
export type SampleKind = 'attack-prompt' | 'behavior-goal' | 'benign-control' | 'other';
/** Infer legacy scope from frozen source fields; never change labels or saved grades. */
export function sampleKind(c: Case): SampleKind {
  if (c.phase !== 'input') return 'other';
  if (c.dataset === 'advbench-attacks') {
    const a=c.metadata?.attack;
    const chains=['jailbreak-templates','base64+jailbreak-templates','rot13+jailbreak-templates'];
    const source=c.expected==='block'&&a?.frozen===true&&typeof a.goal==='string'&&!!a.goal.trim()&&a.goal!==c.text&&typeof a.sourceGoalId==='string'&&a.sourceGoalId.startsWith('advbench:')&&typeof a.promptSha256==='string'&&/^[a-f0-9]{64}$/.test(a.promptSha256);
    const supported=a?.schemaVersion===1?chains.includes(a.strategy):a?.schemaVersion===2&&a.generatorVersion==='advbench-attacks-v2'&&ATTACK_TEMPLATE_IDS.includes(a.template?.id)&&a.attackType===a.template?.id&&/^[a-f0-9]{64}$/.test(a.template?.sha256??'')&&chains.includes(a.strategyChain)&&a.strategy===a.strategyChain+':'+a.template.id;
    return source&&supported?'attack-prompt':'other';
  }
  if (c.dataset === 'jailbreakbench-attacks') return 'attack-prompt';
  if (c.dataset === 'jailbreakbench') return c.split === 'benign' ? 'benign-control' : c.split === 'harmful' ? 'behavior-goal' : 'other';
  if (['advbench', 'harmbench'].includes(c.dataset)) return 'behavior-goal';
  if (c.dataset === 'wildjailbreak') {
    const kind = c.metadata?.dataType;
    if (kind === 'adversarial_harmful') return 'attack-prompt';
    if (kind === 'vanilla_harmful') return 'behavior-goal';
    if (['vanilla_benign', 'adversarial_benign'].includes(String(kind))) return 'benign-control';
  }
  return 'other';
}
export function validateBenchmarkSelection(purpose: unknown, selection: DatasetSelection) {
  if (validatePurpose(purpose) !== 'jailbreak-detection') return;
  if (selection.phase === 'output') throw new Error('Jailbreak checks require input prompts, not saved responses.');
  if (selection.datasetId === 'jailbreakbench' && selection.split !== 'benign') throw new Error('JBB-Behaviors contains behavior goals. Choose its benign split for controls and JailbreakBench Attacks for attack prompts.');
  if (!['jailbreakbench-attacks', 'wildjailbreak', 'jailbreakbench'].includes(selection.datasetId)) throw new Error('This source has no supported jailbreak attack labels. Use JailbreakBench Attacks or WildJailbreak, or switch to Endpoint decisions.');
}
/** Also covers CLI and local imported collections that bypass catalog selection. */
export function validateBenchmarkCases(purpose: unknown, cases: Case[], requireAttack = true) {
  if (validatePurpose(purpose) !== 'jailbreak-detection') return;
  const incompatible = cases.filter(c => !['attack-prompt', 'benign-control'].includes(sampleKind(c)));
  if (incompatible.length) throw new Error(`${incompatible.length} cases are behavior goals or lack supported jailbreak labels. Use actual attack prompts, or select Endpoint decisions. No Target requests were sent.`);
  if (requireAttack && !cases.some(c => sampleKind(c) === 'attack-prompt' && c.expected !== null)) throw new Error('Jailbreak checks need at least one attack prompt. Add JailbreakBench Attacks or WildJailbreak; benign controls alone are insufficient.');
}
export function benchmarkScope(snapshot: JsonObject) {
  const cases = (snapshot.cases ?? []) as Case[];
  const counts: Record<SampleKind, number> = {'attack-prompt': 0, 'behavior-goal': 0, 'benign-control': 0, other: 0};
  for (const c of cases) counts[sampleKind(c)]++;
  const purpose = validatePurpose(snapshot.testPurpose);
  const warnings: string[] = [];
  if (cases.some(c => c.dataset === 'creddata')) warnings.push('CredData measures credential detection in annotated code/configuration snippets. T maps to block only for password, API-key, token or private-key categories; F maps to allow. Unknown and out-of-scope positives require review. Overlapping annotations are merged and source class imbalance is retained; report credential recall and false-positive rate alongside accuracy. This is not the internal DBS Secrets benchmark.');
  if (counts['behavior-goal']) warnings.push(`${counts['behavior-goal']} cases are behavior goals (Goal / Behavior), not submitted jailbreak attack prompts. These scores measure expected Endpoint actions and cannot establish jailbreak-detector accuracy. Re-scoring cannot replace the missing attack texts; start a new test with attack prompts.`);
  if ((counts['attack-prompt'] || counts['behavior-goal']) && !cases.some(c => c.expected === 'allow')) warnings.push('No allow controls were selected. False-positive rate is unavailable; precision and F1 describe this positive-only sample and do not measure benign discrimination.');
  if (cases.some(c => c.dataset === 'advbench-attacks')) warnings.push('AdvBench goals were transformed with frozen promptfoo attack strategies. Labels mean bypass attempts, not proven attack success. Variants share source goals and fixed templates may overlap training data; these are not independent unseen attacks or the original AdvBench ASR benchmark.');
  if (cases.some(c => c.dataset === 'jailbreakbench-attacks')) warnings.push('Upstream jailbroken records success against the original LLM, not a detector label. Submitted attack attempts map to expected block, including unsuccessful attempts; blank prompts are excluded.');
  if (purpose === 'endpoint-decisions' && cases.some(c => c.dataset === 'jailbreakbench' && c.split === 'benign')) warnings.push('JBB benign labels follow the upstream benchmark policy, which may differ from this Target’s content safety policy (for example, consensual adult content). Review policy alignment before interpreting every label disagreement as a model error; original labels and scores are retained.');
  return {version: 1, purpose, label: purposeLabels[purpose], counts, warnings,
    metricScope: 'Accuracy, precision, recall and F1 describe Endpoint actions against expected policy decisions. They are not native-model classification accuracy or attack success rate. The test focus does not enable a Guard policy or select its model; verify the Target routing and execution evidence.'};
}
