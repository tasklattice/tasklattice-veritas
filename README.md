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

Requires Node.js **22.22 or later** and npm.

```sh
git clone https://github.com/tasklattice/tasklattice-veritas.git
cd tasklattice-veritas
npm ci

# Exercise both protocols using bundled synthetic cases and a temporary local mock.
npm run veritas -- demo

# Open the desktop app and inspect the generated Reports.
npm run dev
```

Open [localhost:38100](http://localhost:38100). The demo needs no Guard credential, downloaded Dataset, or external model. It runs 12 checks per protocol and verifies offline re-scoring without additional Target calls. Its temporary mock stops when the demo finishes; it does not leave a live Target behind.

For a local production build:

```sh
npm run build
npm start
```

The server binds to `127.0.0.1`. This version assumes a trusted local operator and is not a remotely exposed multi-user service.

## Use the desktop app

1. **Datasets** — one card per original source repository. Browse the pinned upstream README, metadata, subsets, splits, labels, and paginated original records. Download the source archive before using its viewer or starting a test.
2. **Targets** — create a named connection with its runtime URL, Adapter, output mode, timeout, and credential environment-variable name. For TaskLattice Guard, a Target points to an already published Guard Endpoint.
3. **Start testing** — follow **Datasets → Target → Execution → Review**. Select multiple sources, configure each source's scope/direction, and set a shared case limit, concurrency, repeats, and scoring rules.
4. **Report** — opens after preparation and queuing. During execution, inspect active cases, Dataset, input/output stage, repeat number, elapsed time, recent completions, and cancellation. Finished Reports include overall and per-Dataset metrics, unexpected decisions, complete request/response evidence, and CSV/JSON/Markdown exports.
5. **Re-score** — change rules inside a finished Report and apply them to the same saved evidence. Switch between Original and later scoring versions without sending requests again.

Source conversion finishes before the API returns a Run ID. Large archives can take time to prepare. Limited tests use the first converted cases in source order, not random sampling. Target and Report deletion is permanent; there is no restore workflow.

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

The catalog supports 15 original sources: Aegis/Nemotron Content Safety V2, ToxicChat, OpenAI Moderation, BeaverTails, Do-Not-Answer, HarmBench, JailbreakBench, WildJailbreak, deepset prompt-injections, Gandalf, XSTest, OR-Bench, PII Masking 300K, CantTalkAboutThis, and Safety-Prompts.

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

Precision, recall, and F1 treat **block or transform as a positive intervention**. They use labelled completed checks and are independent of extra scorer assertions; block-versus-transform acceptance can still change the selected scorer's Accuracy. The Report exposes the confusion matrix and binary detection accuracy. Undefined denominators show N/A or `—`. These are action-level detection metrics, not entity-level PII metrics or model jailbreak success rates.

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

# Inspect every file in the Git index before publishing.
npm run check:publication
```

Tests use synthetic local services. Archive-dependent tests explicitly skip when their pinned source files are absent. See [Local validation](docs/validation.md). No hosted automation or CI workflow is configured.

| Directory | Purpose |
|---|---|
| `src/core/` | Dataset conversion, promptfoo execution, protocols, scoring, metrics, and artifacts |
| `src/server/` | Local API, serialized Run queue, resource lifecycle, source viewer |
| `src/shared/` | Shared types and data-only scoring configuration |
| `web/` | React desktop UI, TanStack Query, shadcn/Radix components |
| `catalog/` | Source metadata and pinned public upstream file locks |
| `examples/` | Placeholder Target templates, synthetic cases, scoring rules |
| `test/`, `scripts/` | Local verification and demos |

## Local data and publication boundaries

Credentials, raw/imported Datasets, Target records, Reports, caches, build output, and historical desktop captures are ignored by Git. Example addresses use loopback or reserved domains; all Endpoint IDs are placeholders. Before sharing an export, inspect its sample text and response evidence: credential scrubbing does not make business data anonymous.

The app has no multi-user authorization, enterprise audit trail, destination allowlist, or encrypted secret vault. Keep it local. Open-loop load testing, streaming/multimodal checks, remote LLM judges, and automatic Guard-side cost retrieval are outside this version.

Documentation: [Architecture](docs/architecture.md) · [HTTP API](docs/api.md) · [Endpoint setup](docs/endpoint-setup.md) · [Datasets](docs/datasets.md) · [Scoring](docs/scoring.md) · [Upstream cards](docs/upstream-dataset-cards.md).
