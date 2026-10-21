# Shared TypeScript application

Veritas uses one TypeScript testing core from its CLI and HTTP API. React shares the product types with the backend. The public promptfoo `evaluate()` SDK schedules tests, concurrency, repetition, assertions, progress and cancellation. No Python runtime or cross-language bridge is part of the application.

```text
web/ React desktop UI                  src/cli.ts
       |                                    |
       v                                    |
src/server/main.ts (Fastify, localhost)      |
       |                                    |
src/server/store.ts (single local queue)     |
       +--------------+---------------------+
                      |
             src/core/service.ts
                immutable snapshot
                      |
           promptfoo.evaluate(config, options)
                 |                 |
       core/provider.ts      core/scoring.ts
       LiteLLM / F5 HTTP     action / PII assertion
                 |                 |
           Tali Endpoint -> attempts.jsonl
                                   |
                            core/report.ts
                          JSON / CSV / Markdown
                          thresholds / baseline
```

## Objects and boundaries

| Object | Responsibility |
|---|---|
| Dataset | Source identity and card metadata, such as one Hugging Face repository |
| Testing | One or more Datasets, one Target and execution parameters; Starting a test converts source records and queues a Run |
| Target | Preconfigured runtime URL, protocol, context mode, timeout and credential environment reference |
| Report / Run artifacts | Frozen cases/configuration, repeated attempts, native SDK evidence, report, CSV and gate |
| Scorer version | Shared pure assertion used by the SDK and offline report; implementation hash is frozen |

There is no separate Suite and no need to duplicate Tali Guard's internal Profile, Router or Guardrail objects. Configure and publish those in Guard, then create a Veritas Target using the Endpoint runtime URL. Veritas manages that Target connection independently; it does not create a Guard Endpoint. The UI contains one card per original source. Starting a test invokes `src/server/prepare-evaluation.ts`, verifies the pinned local files without network access, converts each selected source scope and freezes a combined case snapshot, per-source provenance and the scoring implementation. Each source keeps its original Dataset ID, revision, license and file checksums. Source options are independent; a limited UI/API test caps each Dataset before repeats, so the first source cannot consume the entire limit. Every selected source must contribute evaluable cases before any testing traffic starts. Internal converted copies are not a separate user selection.

Preparation completes before the API returns HTTP 202; the UI shows a preparing state, then navigates to the queued Run. Preparation failures produce a form error before HTTP testing traffic. A process restart during preparation requires applying again; only queued/running execution jobs persist.

`src/core/datasets.ts` converts the 15 catalog sources using Node libraries. `src/core/raw.ts` downloads and verifies pinned files, reuses local HF credentials if available, and works with local archives offline. Raw text is untrusted data. It never becomes a system instruction or Guard policy.

## Reusable backend entry point

```ts
import { runEvaluation } from './src/core/service.js';

const result = await runEvaluation({
  data: 'data/endpoint-smoke-v1',
  target: 'data/targets/f5.json',
  out: 'runs/backend-example-001',
  concurrency: 2,
  repeat: 3,
  signal: new AbortController().signal,
  onProgress(completed, total) { console.log(completed, total); },
});
console.log(result.exitCode, result.report.summary);
```

The SDK receives the provider object and assertion functions directly. It is not spawned as a CLI. Each Run also records `promptfooconfig.json` with native file provider/assertion references, its native SDK summary and progress events. A replay needs the recorded source implementation and dependencies; it is not a self-contained executable archive.

The API queues one Run at a time so SDK process state is not shared by concurrent API tests. Within a Run, `--concurrency N` sets SDK `maxConcurrency`; `--repeat N` sets SDK repeat. LiteLLM paired calls are sequential inside one attempt. This is controlled concurrency, not open-loop load generation. CLI tests run in their own process. Job metadata uses atomic replacement so polling and concurrent local readers do not observe partially written JSON. API jobs persist metadata separately in `data/jobs/`; run artifacts remain in `runs/<name>/`. Restarted queued/running jobs are shown as interrupted rather than silently resumed.

## Protocol behavior

LiteLLM uses `x-api-key`, `texts`, `input_type`, optional conversation context and a shared `litellm_call_id` for paired output. Blocked input skips output; preparation errors remain execution errors. Standalone output deliberately omits the call ID.

F5 uses Bearer authorization and sends each case as `input` with `scanDirection=request|response`, explicit `flagOnly=false`, and `verbose`. It does not transmit or correlate prompt/history. Its response output is read from `result.response`, with Scan ID retained. Ambiguous `flagged` is unscorable. Neither protocol generates a business model response.

HTTP requests have a timeout and response-size bound, and do not retry or redirect. Credentials are supplied through environment references and scrubbed if echoed. Dataset/run directories are immutable; files are created with owner-only permissions. Local desktop OS account isolation is assumed.

## Compatibility and scope

New runs retain evidence schema 3 and use configurable scorer `guard-rules-v1`. promptfoo grades are saved per attempt and reports aggregate those saved results. Imported historical case files remain readable. Compatible legacy schema-3 grading retains its deterministic fallback; unknown historical scorers and schema-1/2 reports are preserved. An explicit offline re-score creates a separate version rather than overwriting a historical report. See [Scoring](scoring.md).

Baseline comparison requires identical selected cases, scorer/provider implementation, engine version, repeat, concurrency, protocol, output mode, evidence type and full coverage. Use it to compare Endpoint configurations within a protocol. Rates and caller latency are reported; Guard-side cost remains explicitly unavailable until a trace/cost integration is implemented.

The first UI/API is a trusted local workbench, not a hardened multi-user deployment. Enterprise authentication, audit, destination allowlists and secret storage must be designed before remotely exposing it.

Reference: [promptfoo Node SDK](https://www.promptfoo.dev/docs/usage/node-package/).

## Resource lifecycle and Dataset viewer

The desktop app separates Report list/detail, Target CRUD and source browsing. Reports use Overview/Checks/Configuration tabs; a check drawer fetches its saved source case only when opened. Targets support stable-ID rename/configuration updates and per-resource version checks. A queued Run uses an owner-only immutable Target file, so subsequent updates/deletion do not redirect traffic.

Target deletion physically removes the managed configuration and state directory; Report deletion removes its artifacts and job files. Neither has a restore API or UI. Active Runs and Reports used as active baselines cannot be deleted. Recreating a Target uses a fresh ID; a rename retains identity. Bundled example configurations are imported into the managed registry once, preserving older IDs; deleting a managed Target never deletes the documentation example. Published Guard services remain independent. Old tombstones are read only for compatibility so earlier deletions do not reappear; the upgrade does not bulk-purge historical user files.

`src/server/dataset-viewer.ts` reuses the core source loaders to build owner-only SQLite indexes under `.cache/dataset-viewer/`. Index jobs yield between batches, report row progress and limit concurrent builds. Queries apply literal search and an optional exact source-value filter before whole-scope sorting and stable offset pagination, returning at most 100 preview records and loading a complete record only on inspection. CSV/JSONL sources stream through the existing loader; JSON arrays and Parquet use its existing in-memory decode behavior during the initial index build. No entire corpus is sent to the browser.


## Frontend queries and components

`web/query.ts` owns a single TanStack Query 5 client and typed query options. `QueryClientProvider` wraps the desktop app. Resource lists use independent queries and retain their last successful data during background refreshes. Target detail queries and create/update/delete mutations invalidate or remove the appropriate cache entries. API errors carry status codes; 4xx queries are not retried, server/network failures retry once, and mutations never retry automatically.

Dataset metadata, paginated rows and complete row inspection have separate keys. Row keys include original Dataset ID and source revision, subset, split, category, search, sort/order, column/value, offset and limit. Only pagination within the same scope/search/sort/filter keeps a previous ready page as placeholder data; controls are disabled while updating it. Changing source scope/search cannot display a previous scope's results. Every Query fetch passes its AbortSignal to fetch. A ready source page stays fresh for sixty seconds; metadata and full rows use the same freshness interval. Indexing queries poll once per second until ready and stop polling on an error until retried. The Data viewer tab stays mounted so switching to Dataset card preserves its page and filters. The existing Report detail evidence polling remains a local effect; Report lists are Query-backed.

`components.json` configures local shadcn/ui Radix Nova components under `web/components/ui/`. They were added with the official CLI. Button, Input, Table, NativeSelect and Skeleton are reused by the shared control adapters in `web/ui.tsx` and the Dataset loading view. `web/shadcn.css` adds Tailwind 4 utility/theme layers without resetting the existing Relay base stylesheet. The control adapters preserve the established sizing, colors, focus behavior and native labels. No IBM UI components are used. The Target registry is presented as an HTML table with source-independent search and pagination.

References: [TanStack paginated queries](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries), [query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation), [shadcn/ui Vite setup](https://ui.shadcn.com/docs/installation/vite).


## Dataset discovery and data browsing

The Dataset operator's task is to locate a suitable original benchmark, inspect source annotations and then start Testing. `web/dataset-filters.ts` groups the fifteen sources by capability, source and archive availability. Facets use OR within a group and AND across groups, and counts exclude the current group's selection. Available locally describes the archive, not a guarantee that policy-dependent labels are ready to score. The catalog search matches source metadata, not harmful record text.

`web/dataset-browser.tsx` presents compact source repository cards beside a sticky, collapsible filter panel modeled on Guard's Policy Library. Details separate the local Dataset card/provenance from original data browsing. `web/dataset-viewer.tsx` uses Query-backed scope/search/sort/filter/pages and separately cached full rows for in-place expansion and an optional inspector. The view URL restores location without making a Run or changing recommended Testing settings. Aegis browsing adds explicit upstream train/validation groups; training data remains unavailable as an implicit Testing default.

`web/dataset.css` scopes the reference typography and dense grid to Dataset surfaces. Source Sans Pro and IBM Plex Mono are installed locally through Fontsource and work without remote font requests. The surrounding Veritas shell keeps Relay semantic colors, themes and shared shadcn/ui primitives. IBM Plex Mono is a font; no Carbon UI dependency is introduced. Distribution data is computed while indexing original records and cached in the index metadata; charts are not decorative samples. The index identity is versioned to avoid reusing pre-statistics indexes.

Reference: [the inspected Hugging Face viewer](https://huggingface.co/datasets/nvidia/Aegis-AI-Content-Safety-Dataset-2.0/viewer/default/train?p=2&row=248). This implementation reproduces the Dataset browsing interaction and typography within Veritas. Hugging Face social features, community queries and the SQL console are not implemented. The Dataset card now renders the pinned upstream README, with Veritas-specific usage and provenance in a separate section. It is not a pixel-identical clone of the complete Hugging Face website.


## Preserved upstream Dataset documentation

`src/server/upstream-card.ts` reads the lock-listed README from the source's immutable raw archive and validates its expected size and content hash. The JSON API provides the unchanged source, Markdown body, parsed YAML, heading index and provenance. A raw attachment route returns the original UTF-8 file; a separate asset route serves only verified raster images from the same pinned archive. No request fetches upstream HEAD or arbitrary network/filesystem paths.

`src/shared/card-markdown.ts` supplies shared heading IDs and pinned link resolution. `web/upstream-card.tsx` reuses react-markdown and remark-gfm, keeps the raw document accessible, and separates publisher content from Veritas-specific notes. Markdown HTML is not executed. Archived Markdown images use local verified files; unarchived images are explicit external links. The renderer is lazy-loaded and its TanStack Query key includes Dataset ID and revision. The Dataset tab/section coexist with existing source scope/page/search parameters.

Updating the raw lock and matching Dataset revision followed by the normal download workflow updates the displayed card without copying publisher text into UI code. Historical archives remain immutable. See [Upstream Dataset cards](upstream-dataset-cards.md) for maintenance steps and display limits.

## Scoring revisions

Testing accepts a data-only ScorerConfig that is frozen in its snapshot. Action and PII assertions use shared callbacks, while text checks use native promptfoo assertions. `core/grading.ts` persists native component grades; `core/report.ts` aggregates them for overall, Dataset and phase metrics. No judge is called again during Report rendering.

`core/scoring-revisions.ts` reads schema-3 saved evidence and uses a replay Provider with `promptfoo.evaluate()`. This Provider has no Target connection or credential dependency. A successful assessment is published under the same Run, and the Report selects its current or pinned version. Original execution files are immutable. Checksums bind each version to its cases/evidence and saved grades. Default offline gates are independent from the original execution/baseline gate. API execution and re-scoring share the existing serialized SDK boundary; this is still one backend process, with no Scorer registry, new UI resource or worker service.

## Metrics and execution activity

`core/classification.ts` derives action-level precision, recall, F1 and a confusion matrix from frozen labels and observed actions. Block and transform are positive interventions. These fields do not depend on extra scorer assertions. Accuracy remains the selected scorer match rate; binary detection accuracy is an explicit separate field. Historical views add derived metrics in memory without rewriting saved grades or execution artifacts.

The live Provider emits attempt-start, HTTP-stage-start, and attempt-finish lifecycle events. `core/activity.ts` keeps bounded state and atomically replaces `activity.json`; scheduling and concurrency remain inside promptfoo. The activity endpoint reads that bounded state without reparsing the complete Dataset snapshot or making Target calls. It exposes active samples/stages/repeats/timestamps and the latest 20 completions. The React activity component uses TanStack Query with one-second polling while active. Full attempt evidence remains in the normal Checks workflow.
