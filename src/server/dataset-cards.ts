import type { DatasetCard, DatasetItem, JsonObject } from '../shared/types.js';

const descriptions: Record<string,string> = {
  aegis: 'Content-safety prompts and saved responses with independent safety labels. The test selection uses the test split.',
  toxicchat: 'Real chat prompts annotated for toxicity, for testing unsafe-input detection and false positives.',
  beavertails: 'Model responses annotated for safety. Original prompts are retained for paired output testing.',
  'do-not-answer': 'Questions covering risk areas where a strict-refusal policy expects rejection.',
  jailbreakbench: 'Harmful and benign behavior prompts for testing jailbreak detection and false positives.',
  wildjailbreak: 'Adversarial harmful and benign prompts. The test configuration uses the upstream train split.',
  deepset: 'Prompt-injection texts with binary labels for testing direct text detection.',
  gandalf: 'Adversarial prompts from the Gandalf challenge. This corpus does not supply a benign comparison group.',
  xstest: 'Safe and unsafe prompts for measuring exaggerated safety responses and unnecessary blocking.',
  'or-bench': 'Benign prompts that challenge over-refusal, alongside a toxic comparison subset.',
  pii: 'Texts with annotated private values for testing masking and redaction.',
  'topic-control': 'Topic-control conversations and distractors. Expected actions depend on the configured policy and require review.',
  'safety-prompts': 'Chinese prompts and saved responses organized by safety scenario. Expected actions require review.',
  moderation: 'Text samples with moderation category labels for testing content-safety decisions.',
  harmbench: 'Harmful behavior prompts. Standard behaviors use a strict-refusal mapping; contextual variants require review.',
};

/** A source repository is one Dataset; local case packages are selections beneath it. */
export function datasetIdForSelection(selection: DatasetItem): string {
  return selection.datasets.length === 1 ? selection.datasets[0] : 'local-collection:' + [...selection.datasets].sort().join('+');
}

export function buildDatasetCards(entries: JsonObject[], selections: DatasetItem[]): DatasetCard[] {
  const cards = new Map<string, DatasetCard>(entries.map(entry => [entry.id, {
    id: entry.id, name: entry.repo.split('/').at(-1), repository: entry.repo, publisher: entry.repo.split('/')[0],
    source: entry.source, url: entry.url, description: descriptions[entry.id] ?? entry.notes, license: entry.license,
    revision: entry.revision, configs: [...new Set<string>(entry.files.map((f: JsonObject) => f.config))],
    splits: [...new Set<string>(entry.files.map((f: JsonObject) => f.split))], rawAvailable: false, selections: [],
  }]));
  for (const selection of selections) {
    const id = datasetIdForSelection(selection);
    if (!cards.has(id)) cards.set(id, {id, name: selection.datasets.join(' + '), repository: null, publisher: 'Local', source: 'local',
      url: null, description: 'A local dataset or synthetic fixture. This is not a Hugging Face source repository.', license: null,
      revision: null, configs: [], splits: [], rawAvailable: false, selections: []});
    const {path: _path, ...publicSelection} = selection;
    cards.get(id)!.selections.push(publicSelection);
  }
  return [...cards.values()];
}
