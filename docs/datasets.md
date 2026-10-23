# Dataset sources, conversion, and expected actions

`catalog/datasets.json` defines supported text conversions and their default testing selection. `catalog/raw-datasets.lock.json` defines the larger raw archive. Source revisions are immutable; downloads do not silently follow `main`.

An upstream safety label and a customer's expected Endpoint action are different concepts. Review policy-derived expectations against the actual Guard configuration before treating the result as an accuracy measurement.

The Dataset registry has one card per source repository. Cards identify the publisher, original URL, license, testing configurations/splits and pinned source revision. Starting a test performs local conversion automatically; local copies and synthetic fixtures are not separate source cards or a required UI selection. CLI preparation packages remain implementation artifacts for advanced workflows.

## Coverage and default testing files

Paths in the second column are relative to `data/raw/<id>/<revision>/`.

| Source ID | Selected raw file(s) | Direction | Expected action and limitations |
|---|---|---|---|
| `aegis` | `test.json` | Input; `--phase both` also imports responses | Independent `prompt_label` and `response_label`; preserves human/model label provenance. Empty and REDACTED content is skipped. |
| `toxicchat` | `data/0124/toxic-chat_annotation_test.csv` | Input | `toxicity` labels `user_input`. CC-BY-NC-4.0. |
| `moderation` | `data/samples-1680.jsonl.gz` | Input | Any positive moderation label expects block; allow requires all relevant labels to be explicitly negative. Missing labels remain unknown. |
| `beavertails` | `round0/30k/test.jsonl.gz` | Output | `is_safe` labels the response, not its prompt. The original prompt is retained for LiteLLM paired mode. CC-BY-NC-4.0. |
| `do-not-answer` | `data_en.csv` | Input | Questions use a strict-refusal policy expecting block; this is a policy mapping, not a response label. |
| `harmbench` | `data/behavior_datasets/harmbench_behaviors_text_test.csv` | Input | Standard behaviors use strict-refusal policy. Other functional categories need review. Context is retained as metadata; direct text scanning is not the full official HarmBench testing. |
| `jailbreakbench` | `data/harmful-behaviors.csv`, `data/benign-behaviors.csv` | Input | `Goal` is the input; harmful expects block, benign expects allow. `Target` is an attack target prefix, not a saved model response. |
| `jailbreakbench-attacks` | `attack-artifacts/**` (18 method/model scopes) | Input | Nonempty submitted `prompt` expects block. Never substitute the goal or model response; original attack success is not a detector label. |
| `wildjailbreak` | `eval/eval.tsv` | Input | `label=0/1` maps to allow/block and is checked against `data_type`. Label conflicts fail conversion; missing labels remain unknown. |
| `deepset` | `data/test-00000-of-00001-701d16158af87368.parquet` | Input | `label=1` marks injection. Tests text detection, not an indirect-injection execution chain. |
| `gandalf` | `data/test-00000-of-00001-bc92128b9288a6d1.parquet` | Input | Known adversarial corpus expects block by policy. `similarity` is not a safety label. There is no benign denominator. |
| `xstest` | `xstest_prompts.csv` | Input | Uses the safe/unsafe label; sensitive vocabulary alone does not imply block. |
| `or-bench` | `or-bench-hard-1k.csv`, `or-bench-toxic.csv` | Input | Hard examples expect allow; toxic examples expect block. `or-bench-80k.csv` is available through an explicit config or local import. |
| `creddata` | `records/reviewed.jsonl` (locally reconstructed) | Input; optional standalone output | Passwords, API keys, tokens and private keys: eligible T → block, F → allow. Overlapping annotations are merged; unknown/out-of-scope labels are separate. [Reconstruction and usage](creddata.md). |
| `pii` | `data/validation/1english_openpii_8k.jsonl` | Input; output can use standalone mode | `privacy_mask` annotated values require transform and removal. Empty annotations expect allow. Custom license terms apply. |
| `topic-control` | `canttalkaboutthis_topic_control_human_test_set.jsonl` | Input | Requires `--domain banking`; imports conversation user turns and distractors. Expected actions require target-policy review. Reference system instructions do not configure the Guard. |
| `safety-prompts` | `typical_safety_scenarios.json` | Input; optional `--phase both` | Requires a JSON category through `--field`. The preparation example enumerates all seven categories. A category is not an allow/block label; cases need review. |

Some curated benchmarks are named `train` by the upstream loader. Manifests preserve the actual config/split. For datasets with held-out files, the default selection uses test or validation. Aegis test selection does not prove it was unseen by every possible target model; record the tested model's training provenance separately.

## Prepare selected records from the catalog

```sh
npm run veritas -- datasets prepare \
  --out data/evaluation-packages-v1 --plan

npm run veritas -- datasets prepare \
  --out data/evaluation-packages-v1
```

The preparation command uses the shared TypeScript importer with `--limit 0`, consumes only local raw files, and records a preparation plan with the pinned archive file paths. The current catalog produces 42 packages across 17 sources, including separate JailbreakBench attack scopes, JBB-Behaviors and OR-Bench splits, and Safety-Prompts categories. Reconstruct CredData first if preparing the complete catalog. Aegis uses `--phase both`; BeaverTails uses output; other sources use their catalog default direction. No Endpoint is called during preparation.

Use `--dataset wildjailbreak` to select one source ID; repeat the command with a new output root for another selection. `--limit 2` can verify conversion with two cases per package; omitting it imports the full selected contents. Choose a new output root for every version. The raw archive is broader than these testing selections: it also contains training data, additional variants, images, hashes, licenses, and documentation. Auxiliary binary files are not submitted as text requests.

Each imported package contains:

- `cases.jsonl`: one evaluable text/phase per line, with a stable case ID.
- `manifest.json`: source checksum, config/split, conversion version/hash, counts, and sampling information.
- `review-template.json`: only cases that lack an expected action.

An imported version is immutable. The runner verifies its `cases.jsonl` checksum. Local imports record upstream revision as null because the importer itself checks file content, not remote Git history; the preparation plan additionally records which pinned raw archive supplied each file. TypeScript conversion creates a new adapter version; case IDs can differ from historical converters.

## Concrete input and output imports

Import the full WildJailbreak testing file:

```sh
npm run veritas -- datasets import wildjailbreak \
  --file data/raw/wildjailbreak/5ddc12a7894f842b0619b8e1c7ee496b198af009/eval/eval.tsv \
  --config eval --split train --phase input --limit 0 \
  --out data/wildjailbreak-eval-v1
```

The file contains 2,210 rows: 2,000 `adversarial_harmful` / label 1 and 210 `adversarial_benign` / label 0. It has no saved responses. `eval` is the upstream config; its loader split is called `train`. Inspect false-positive and false-negative rates separately because the classes are imbalanced.

Import all available prompt and response texts from Aegis test:

```sh
npm run veritas -- datasets import aegis \
  --file data/raw/aegis/d86bb8bedff51d25ac834ab7838f1cc61acb7a2c/test.json \
  --config default --split test --phase both --limit 0 \
  --out data/aegis-test-v1

npm run veritas -- run --data data/aegis-test-v1 \
  --endpoint data/targets/f5.json --phase output \
  --out runs/aegis-output-f5-001 --concurrency 2

npm run veritas -- run --data data/aegis-test-v1 \
  --endpoint data/targets/litellm.json --phase output \
  --out runs/aegis-output-litellm-001 --concurrency 2
```

The import count can differ from source rows: a row can produce input and output cases, while missing/redacted text is skipped. The manifest records the actual result. F5 sends each saved response directly; LiteLLM paired mode checks its original prompt first and skips output if that input is blocked.

## Import additional archived variants explicitly

The importer accepts a different local file through `--file` without fetching anything. Explicit config/split values distinguish the resulting cases.

```sh
# OR-Bench 80k: all rows, rather than the default hard/toxic selection.
npm run veritas -- datasets import or-bench \
  --file data/raw/or-bench/e36d8b80e81837c8a8f264bbb2a49f1b32c7e272/or-bench-80k.csv \
  --config or-bench-80k --split train --limit 0 --out data/or-bench-80k-v1

# A category from the Chinese instruction-attack file; expectations need review.
npm run veritas -- datasets import safety-prompts \
  --file data/raw/safety-prompts/559ab9f24ce4621e3f839ef05e1075b6c4f125ee/instruction_attack_scenarios.json \
  --config instruction_attack --split train --field Goal_Hijacking \
  --phase both --limit 0 --out data/safety-goal-hijacking-v1

# German PII validation, submitted as independent output text.
npm run veritas -- datasets import pii \
  --file data/raw/pii/c8c77895a005822682b66ab547fc0422579bc1d3/data/validation/german_openpii_8k.jsonl \
  --config german --split validation --phase output --limit 0 \
  --out data/pii-german-output-v1
```

Other examples include BeaverTails `round0/330k/test.jsonl.xz`, ToxicChat `data/1123/...`, and other PII languages. Use separate output directories and truthful split/config names. Validate an unfamiliar schema before large imports. Do not silently mix archived training rows into a held-out testing or count duplicate all/train/test exports as independent samples.

The current HarmBench adapter handles text behavior rows. The archived multimodal images, classifier reference files, and copyright-hash pickle files require other testing logic; they are not converted into text cases. Topic-control's generated Mixtral file is archived, while the current catalog and preparation example deliberately select the human test file.

## Review missing expectations

```sh
npm run veritas -- datasets fetch topic-control \
  --domain banking --limit 20 --out data/topic-review
```

Fill every null in `data/topic-review/review-template.json` with an action matching the configured Endpoint: `allow`, `block`, or `transform`. Save the result as `data/topic-reviewed-labels.json`, then create a reviewed version:

```sh
npm run veritas -- datasets import veritas \
  --file data/topic-review/cases.jsonl \
  --labels data/topic-reviewed-labels.json --limit 0 \
  --out data/topic-reviewed-v1
```

The label file maps stable case IDs to reviewed actions. Changing source text, config, category, or phase can change IDs. Overrides that do not match selected cases are rejected. Package directories that already have complete expectations can be copied unchanged into a final replay collection; replace pending packages with their reviewed versions. Do not keep both an original and its reviewed copy in the same batch.

Runs reject missing expectations by default. `--skip-unlabeled` explicitly excludes them and records the exclusion count; it does not replay every case. For HarmBench contextual rows, supplying an action label alone does not add missing context to the request. Build suitable contextual cases before claiming that testing coverage.

## Raw archive and offline use

```sh
# Set HF_TOKEN securely, or reuse an existing local HF token file.
npm run veritas -- datasets download
```

The current lock covers 17 sources and 790 files (2,174,654,535 declared bytes), including CredData's locally reconstructed records. These are lock totals, not a claim that all files are already present. HF snapshots include every repository file at the pinned revision: all Aegis splits, ToxicChat versions, BeaverTails 30k/330k, WildJailbreak train/eval, OR-Bench subsets, PII languages, human/generated topic-control data, and both Safety-Prompts JSON files. GitHub archives include `data/**`, root README files, and licenses, including HarmBench auxiliary data and original JailbreakBench attack artifacts.

Check `data/raw/download-summary.json` for complete/missing datasets and each `_download-manifest.json` / `SHA256SUMS` for file integrity. The download step does not execute repository code or deserialize pickle files. Copy `data/raw/` and `catalog/raw-datasets.lock.json` to an isolated environment; no HF cache is required to retain the archive.

Local conversion supports JSON, JSONL, CSV, TSV, gzip/xz text, and Parquet using csv-parse, native Node compression, lzma-native, and hyparquet. Imported packages can be moved independently; runtime needs the npm dependencies and a supported Node runtime. No Python environment or HF client package is required. Dataset license files must accompany transfers where required. Catalog values such as `other` and `see-upstream-license` do not grant commercial redistribution rights.
