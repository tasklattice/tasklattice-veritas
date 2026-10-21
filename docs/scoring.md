# Configurable scoring and offline re-scoring

Testing and Report remain the only workflow concepts in the UI. Scoring rules are embedded configuration, not a separate resource to create or administer.

## Use the UI

1. In **Start testing → Execution → Scoring rules**, use exact action matching, accept block or transform for an expected block, or configure the accepted-action matrix. PII removal checks are enabled by default. Optional text checks use promptfoo's native `contains`, `not-contains`, `equals` and `is-json` assertions.
2. Start the test normally. The Report freezes the rules and stores each attempt's SDK grade, component outcomes and reason.
3. Open a finished Report and click **Re-score**. Change the rules and click **Re-score results**. This reads existing request/response evidence; it does not resolve credentials, instantiate the live Target provider, or call a model.
4. Use **Scoring** inside the Report to switch between Original and later versions. Summary, quality gate, unexpected-check filters, check details and all exports refer to the selected version. **Download rules** saves a reusable JSON configuration.

Successful re-scoring makes the new version the Report's default view, including its list summary. Selecting an older version uses a shareable `?scoring=...` URL and does not change that default. The original artifacts remain untouched. Original test status/exit code describe the original execution; the selected scoring gate describes the selected assessment. Interrupted executions without a terminal `execution.json` cannot be re-scored.

## CLI examples

```sh
# Apply rules when collecting new Target evidence.
npm run veritas -- run \
  --data data/my-import \
  --target data/targets/my-f5.json \
  --scorer examples/scorer-strict.json \
  --out runs/content-safety-v1

# Reuse those requests and responses with different rules. No Target calls.
npm run veritas -- rescore \
  --run runs/content-safety-v1 \
  --scorer examples/scorer-protection.json

# Use the scoringId printed by rescore to inspect a particular version.
npm run veritas -- report --run runs/content-safety-v1 --scoring s-REPLACE_WITH_RETURNED_UUID

# Original always refers to the frozen initial assessment.
npm run veritas -- report --run runs/content-safety-v1 --scoring original
```

Examples: `scorer-strict.json`, `scorer-protection.json` and `scorer-redacted-text.json`. The last example intentionally requires a particular redaction marker; adapt its values to your Target's returned text. Assertions inspect `Attempt.texts`, not the complete response envelope or original Dataset text. A Target that does not return text supplies an empty string; text assertions may therefore fail even when its action is correct.

```json
{
  "schemaVersion": 1,
  "name": "Block or transform",
  "acceptedActions": {"allow": ["allow"], "block": ["block", "transform"], "transform": ["transform"]},
  "checkPii": true,
  "assertions": [{"type": "not-contains", "value": "person@example.test", "scope": "transformed"}]
}
```

`scope: transformed` applies to cases whose original expectation is transform; `scope: all` applies to all completed checks. Assertions are combined by promptfoo: all must pass. Native component scores are preserved. False-positive/false-negative counts use the configured action assertion; additional PII/text failures affect overall accuracy, not those action-only rates. Transport errors, skipped output checks and missing attempts stay separate from accuracy and remain in coverage. Re-scoring never fills missing evidence or invents an unexecuted response check.

## API

```sh
curl -X POST http://localhost:38100/api/runs/REPORT_ID/rescore \
  -H 'Content-Type: application/json' \
  --data-binary @REQUEST_FILE.json
```

The body is `{ "scorer": <configuration above> }`. HTTP 200 returns `id`, `report`, `gate`, and `exitCode`. A scoring mismatch is a valid completed assessment, not an HTTP error. Invalid configurations return 400; active execution/re-scoring returns 409. The local operation completes before the response; the UI preserves the draft and shows errors in place.

GET `/api/runs/{id}` includes available versions, selected rules, eligibility and busy state. Add `?scoring=original` or `?scoring=s-UUID` to pin a version. The same parameter applies to `/attempts`, `/attempts/{attemptId}` and `/files/{report.json|report.md|results.csv|scorer.json}`. Invalid versions return 404. The default API view is the latest successfully published scoring version.

New POST `/api/runs` accepts an optional `scorer` with the same configuration. Missing rules select exact action matching with PII removal enabled. Configuration is data only: arbitrary JavaScript/Python, file assertions, transforms, providers and remote judges cannot be supplied through this API.

## Versioning, gates and execution

- New runs save `grades.jsonl` and `grading.json` next to the original evidence. Reports aggregate these saved SDK grades rather than re-running scoring functions. Historical compatible schema-3 reports retain their original deterministic grading fallback; unknown historical scorers remain explicitly unscored.
- Re-scoring uses a custom in-memory replay Provider with `promptfoo.evaluate()`, one test per recorded attempt and repeat=1. It cannot reach the Target. Domain assertions use callbacks; text assertions are native promptfoo assertions. Recorded transport errors and skips retain their status. Replay execution time does not replace original request latency or Guard cost.
- New versions are written to `scorings/s-UUID/`, then atomically published. The current-version pointer changes only after successful grading, consistency checks and artifact generation. Failed/aborted attempts remove their staging files and retain the previous Report selection. A source/grade checksum mismatch prevents reading that saved assessment.
- The API serializes Testing and offline scoring within its existing SDK queue boundary. Deletion is blocked while a Report is being re-scored. The CLI rejects unfinished source executions. Scoring is local and does not require the original Target to exist or its credential to remain available.
- Each offline version uses explicit default absolute gates: coverage=100%, accuracy=100%. Original custom thresholds, baseline verdict, files and execution exit code remain with **Original**. The re-score dialog explains this before submission; a relaxed rule set does not retroactively turn an earlier test into a pass.
- CLI `report` and `compare` default to **original**, independent of the UI's default selection. `compare` also accepts `--scoring ID` and `--baseline-scoring ID`. Comparisons require identical scoring fingerprints and the existing case/protocol/engine/repeat/concurrency compatibility. Re-score both baseline and current evidence with identical rules before comparing changed rules.

## Detection metrics

Precision, recall, and F1 use a fixed positive class: intervention (block or transform). They are computed from labelled completed attempts, independently of the accepted-action matrix and additional text/PII assertions. Accuracy remains the selected scorer match rate. Undefined denominators are null. The Report exposes TP, FP, FN, TN, support, and binary detection accuracy as `summary.classification`. Re-scoring can change Accuracy while leaving detection metrics unchanged because the recorded labels and observed actions have not changed.

Historical Report views and downloads derive these fields from frozen cases and attempts without overwriting original artifacts or making new Target calls.

This version supports deterministic, local scoring. It does not add LLM judges, a Scorer registry, new sidebar entries, or distributed workers.

References: [promptfoo Node SDK](https://www.promptfoo.dev/docs/usage/node-package/), [assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/), [custom providers](https://www.promptfoo.dev/docs/providers/custom-api/).
