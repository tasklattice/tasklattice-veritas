# Local testing API

Start with `npm run dev`, or `npm run build` followed by `npm start`. The loopback API and desktop app share `http://localhost:38100`. The local server assumes a trusted operator.

## Product identities

A **Dataset** is one original source repository, such as `allenai/wildjailbreak`, represented by one card. A **Target** is a named destination under test in Veritas, with its own connection ID, runtime URL and Adapter. A Tali Guard Endpoint is the service exposed at that URL. **Testing** selects one or more Datasets, one Target and execution parameters. **Start testing** converts the source records into requests; the **Report** stores summary metrics, individual decisions and exports. Veritas does not create or publish Guard resources.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/datasets` | One card per source; metadata, provenance, local archive availability |
| GET | `/api/catalog` | Conversion configurations and recommended benchmark files |
| GET / POST | `/api/targets` | List or create Targets |
| GET / PUT / DELETE | `/api/targets/{id}` | Read, replace configuration, or permanently delete a Target |
| GET | `/api/datasets/{id}/card` | Original upstream README, YAML, headings and pinned provenance |
| GET | `/api/datasets/{id}/card/raw` | Original README attachment |
| GET | `/api/datasets/{id}/card/asset?path=...` | Verified archived raster image |
| GET | `/api/datasets/{id}/viewer` | Browsable archived subsets/splits/categories and pinned source metadata |
| GET | `/api/datasets/{id}/rows` | Bounded, searched pages of original records |
| GET | `/api/datasets/{id}/rows/{index}` | Full original record at a zero-based source row index |
| GET / POST | `/api/runs` | List tests, or apply source conversion and enqueue execution |
| GET | `/api/runs/{id}` | Status, Dataset IDs/Target, progress, saved report, frozen configuration and gate |
| GET | `/api/runs/{id}/activity` | Active cases, stages, repeats, elapsed-time timestamps and the latest 20 completions |
| GET | `/api/runs/{id}/attempts?offset=0&limit=50&filter=unexpected` | Filtered expected/observed evidence and grades |
| GET | `/api/runs/{id}/files/results.csv` | Export all recorded checks; also allows `report.json` and `report.md` |
| POST | `/api/runs/{id}/cancel` | Cancel execution and preserve partial evidence |
| DELETE | `/api/runs/{id}` | Permanently remove a finished Report and its artifacts |
| GET | `/api/runs/{id}/attempts/{attemptId}` | Full recorded attempt and its saved source sample |

## Start testing

Retrieve Dataset cards and Targets:

```sh
curl --fail http://localhost:38100/api/datasets
curl --fail http://localhost:38100/api/targets
```

Choose one or more source Dataset IDs and the Target ID. No prepared-copy ID is required. The local pinned raw archive must already exist, and credential variables must be exported in the server process.

```sh
curl --fail-with-body http://localhost:38100/api/runs \
  -H 'Content-Type: application/json' \
  --data '{"datasets":[{"datasetId":"wildjailbreak","phase":"input"},{"datasetId":"jailbreakbench","phase":"input"}],"targetId":"REPLACE_TARGET_ID","limitPerDataset":20,"repeat":2,"concurrency":2,"evidence":"endpoint","gate":{"minCoverage":1,"minAccuracy":0.9}}'
```

Starting a test verifies local files, converts source records, freezes an internal immutable input copy and queues the Run. HTTP 202 returns its ID **after preparation**. A missing or deleted Target, missing credential, invalid scope or unknown expected actions returns a configuration error before testing traffic. Preparation can take longer for large datasets; the UI shows preparation status while awaiting the response.

The desktop Testing workspace collects Datasets, one Target and execution settings with a final Review step. It retains the draft on preparation errors. After HTTP 202 returns the ID, it opens `/#/runs/{id}` immediately and polls the Report for progress and results; resource-list refreshes are independent. Preparation itself still precedes HTTP 202 and is not a durable asynchronous Report stage.

Use a nonempty `datasets` array even for a single source. Each entry accepts `datasetId` plus optional `config`, `split`, `phase`, `field` and `domain`. Duplicate source IDs, unknown sources, empty selections and invalid scopes are rejected. Do not mix this form with top-level legacy source selectors or `selectionId`.

Omit `limitPerDataset` to test the complete selected benchmark scopes. When present it must be a positive integer, applied **independently to each Dataset before repeats**. The example queues at most 80 checks: 2 sources × 20 cases × 2 repeats. Source-order capping occurs before unreviewed labels are excluded, so explicitly skipping those labels can reduce counts. A selected source without evaluable cases fails preparation rather than silently disappearing.

Optional `config` and `split` narrow each source's files. Without `config`, recommended benchmark files are used. Additional raw training files and auxiliary files are not included implicitly. `phase` is `input` or `output`; omitted uses that Dataset's default (Aegis includes input and saved responses; BeaverTails uses saved responses). Mixed input/output sources can share one Run. `field` selects a Safety-Prompts category; omitted converts all categories in the selected file. Topic-control requires a `domain` matching the Endpoint policy. Top-level `skipUnlabeled: true` explicitly excludes unknown expectations; it cannot make an entirely unlabeled source evaluable. Reviewed-label overrides are available through the CLI and legacy prepared-copy route below.

One Run freezes all sources and produces one Report. `run.datasetIds` lists the original source IDs; the legacy singular `run.datasetId` is present only for single-source Runs. `report.datasets` contains per-source summaries with the same metrics and denominators as the overall `report.summary`; `report.groups` retains Dataset/direction summaries. Overall accuracy is weighted by completed checks. Execution concurrency is shared across all selected sources.


Poll `/api/runs/{id}` until status is `completed`, `failed`, `cancelled` or `interrupted`. A completed Run may fail quality thresholds; inspect `run.gate.pass` and `run.exitCode`. Report artifacts return HTTP 404 until available. Preparation is not a durable queued stage in this local version; restart and apply again if interrupted during conversion.

Optional `baselineId` and `gate.maxAccuracyDrop` support relative checks. Baselines require compatible cases and execution settings. Exit codes: 0 pass, 1 quality failure, 2 execution/configuration failure. Custom gates and baselines are available through API/CLI; the UI uses the default strict gate.

## Filter and export a Report

`filter` accepts `all` (default), `unexpected` (completed, scored action mismatches), `error`, and `skipped`. Optional `dataset=wildjailbreak` combines with any result filter. Both filters apply **before** pagination. The response includes `items`, filtered `total`, `datasetTotal` (all statuses for the selected source), `allTotal` (all sources), and `unexpected`/`errors`/`skipped` for the selected source. Historical evidence is not silently rescored by a different implementation; evidence without a compatible grade is not classified as an unexpected decision.

Each evidence item includes `samplePreview` (up to 320 Unicode code points from the frozen sample text) and `sampleTruncated`. A missing saved sample produces a null preview. The complete sample remains available through `/api/runs/{id}/attempts/{attemptId}`. Previews never reread a mutable source Dataset. The Overview uses a bounded `filter=unexpected&limit=5` page; counters describe the full filtered population, not just the preview.

The CSV download exports **all recorded checks**, independent of the UI filter, including case/attempt IDs, source, direction, expected/actual action, execution status, pass, latency, reason, adapter and scan ID. Summary fields include accuracy, intervention precision/recall/F1, confusion counts, coverage, false positives/negatives, repeated-action instability, caller latency and HTTP call counts. Guard-side cost remains unavailable.

## Create and manage a Target

POST `/api/targets`:

```json
{
  "name": "uat-f5",
  "target": {
    "url": "https://guard.example.test/runtime/v1/endpoints/REPLACE_GUARD_ENDPOINT_ID/backend/v1/scans",
    "adapter": "f5-scan",
    "outputMode": "standalone",
    "apiKeyEnv": "VERITAS_F5_API_KEY",
    "timeoutMs": 30000
  }
}
```

The returned opaque `id` identifies the Veritas Target. The Guard Endpoint ID is already part of its runtime URL. Configure the Endpoint, protocol and Router binding in Guard first. Inline API keys and custom headers are rejected; credentials use environment references.

PUT `/api/targets/{id}` accepts the same full `{name,target}` payload. An optional `version` from GET provides optimistic concurrency control (stale edits return HTTP 409). Renaming keeps the Target ID unchanged. Missing credential variables do not prevent saving a connection, but do prevent starting tests. Leave `apiKeyEnv` absent for an unauthenticated local Target.

DELETE `/api/targets/{id}` physically removes the managed Target configuration and its per-resource state. It returns `{ "deleted": "TARGET_ID" }`. Subsequent detail/update/delete requests return HTTP 404. A recreated Target receives a fresh opaque ID, including when its name is reused. Queued tests and existing Reports keep their frozen Target configuration. This does not change a published Guard Endpoint.

## Report lifecycle and details

DELETE `/api/runs/{id}` permanently removes the Run artifact directory, job metadata and saved job Target file, returning `{ "deleted": "RUN_ID" }`. Subsequent detail, evidence and export requests return HTTP 404. Active tests return HTTP 409; cancel and wait for terminal status before deleting. A baseline used by an active comparison also returns HTTP 409 until the comparison finishes. There are no restore routes or deleted-resource list views.

The detail response includes `configuration`: the frozen Target, repeats, concurrency, source manifests, source checksums, case count and scorer. `configuration.gradesAvailable=false` means that the current implementation cannot reproduce that historical scorer. The UI marks those checks unscored and preserves the original aggregate report. It never invents new historical grades.

## Browse original Dataset records

GET `/api/datasets/wildjailbreak/viewer` lists available scopes. Then request:

`GET /api/datasets/wildjailbreak/rows?config=eval&split=train&offset=25&limit=25&search=benign`

`config`, `split` and optional Safety-Prompts `field` must match scopes returned by the viewer metadata. Aegis also exposes archived train and validation scopes for browsing; the Testing catalog remains test-only. Pagination uses a nonnegative integer `offset` and `limit` from 1 to 100 (default 25). Search is a case-insensitive literal substring across original record fields, limited to 200 characters; it applies before pagination. Unknown scopes and invalid bounds return HTTP 400. Unknown Datasets/row indices return HTTP 404.

The first request may return HTTP 202 with `status:indexing` and `indexedRows`; poll the same URL until ready. The source index is local SQLite, keyed by pinned source identity, category and file metadata. Completed indexes survive app restarts. At most two source indexes build concurrently. No Guard traffic or business-model calls are made by browsing.

The frontend uses TanStack Query cache keys containing Dataset ID, subset, split, category, search, sort/order, exact column/value filter, offset and page size. It forwards cancellation signals, preserves previous pages only within the same source scope/search/sort/filter, and polls HTTP 202 indexing states. Metadata and complete-row queries are cached separately.

Ready pages contain `items` (`index`, preview `values`, `truncatedFields`), `columns` (name/type and full-scope statistics), filtered `total`, unfiltered `allTotal`, `offset` and `limit`. Preview values are shortened to 400 characters; GET `/rows/{index}` returns the complete original `data` object. Row indices are zero-based and stay tied to the selected scope, independent of filtering. These counts describe source records, not converted testing cases. The viewer covers the declared benchmark scopes plus explicit archived browsing scopes, not every auxiliary file in the raw archive. Aegis train concatenates `train.json` and `refusals_train.json` (30,007 rows); validation concatenates `validation.json` and `refusals_validation.json` (1,445 rows), matching the pinned upstream README. Test remains 1,964 rows.

Optional `sort` is an exact column name and `order` is `asc` or `desc`; ties use source row index. An exact filter uses `column` and a JSON-encoded `value`, for example `column=prompt_label&value=%22unsafe%22`. Search and filter apply before sort/pagination. Unknown columns, invalid orders or malformed filter values return HTTP 400. SQL values and JSON paths are bound parameters; the API does not accept SQL text.

Column statistics cover the unfiltered selected scope, so filtering does not alter the distribution reference. Statistics include non-null count, missing count, range (numeric values or serialized text lengths), logarithmic magnitude/length bins, and exact value frequencies when cardinality is at most 24 and values are short. The UI labels low-cardinality strings as classes; long/free-form strings use length distributions. Missing fields and explicit nulls are counted together.

The desktop viewer defaults to 100 rows per page and supports 25/50/100, numbered pages and direct jumps. A view link stores subset, split, category, page, size, search, sort/filter and a zero-based selected row in the fragment, for example `/#/datasets/aegis?config=default&split=train&p=2&size=100&row=248`. The inspector shows row 249 in human-readable numbering and fetches its complete record separately. Browsing filters do not change the Testing preparation scope or labels.

## Advanced tooling compatibility

`GET /api/dataset-selections` lists internal immutable copies. `POST /api/datasets/import` still accepts `{ "dataset":"aegis", "config":"default", "split":"test", "phase":"both", "limit":1000 }` for explicit preparation. Here `limit=0` means complete conversion. A new import does not create another Dataset card, and counts across overlapping copies are never summed as source size.

Legacy single-source requests with top-level `datasetId`, `config`, `split`, `phase`, `field`, `domain` and `limit` remain supported. Their `limit` still caps the whole Run; it cannot be combined with the new `datasets` form.

For a previously imported/reviewed copy, include `selectionId` with its source `datasetId` in the Run payload. The API verifies that they match before sending traffic. Local synthetic fixtures remain runnable through this tooling route. Existing `data/targets/` files and legacy flat-copy `datasetId` inputs remain compatible. `/api/endpoints` and `endpointId` remain API aliases for earlier local integrations; the product UI and canonical API use Target/`targetId`. These aliases do not create a separate Endpoint resource in Veritas.

The server accepts discovered IDs rather than arbitrary dataset/Endpoint/output filesystem paths. Remote authentication, destination policy and enterprise audit are outside this local version.


## Upstream Dataset card

The card routes read only the local, lock-listed upstream README. They expose its original raw text, parsed YAML and source revision, license, size and checksum. Raw downloads preserve the archived UTF-8 bytes. Missing sources/files return 404; revision or integrity mismatches return 409. The renderer supports section links through `/#/datasets/aegis?tab=card&section=upstream-citation`. See [Upstream Dataset cards](upstream-dataset-cards.md) for supported content, image limits and maintenance. No card request sends Guard traffic.

## Configurable scoring

POST `/api/runs` accepts optional `scorer` rules. POST `/api/runs/{id}/rescore` accepts `{scorer: configuration}` and returns the new scoring ID, Report, gate and exit code after local promptfoo replay. Invalid rules return 400; active execution or re-scoring returns 409.

GET Report detail includes version choices and eligibility. Optional `?scoring=original` or `?scoring=s-UUID` pins the Report, attempt lists, individual attempts and exports to one version. The default API/UI view follows the last successfully published assessment. `/files/scorer.json` downloads its configuration. Original execution artifacts are preserved; offline versions use default absolute gates. See [Scoring and offline re-scoring](scoring.md) for schemas, examples and metric definitions.

## Live execution activity

GET `/api/runs/{id}/activity` is a bounded local status read; it does not call the Target. The desktop polls it once per second while a Run is queued or running. Fields include `runStatus`, `phase`, `serverTime`, `updatedAt`, `total`, `started`, `finished`, `completed`, `errors`, `skipped`, `active`, and `recent`. Queue position is included for queued Runs.

Active entries identify the attempt, case, Dataset, input/output direction, expected action, case ordinal, repeat ordinal, stage, start timestamps, and a bounded source preview. Stages distinguish starting, paired-input preparation, input scanning, and saved-response scanning. Recent entries additionally include final execution status, observed action, completion time, and total HTTP latency. These observed actions are not provisional scorer verdicts. Evidence is persisted before an entry appears as finished, so its attempt-detail endpoint is available immediately.

The activity file retains active checks and the latest 20 completions. Full request evidence remains in `/attempts`. Completed or interrupted Runs return no actively executing entries. Historical Runs without lifecycle tracking return `available:false`; no execution history is fabricated.

Report summaries expose `precision`, `recall`, `f1`, and `classification` overall and per Dataset/phase. Positive means block or transform; errors, skips, missing and unlabelled attempts are excluded. Undefined denominators are null. Selected-scorer Accuracy stays separate from binary `classification.accuracy`. Historical JSON/Markdown downloads can include these derived metrics without altering the original files on disk.
