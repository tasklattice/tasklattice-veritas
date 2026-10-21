# Local validation

Validation runs locally. This repository does not configure hosted automation or a CI workflow. Tests do not need a deployed Guard service or production credentials.

## Commands

```sh
npm ci
npm run typecheck
npm test
npm run test:integration
npm run build
```

`npm test` uses Node's test runner and local mock HTTP services. Some tests additionally exercise pinned raw archives; they explicitly skip when those archives are absent. Downloading a Dataset is optional for core tests and the integration demo. Tests and demos write local fixtures/artifacts into ignored `data/`, `runs/`, and temporary directories.

`npm run test:integration` runs the promptfoo SDK against both protocols with six bundled synthetic cases repeated twice. Expected results are 12 completed checks per protocol, 18 HTTP calls for paired LiteLLM and 12 for standalone F5. It then re-scores the saved evidence and checks that the request count does not increase. The mock stops when the command finishes.

## Coverage

The suite checks:

- F5 and LiteLLM request/response contracts, paired preparation, standalone output, input-blocked skips, ambiguous results, transport errors, timeouts, cancellation, and credential scrubbing.
- Dataset label mapping, explicit source/config/split/category handling, Unicode decoding, immutable imports, and reviewed-label validation.
- Shared concurrency, repeated attempts, native promptfoo evidence/grade consistency, baseline compatibility, and quality-versus-execution exit codes.
- Accuracy/coverage separation, intervention precision/recall/F1, undefined denominators, scorer-independent confusion counts, per-Dataset metrics, and historical projections without rewriting artifacts or sending traffic.
- Active-check lifecycle before the first request finishes, concurrent cases, repeat ordinals, paired stages, bounded recent history, and terminal-state handling.
- Target and Report lifecycle, frozen queued configuration, permanent deletion, filtered evidence pagination, and CSV exports.
- Dataset discovery, original-row pagination/search/sorting/filtering, source statistics, full-row expansion, safe upstream Markdown/assets, and TanStack Query cache boundaries.
- Offline re-scoring without a Target or credentials, immutable evidence and grades, component assertions, version selection, and atomic failure recovery.

Synthetic checks verify tool behavior. They do not establish the accuracy, latency, or cost of a deployed Guard. Environment-specific regression records and screenshots are deliberately excluded from the repository.

## Desktop acceptance

Use the [desktop review checklist](ui-review.md) after changing interaction or layout. Test both themes and the supported desktop widths. Mobile interaction is outside the current product scope.

## Before publishing

Stage the intended source files, then run:

```sh
npm run check:publication
```

This local check scans the Git index, reports suspicious file paths and token/key patterns without printing matched values, and rejects private runtime artifacts and hosted workflow files. It is a publication aid, not a guarantee that arbitrary business text or screenshots are anonymized. Review the staged diff and upstream license/provenance files before pushing.
