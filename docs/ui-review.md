# Desktop interaction review

Veritas is a desktop testing workbench for a trusted local operator. Its primary path is **Datasets → Target → Execution → Review → Report**. Keep Testing and Report as the workflow names; do not expose the Guard's internal configuration objects as new Veritas resources.

## Shared layout

- Reuse the TaskLattice mark, Relay typography, semantic theme tokens, and existing shadcn/Radix controls.
- Keep catalog/detail headers compact, align titles and actions with the data surface, and use restrained status colors.
- Verify Light and Dark themes at desktop widths. Wide tables should scroll within their own surface without causing document overflow.
- Keep focus visible, labels explicit, keyboard order logical, and action feedback clear. Use transient toasts for successful resource mutations and inline errors with recovery for failed requests.

## Testing

- Select multiple Datasets; retain per-source scope and direction across step changes.
- Retain the selected Target and execution draft while moving backward, searching, or recovering from a validation error.
- Validate before advancing. Review must show the Target, source scopes, concurrency, repeats, scoring rules, and honest check-count bounds.
- During conversion, disable duplicate submission and show preparation feedback. Preparation happens before a Report ID is returned.
- After queuing, open the Report immediately. Verify active case identity, Dataset, direction, repeat, phase, elapsed time, recent completions, polling errors/retry, and cancellation.

## Report

- Put Accuracy, Precision, Recall, and F1 together. Expose positive-class semantics, undefined denominators, confusion counts, and coverage.
- Keep errors, skipped/missing checks, and unexpected content decisions distinct. Do not display connection failures as false negatives or successful blocks.
- Open unexpected previews and recent finished checks to the frozen sample and complete request/response evidence. Show scoring pending while a Run is active.
- Verify Dataset/result filters, empty states, pagination, CSV export of every recorded attempt, and version-specific JSON/Markdown downloads.
- Re-score saved evidence, switch versions, and confirm that original execution data and Target-call counts stay unchanged.
- Cancel an active test before deleting its Report. Deletion is permanent and has no restore flow.

## Datasets and Targets

- Dataset cards represent original repositories and identify publisher, source, revision, and license. Upstream documentation stays separate from Veritas testing notes.
- Verify scope selection, whole-source search/filter/sort, page changes, complete-row expansion, inspector, and retained state across tabs.
- Targets use a searchable table. Verify create/edit validation, stable rename identity, unavailable credentials, detail navigation, permanent-delete confirmation, and cache updates.

Use synthetic cases and dedicated disposable Targets for screenshots intended for publication. Historical captures and real deployment records remain local and ignored; they are not public acceptance fixtures.
