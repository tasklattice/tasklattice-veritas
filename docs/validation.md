# Validation

The default verification runs in GitHub Actions on GitHub-hosted runners. Tests do not need a deployed Guard service or production credentials. Local commands below are optional; operators do not need to build or run tests on their workstations.

## Hosted verification

[Verify workflow](../.github/workflows/verify.yml) runs on pushes and pull requests to `main`, and on manual dispatch. Actions are pinned to reviewed commit SHAs, checkout credentials are not persisted, and permissions are limited to reading repository content.

- **Source:** inspect indexed files for private data and credentials, install the lockfile with Node.js 22.22.0, run unit/API tests, exercise both protocol adapters and offline re-scoring, then typecheck and build the frontend.
- **Manifests:** lint/package Helm, render default/existing-claim/disposable-storage variants, and validate Compose without accessing a Kubernetes cluster.
- **Images:** build and run on native `ubuntu-24.04` (amd64) and `ubuntu-24.04-arm` (arm64) runners. Check health, frontend delivery, native compression module loading, both synthetic protocol demos, offline re-scoring, and saved Reports after replacing a container while reusing its volume.

The container check uses a read-only root filesystem and temporary runner-owned storage. It removes its test container and volume on exit. It deliberately refuses to run outside GitHub Actions. The workflow does not deploy services or publish images, receive production secrets, download gated datasets, upload raw Reports, or contact real Guard/model endpoints. It fetches only build dependencies and base images. Archive-dependent tests explicitly skip in a clean checkout; those skips are not full-corpus regression coverage.

Open the repository's Actions tab and select **Verify → Run workflow** for a manual run. Investigate failed steps in their hosted logs; keep real model regression evidence in the private testing environment.

## Optional local commands

```sh
npm ci
npm run typecheck
npm test
npm run test:integration
npm run build
```

`npm test` uses Node's test runner and local mock HTTP services. Test files run serially because API/archive fixtures share the workbench filesystem; parallel files can contend during source verification and Report polling. Some tests additionally exercise pinned raw archives; they explicitly skip when those archives are absent. Downloading a Dataset is optional for core tests and the integration demo. Tests and demos write local fixtures/artifacts into ignored `data/`, `runs/`, and temporary directories.

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
- Seeded case selection across the full source pool, ordering independence, changed seeds, proportional expected-action strata, minimum label coverage, and frozen selected IDs.
- Immediate Report IDs before preparation, preparation counters/cancellation/failures without traffic, queued cancellation, frozen Targets, phase history, and interrupted-state recovery.
- Saved Baseline comparisons: stable new failures/fixes, unstable repeats, incomplete/changed cases, incompatible scoring versions, filtering before pagination, immutable artifacts and zero extra Target calls.

Synthetic checks verify tool behavior. They do not establish the accuracy, latency, or cost of a deployed Guard. Environment-specific regression records and screenshots are deliberately excluded from the repository.

## Desktop acceptance

Use the [desktop review checklist](ui-review.md) after changing interaction or layout. Test both themes and the supported desktop widths. Mobile interaction is outside the current product scope.

## Before publishing

Stage the intended source files, then run:

```sh
npm run check:publication
```

This file check scans the Git index, reports suspicious file paths and token/key patterns without printing matched values, and rejects private runtime artifacts. It is a publication aid, not a guarantee that arbitrary business text or screenshots are anonymized. Review the staged diff and upstream license/provenance files before pushing.

## Jailbreak benchmark input validation

- `test/benchmark-scope.test.ts` covers official `prompt` extraction, blank-prompt exclusion, unsuccessful submitted attempts, nested artifact pagination, UI/API source validation, CLI/imported-case validation before sampling or traffic, frozen test purpose, Report scope and compatible baselines.
- Pinned `JailbreakBench/artifacts` revision `909e68c01d94222b8ad2e397a017e2e12e2adb73`: all 32 archived files verified; 18 benchmark scopes, 1,800 raw rows, 1,637 nonempty submitted prompts. Fixture artifacts are archived but excluded from Testing selections.
- Local mock integration verifies preparation → execution → scoring → reporting → finished, including official attack records plus JBB benign controls. No new NVIDIA or JEV model calls are part of this validation.
- The complete suite also covers CredData reconstruction, external-content boundaries, explicit/uncertain Guard model evidence, execution-error corrections, conservative PII redaction alignment, and container Host/health configuration. Vite retains the existing large-bundle advisory.
- Desktop browser review verified invalid-source blocking and recovery, preserved Review configuration, original README, subset selection, 25-row pagination, prompt-first display, row expansion, and scope notices in both themes. Historical snapshot/report/attempt/CSV file hashes remained unchanged.

This validates the testing tool and measurement contract. It does not establish detector quality; a fresh real-Target comparison must use the corrected prompts and confirm the actual Guard routing/model evidence.
