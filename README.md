# TaskLattice Veritas

A desktop workbench and CLI for testing HTTP guardrail services. Choose one or more Datasets, select a Target, start Testing, and inspect a Report with expected versus observed actions, request evidence, accuracy, precision, recall, F1, and latency.

Veritas uses the **promptfoo SDK** as its execution and assertion engine. The React UI, Fastify API, and CLI share one TypeScript backend. Supported Target protocols are **F5 Scan** and **LiteLLM generic guardrail**.

```text
Datasets + Target + execution settings
                  |
          UI / API / CLI
                  |
       shared TypeScript core
                  |
       promptfoo.evaluate()
                  |
       F5 Scan / LiteLLM HTTP
                  |
     saved requests and responses
                  |
       Report / offline re-score
```

## Quick start

With Docker and Docker Compose installed:

```sh
git clone https://github.com/tasklattice/tasklattice-veritas.git
cd tasklattice-veritas
docker compose up --build -d
```

Open [localhost:38100](http://localhost:38100). This builds one image containing
the desktop UI, API, CLI and public fixtures. Compose keeps data, Targets, Reports
and caches in a named volume. No host Node.js installation is needed.

Run an optional smoke test against a temporary local mock:

```sh
docker compose exec veritas npm run veritas -- demo
```

The demo needs no Guard credential, downloaded Dataset, or external model. It
runs 12 checks per protocol and verifies offline re-scoring without additional
Target calls. Refresh Reports to inspect the results. Its temporary mock stops
when the demo finishes; configure a real Target before starting another test.

```sh
docker compose logs -f veritas
docker compose down            # Stops the app; retains the volume.
# docker compose down -v       # Also permanently deletes local app data.
```

### Kubernetes with Helm

Build the image and make it available to your cluster nodes, then install:

```sh
docker build -t tasklattice-veritas:0.3.0 .
# For kind: kind load docker-image tasklattice-veritas:0.3.0
helm upgrade --install veritas ./charts/tasklattice-veritas \
  --namespace veritas --create-namespace --wait --timeout 5m
kubectl -n veritas port-forward service/veritas-tasklattice-veritas 38100:80
```

For a remote cluster, push the image to your own registry and set
`image.repository` and `image.tag` on the Helm command. No pre-published image
is assumed. The chart creates one Deployment, a ClusterIP Service and a 20 GiB
PVC using the cluster's default StorageClass. A default StorageClass or an
existing writable claim is required. The PVC is retained on uninstall.

See [Deployment](docs/deployment.md) for registry commands, existing storage,
credential Secrets, Dataset preparation, backups and Helm settings.

### Run from source

Requires Node.js **22.22 or later** and npm:

```sh
npm ci

# Exercise both protocols using bundled synthetic cases and a temporary local mock.
npm run veritas -- demo

# Open the desktop app and inspect the generated Reports.
npm run dev
```

Open [localhost:38100](http://localhost:38100).
On Linux ARM64, installing the native compression dependency may also require
Python 3, `make` and a C++ compiler. The Docker build provides this toolchain.

For a local production build:

```sh
npm run build
npm start
```

Source runs bind to `127.0.0.1`; the container binds to `0.0.0.0` internally.
Compose publishes only on host loopback, and Helm uses a local port-forward.
Veritas assumes a trusted operator and has no built-in user authentication.

## Use the desktop app

1. **Targets** — create a named connection with its runtime URL, Adapter, output mode, timeout, and credential environment-variable name. For TaskLattice Guard, a Target points to an already published Guard Endpoint.
2. **Datasets** — one card per original source repository. Browse the pinned upstream README, metadata, subsets, splits, labels, and paginated original records. Download the source archive before using its viewer or starting a test.
3. **Start testing** — follow **Target → Datasets → Execution → Review**. Select multiple sources, configure each source's scope/direction, and set a shared case limit, concurrency, repeats, and scoring rules.
4. **Report** — opens immediately after submission, before source conversion. Follow preparation, execution, and scoring/report generation. Inspect active cases, direction, repeats, elapsed time, recent completions, and cancellation. Finished Reports separate Overview, Results, Evidence and Metadata. Overview shows overall Accuracy, Precision, Recall and F1, followed by Dataset outcome charts and a per-Dataset metrics table; scoring selection sits next to the Results table. Model verdicts, PII redaction and execution history live in Evidence. CSV/JSON/Markdown exports retain all saved checks.
5. **Re-score** — change rules inside a finished Report and apply them to the same saved evidence. Switch between Original and later scoring versions without sending requests again.
6. **Compare** — select 2–4 saved Reports and choose a baseline and scoring versions. Use the comparison workspace for Target history or cross-Target analysis, then open **Inspect case changes** in that workspace for paired evidence. The Report header’s **Compare reports** action opens the same workspace. Inspect new failures, fixed cases, remaining failures, repeated-check instability, and cases that cannot be compared. Open either side's saved request evidence without sending traffic.

Limited tests support source order, random sampling, or sampling stratified by expected action (`allow` / `block` / `transform`). Random and stratified samples use an explicit integer seed and read the complete selected source scope before selecting cases. Each Dataset receives its own case limit. Frozen case IDs, source provenance, seed, and sampling algorithm make the selection reproducible. A seed fixes case selection, not Guard model responses. Target and Report deletion is permanent; there is no restore workflow.

For example, select **WildJailbreak**, a configured Target, **Limit cases per Dataset: 20**, **Stratified by expected action**, **Seed: 42**, **Concurrency: 2**, and **Repeats: 2**. Start testing to open the Report while preparation runs. Repeat with the same source scope and seed after changing the Guard configuration, then select 2–4 Reports in the **Report** table (filter by Target and Dataset) and choose **Compare reports**. Use **Target history** for runs on one Target or **Across Targets** for different Guard configurations. The first selected Report is the baseline; it can be changed in the comparison workspace. Dataset heatmaps and quality/latency charts show the saved values, while **Inspect case changes** opens aligned failures and fixes. Matching source, conversion, scoring and execution versions are required to classify changes fairly.

## Test a real Target

Configure and publish the Guard Endpoint first. Veritas does not manage the Guard's policies, routes, or deployment. Follow the [Endpoint setup guide](docs/endpoint-setup.md) for a deterministic input/output smoke configuration.

Copy a template into the ignored local configuration directory:

```sh
mkdir -p data/targets
cp examples/f5.target.json data/targets/my-f5.json
# Alternatively: cp examples/tali.target.json data/targets/my-litellm.json
```

Edit the copied file with the runtime URL and credential variable for your deployment. Example F5 configuration:

```json
{
  "adapter": "f5-scan",
  "url": "https://guard.example.test/runtime/v1/endpoints/REPLACE_ENDPOINT_ID/backend/v1/scans",
  "apiKeyEnv": "VERITAS_F5_API_KEY",
  "outputMode": "standalone",
  "flagOnly": false,
  "verbose": true,
  "timeoutMs": 30000
}
```

The example domain is a placeholder. Export `VERITAS_F5_API_KEY` securely in the process environment before starting Veritas. Do not put the credential in JSON, source files, or a committed shell command. `.env` files are ignored but are **not loaded automatically**; use your shell, a secret manager, or Node's explicit `--env-file` option.

| Adapter | Runtime path | Authentication | Output checks |
|---|---|---|---|
| `f5-scan` | `/runtime/v1/endpoints/{id}/backend/v1/scans` | Bearer token | Independent saved-response scan |
| `litellm-generic-guardrail` | `/runtime/v1/endpoints/{id}/beta/litellm_basic_guardrail_api` | `x-api-key` | Paired or standalone |

A Guard console URL such as `/integration/endpoints?endpointId=...` is a management page, not a runtime URL. Copy the callback URL advertised by your deployment.

Import the six bundled synthetic smoke cases, then run them against the configured Target:

```sh
npm run veritas -- datasets import veritas \
  --file examples/endpoint-smoke.jsonl --limit 0 \
  --out data/smoke-v1

npm run veritas -- run \
  --data data/smoke-v1 --target data/targets/my-f5.json \
  --out runs/smoke-f5-001 --concurrency 2 --repeat 1

npm run veritas -- report --run runs/smoke-f5-001
```

With the smoke rules in the setup guide, this expects six completed checks: input and output allow, block, and transform. The mock demo is the quickest way to verify the toolchain without configuring a real service.

### Input and simulated-response checks

Veritas sends one case at a time. Output checks use a fixed saved response from a Dataset or fixture; they do not generate a business-model answer.

- **F5:** submits the saved text as `input` with `scanDirection: request` or `response`. Prompt/history are not correlated. `flagOnly: false` is explicit; `cleared`, `blocked`, and `redacted` map to `allow`, `block`, and `transform`. Ambiguous `flagged` is an execution error.
- **LiteLLM paired output:** checks the original prompt first, then submits the saved response with the same `litellm_call_id`. A blocked input skips the response check; a failed preparation is an execution error.
- **LiteLLM standalone output:** submits only the saved-response check and omits the correlation ID. Use this mode when an original prompt is unavailable and the Endpoint supports independent output checks.

Concurrency controls overlapping checks; paired HTTP calls stay sequential within one check. Repeats measure action variation. Requests are uncached, do not redirect, and have no automatic retries. Guard-side detection models can still incur cost.

## Prepare Datasets

### Construct and freeze AdvBench attack attempts

Use the installed promptfoo SDK's public `redteam.Strategies` API to construct attacks locally from the pinned AdvBench archive. The default constructs six distinct upstream families: educational pretext, DAN mode, Developer mode, AIM/Machiavelli, fictional guide, and opposite persona. The full upstream template pool is extracted in an isolated offline process and canonicalized by hash; representatives are selected by semantic family and content hash, never by detector results. No generation model, cloud service, or Target is called during construction.

Download/verify the HarmBench archive (which contains AdvBench) and JBB-Behaviors first, then freeze one version:

```sh
npm run veritas -- datasets download --dataset harmbench
npm run veritas -- datasets download --dataset jailbreakbench
npm run veritas -- datasets attack-templates
npm run veritas -- datasets attacks advbench \
  --goal-limit 20 --control-limit 60 --seed 42 \
  --out data/imports/advbench-attacks-v2

npm run veritas -- run \
  --data data/imports/advbench-attacks-v2 \
  --target data/targets/my-litellm.json \
  --purpose jailbreak-detection --repeat 3 --concurrency 2 \
  --out runs/advbench-attacks-model-a
```

This freezes 20 source goals × 6 template families = 120 attack attempts, plus 60 unchanged JBB benign controls: 180 cases and 540 checks with three repeats. `--goal-limit` and `--control-limit` must be positive and cannot exceed their source populations. `--templates` accepts comma-separated IDs from `datasets attack-templates`. The default strategy is plain `jailbreak-templates`; optionally use `--strategies jailbreak-templates,base64+jailbreak-templates,rot13+jailbreak-templates` to cross every selected template with encoding variants. Existing output versions cannot be overwritten; modified case files fail checksum verification before any traffic.

The package preserves source revisions and hashes, selected goal/control IDs, original goals, each strategy step's input/output hash, promptfoo/generator versions, and final prompts. Seed 42 fixes selection; it does not make model responses deterministic. Templates without an upstream Goal placeholder retain their body and append the Goal; that placement, template body/hash and full catalog fingerprint are frozen in the manifest. Reports include `attackTypes` and per-strategy metrics with shared benign controls, and CSV columns `attack_type`, `template_id`, `template_sha256`, `attack_strategy` and `source_goal_id`. Per-type F1 depends on the shared control/attack ratio; do not average it to obtain overall F1. Older v1 packages retain their original one-template behavior and remain runnable.

Configure the real Guard's input Jailbreak model before each run, reuse exactly the same frozen package, and verify Guard routing/model telemetry. For comparison, run model B with `--baseline runs/advbench-attacks-model-a`; restore the original model binding afterward. Veritas does not select a Guard model merely by changing the Target name.

These are constructed bypass attempts, not attacks proven successful against a victim LLM, and this is not the original AdvBench ASR protocol. Variants of one goal and repeated checks are correlated. Fixed public templates may occur in training data. JEV uncertain/fail-closed blocks remain separate from explicit model matches in the Report.

### Choose the right inputs for jailbreak checks

In **Start testing → Datasets**, choose **Test focus: Jailbreak checks**. Select **JailbreakBench Attacks** (`JailbreakBench/artifacts`) and add **JBB-Behaviors → Source settings → behaviors / benign** for allow controls. The official attack archive contains 18 method/model scopes: 1,637 submitted prompts from 1,800 rows, with 163 empty prompts excluded at the pinned revision. For a small repeatable check, choose `PAIR/black_box/vicuna-13b-v1.5`, set a limit of 12 per Dataset, stratified sampling with seed 42, repeat 3, concurrency 2. This selects up to 24 cases and sends up to 72 input checks.

The adapter sends only `prompt`, never `goal` or the attacked model's `response`. The upstream `jailbroken` flag records success against the original LLM, not detector ground truth; unsuccessful submitted attempts remain in the test with expected `block`. The raw archive, upstream README, revision and file checksums remain available in the Dataset viewer and Report provenance.

Configure the Guard Target's input jailbreak policy and model binding before running. Test focus validates the inputs; it does not enable policies or change routing. Use execution traces to confirm which model actually ran. A standalone detector comparison needs a Target that isolates that detector; other Guard policies and fail-closed decisions can affect Endpoint actions.

JBB-Behaviors `Goal`, HarmBench and AdvBench `Behavior` are behavior goals. They remain supported with **Endpoint decisions** for content-safety testing; they are rejected for **Jailbreak checks**. WildJailbreak's adversarial harmful prompts and benign controls are also supported. Unrecognized local collections require supported source provenance for jailbreak focus. CLI and API enforce the same case checks before sending requests.

```sh
npm run veritas -- datasets download --dataset jailbreakbench-attacks
npm run veritas -- datasets import jailbreakbench-attacks --fetch \
  --config PAIR/black_box/vicuna-13b-v1.5 --split attacks --limit 0 \
  --out data/jbb-pair-v1
npm run veritas -- run --purpose jailbreak-detection \
  --data data/jbb-pair-v1 --target data/targets/my-f5.json \
  --sampling random --seed 42 --limit 12 --repeat 3 --concurrency 2 \
  --out runs/jbb-pair-001
```

The CLI example is attack-only: use the UI/API with both sources to measure false positives. Report metrics still describe **Endpoint policy actions**, not native detector classification accuracy or LLM attack success rate. Historical Reports gain a scope explanation on read; their saved evidence, grades and artifact files are unchanged. API detail and JSON downloads include the derived scope explanation. Wrong-input tests require a fresh run with attack prompts, not offline re-scoring.


The catalog supports 17 sources: Aegis/Nemotron Content Safety V2, ToxicChat, OpenAI Moderation, BeaverTails, Do-Not-Answer, HarmBench, JBB-Behaviors, JailbreakBench Attacks, WildJailbreak, deepset prompt-injections, Gandalf, XSTest, OR-Bench, CredData, PII Masking 300K, CantTalkAboutThis, and Safety-Prompts. CredData requires local reconstruction before use; see [CredData setup](docs/creddata.md).

```sh
npm run veritas -- datasets list

# Download and verify pinned raw snapshots. This can require substantial disk space.
npm run veritas -- datasets download

# Verify the local archive without network access.
npm run veritas -- datasets download --verify-only

# Preview optional CLI preparation; UI Testing performs conversion automatically.
npm run veritas -- datasets prepare --out data/prepared-v1 --plan
```

WildJailbreak requires approved Hugging Face access. The downloader accepts `HF_TOKEN` or an existing local Hugging Face login; credentials are never part of the catalog. Raw archives stay in `data/raw/<source>/<revision>/` with manifests and checksums. They are not included in this repository.

Use [Dataset recipes](docs/datasets.md) for complete conversion, explicit splits/categories, and reviewed-label overrides. Aegis uses the test split by default. Topic-control, Safety-Prompts, and some HarmBench cases need policy-specific reviewed expectations. Missing expectations are not guessed. Every source keeps its own upstream license and access terms.

## Understand Reports

| Metric | Definition |
|---|---|
| Accuracy | Fraction of scored completed checks passing the selected scoring rules |
| Precision | `TP / (TP + FP)` |
| Recall | `TP / (TP + FN)` |
| F1 score | `2TP / (2TP + FP + FN)` |
| Coverage | Completed checks / planned checks; execution errors, skips, and missing checks reduce coverage |
| Latency | Caller-observed p50/p95/p99 for the tested phase of completed checks |
| Instability | Action variation among cases with at least two completed repeats |

Precision, recall, and F1 treat **block or transform as a positive intervention**. They use labelled completed checks and are independent of extra scorer assertions; block-versus-transform acceptance can still change the selected scorer's Accuracy. Overview exposes overall and per-Dataset detection rates; its expandable metric definitions retain the underlying TP/FP/FN/TN counts. Undefined denominators show N/A or `—`. These are action-level detection metrics, not entity-level PII metrics or model jailbreak success rates.

Errors, skipped checks, and missing evidence remain separate from content mismatches. Read accuracy together with coverage. All repeats contribute to attempt-level metrics. A source-order sample is not a representative benchmark estimate.

**Guard-side model cost is not connected: it is unavailable (`null`), not zero.** Saved responses avoid business-model generation; they do not eliminate Guard-side model calls.

Reports save frozen configuration, cases, provider/scorer provenance, native promptfoo results, per-attempt evidence and grades, summary JSON/Markdown, and per-check CSV. CSV downloads include all recorded checks regardless of UI filters. The activity file keeps active checks and the latest 20 completions; the Checks tab retains the complete evidence.

## Change scoring without new traffic

```sh
npm run veritas -- rescore \
  --run runs/smoke-f5-001 --scorer examples/scorer-protection.json
```

The replay uses promptfoo assertions against recorded attempts. It needs neither a reachable Target nor its credential. A successful re-score publishes a new version under the same Report; original evidence, latency, HTTP counts, and execution status stay intact. Invalid or interrupted re-scoring does not replace the selected version.

See [Scoring and offline re-scoring](docs/scoring.md) for accepted-action matrices, native text assertions, version selection, and local quality thresholds. `compare` supports compatible saved baselines. CLI exit codes are **0** for pass, **1** for quality-threshold failure, and **2** for configuration/execution failure.

## Development and local validation

```sh
npm run typecheck
npm test
npm run test:integration
npm run build

# Deployment manifests (requires Helm; no cluster access).
helm lint --strict charts/tasklattice-veritas
helm template veritas charts/tasklattice-veritas --kube-version 1.31.0

# Inspect every file in the Git index before publishing.
npm run check:publication
```

[GitHub Actions](https://github.com/tasklattice/tasklattice-veritas/actions/workflows/verify.yml) runs source tests, synthetic F5/LiteLLM integration, offline re-scoring, the frontend build, Helm/Compose checks, and native amd64/arm64 container smoke checks on hosted runners. Pushes and pull requests to `main` trigger verification; manual runs are also available. No deployment, image publication, real Guard credentials or model calls are involved. Archive-dependent tests explicitly skip when pinned files are absent. See [Validation](docs/validation.md).

| Directory | Purpose |
|---|---|
| `src/core/` | Dataset conversion, promptfoo execution, protocols, scoring, metrics, and artifacts |
| `src/server/` | Local API, serialized Run queue, resource lifecycle, source viewer |
| `src/shared/` | Shared types and data-only scoring configuration |
| `web/` | React desktop UI, TanStack Query, shadcn/Radix components |
| `catalog/` | Source metadata and pinned public upstream file locks |
| `examples/` | Placeholder Target templates, synthetic cases, scoring rules |
| `test/`, `scripts/` | Local verification and demos |
| `Dockerfile`, `compose.yaml` | Production image and one-command local startup |
| `charts/tasklattice-veritas/` | Single-process Kubernetes deployment and storage |

## Local data and publication boundaries

Credentials, raw/imported Datasets, Target records, Reports, caches, build output, and historical desktop captures are ignored by Git. Example addresses use loopback or reserved domains; all Endpoint IDs are placeholders. Before sharing an export, inspect its sample text and response evidence: credential scrubbing does not make business data anonymous.

The app has no multi-user authorization, enterprise audit trail, destination allowlist, or encrypted secret vault. Use the loopback/tunnel defaults, or put an authenticated trusted proxy in front before adding a remote hostname. Open-loop load testing, streaming/multimodal checks, remote LLM judges, and automatic Guard-side cost retrieval are outside this version.

Documentation: [Deployment](docs/deployment.md) · [Architecture](docs/architecture.md) · [HTTP API](docs/api.md) · [Endpoint setup](docs/endpoint-setup.md) · [Datasets](docs/datasets.md) · [Scoring](docs/scoring.md) · [Upstream cards](docs/upstream-dataset-cards.md).

### Credential detection dataset

[CredData setup and usage](docs/creddata.md) covers the pinned Samsung archive, upstream obfuscation, PII credential scope, Dataset browsing, and input/standalone output testing.

### PII intervention and redaction

Reports separate final-action intervention recall (Block or Transform on completed
PII-positive checks) from complete annotated redaction. The latter requires a
nonempty Transform response and removal of every annotated source span; blocked
requests, partial masking and unverified replacement formats are separate outcomes.
A block from another protection does not prove that a PII detector ran. Control
interventions, errors, skips and missing checks remain visible. Click an outcome
to inspect its requests; JSON, Markdown and CSV exports include the same metrics.

`annotated-pii-v3` verifies supported redaction placeholders against the frozen
source and respects annotation token boundaries. It prevents a partially masked
phone number from passing merely because its original full string disappeared.
Repeated HTML tags and list separators are aligned against the entire frozen
source. Only spans removed under every valid alignment count as verified;
ambiguous partial masking cannot pass. Excessively complex alignments and
unknown rewrite formats remain unverified. This checks annotated values, not
unannotated PII, semantic utility or worldwide entity coverage. Annotation values
without exact offsets are checked conservatively at matching token boundaries.
Historical grades are preserved. Use offline re-scoring with the same rules on
both Reports when comparing across scorer versions; promptfoo replays saved
evidence without additional Target traffic.
