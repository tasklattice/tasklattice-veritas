# CredData: passwords, API keys, tokens and private keys

Veritas exposes one **CredData** Dataset card under **PII & privacy**, sourced from
[Samsung/CredData](https://github.com/Samsung/CredData). It tests the credential
portion of PII protection. It does not introduce a separate product policy and
does not use a content-safety or jailbreak model.

Pinned revision: `9a7a7e10b929de46a075ef4f5c83c4a310f3be57`.
Converter: `creddata-context-v1`.

## Pinned archive counts

- 337 upstream source repositories; 11,030 annotated files.
- 67,896 source annotations: 15,753 T, 48,061 F, 4,082 X.
- 64,691 request intervals after merging overlaps.
- Default reviewed scope: **58,089 requests**, with 12,658 expected block and 45,431 expected allow.
- Needs-review scope: **6,602 requests**, including three upstream X annotations with invalid character spans.
- 1,338 request intervals span multiple lines.
- Positive request coverage: 3,709 password, 7,285 API-key, 1,614 token and 1,423 private-key requests. Categories overlap and must not be summed.

## Archive and reconstruct

Upstream publishes metadata and a reconstruction/obfuscation script, not a ready
JSONL download. The source README's historical counts do not describe every
revision. Use the locally generated `reconstruction.json` for this version's
annotation and request counts.

Rebuild the upstream dataset in a separate working directory. Its Python tool is
an offline data-preparation dependency; Veritas remains a TypeScript application.
Use Python 3.13 for this pinned reconstruction. The upstream repository recommends
Linux; the prepared archive can subsequently be copied to an isolated deployment.

```sh
git clone https://github.com/Samsung/CredData.git /tmp/creddata-upstream
git -C /tmp/creddata-upstream checkout 9a7a7e10b929de46a075ef4f5c83c4a310f3be57
python3.13 -m venv /tmp/creddata-venv
/tmp/creddata-venv/bin/pip install pybase62==1.0.0
cd /tmp/creddata-upstream
GIT_TERMINAL_PROMPT=0 /tmp/creddata-venv/bin/python download_data.py --jobs 8 --noise 0
```

Wait for successful completion, including obfuscation. Do not import the `tmp/`
source checkouts. Then, from the Veritas repository:

```sh
npm run veritas -- datasets reconstruct creddata \
  --source-dir /tmp/creddata-upstream \
  --out data/raw/creddata/9a7a7e10b929de46a075ef4f5c83c4a310f3be57

npm run veritas -- datasets download --dataset creddata --verify-only
```

The reconstruction command checks pinned metadata and script hashes, copies the
upstream README and assets, archives reconstructed `data/` files and source
licenses, then writes two JSONL scopes. It also checks the generated files against
their pinned hashes in the raw lock. Existing output directories are never
overwritten. Temporary source checkouts are not copied into Veritas.

`datasets download` can fetch the pinned metadata and documentation. It cannot
fetch the generated JSONL files from GitHub: use reconstruction or transfer an
already verified archive. An incomplete reconstruction is reported as missing,
never silently replaced with a different revision.

The repository tooling is Apache-2.0. Individual source files retain their own
upstream licenses, archived alongside the reconstructed files. All dataset payloads
remain in ignored `data/` storage, outside the application source repository.

## Request and label semantics

- The unit is an annotated line interval. Overlapping intervals in the same file
  are merged into a single request, including their full annotations. A negative
  annotation on a line containing a positive secret is not a benign request.
- Multiline private keys remain intact. Line endings are normalized as in the
  upstream obfuscator; values and surrounding assignment syntax are not rewritten.
  Unannotated neighboring lines are not appended, because they could change the
  request's label or contain additional secrets.
- Eligible `T` annotations map to **block**, matching Guard's `local-credentials`
  policy. Passwords, API keys/secrets, authentication tokens and private keys are
  in scope. Source `F` annotations map to **allow**.
- `X` annotations and positive categories outside this scope (for example a UUID,
  nonce, salt, bucket name or domain alone) remain unscored unless the same request
  contains an eligible positive. Invalid explicit character spans also require
  review. Original labels, positions and review reasons are retained.
- Missing character offsets are preserved as upstream `-1`; valid line positions
  still identify the complete request. Explicit offsets use Unicode code points,
  consistent with the upstream Python metadata.
- Annotation labels do not prove that a credential is active. Veritas uses the
  upstream obfuscated output and never attempts authentication with dataset values.

`credentials / reviewed` is the default scope. `credentials / needs-review` can be
inspected in the Dataset viewer but is not included by default. These are **local
selection scopes**, not upstream train/test splits. The complete pinned metadata
is preserved, including excluded and uncertain annotations.

The viewer supports pagination, full-record inspection and column filtering.
Useful columns include `expected`, `credentialTypes`, `categories`, `sourceLabels`
and `sourceFile`. The Dataset card displays the original pinned README.

## Start Testing

In **Datasets → CredData → Start testing**, use:

1. Dataset: CredData, `credentials / reviewed`.
2. Target: a Guard Endpoint with **PII → Passwords & API credentials** enabled.
   Confirm its action is block and that unrelated policies will not confound the
   comparison. The existing prompt-injection Target is not a substitute.
3. Test focus: **Endpoint decisions**; direction: Input.
4. For a small connectivity check: 100 cases, stratified sampling, seed 42,
   concurrency 2, repeat 1. The sampler is proportional by expected action; it
   does not make this imbalanced source 50/50 or balance credential families.
5. Inspect the Report's accuracy, precision, recall, false positives and execution
   evidence. Separate credential-family coverage when interpreting the result.

Offline preparation and an explicit CLI run:

```sh
npm run veritas -- datasets prepare --dataset creddata \
  --out data/creddata-prepared-v1

# Configure the Target file and its credential environment variable first.
npm run veritas -- run \
  --data data/creddata-prepared-v1/creddata__credentials__reviewed \
  --target data/targets/credentials.json \
  --purpose endpoint-decisions --sampling stratified --seed 42 --limit 100 \
  --repeat 1 --concurrency 2 --out runs/creddata-input-001
```

For simulated response checks, import the same reconstructed scope with
`--phase output` and select F5 Scan or LiteLLM `outputMode: standalone`:

```sh
npm run veritas -- datasets import creddata \
  --file data/raw/creddata/9a7a7e10b929de46a075ef4f5c83c4a310f3be57/records/reviewed.jsonl \
  --config credentials --split reviewed --phase output --limit 0 \
  --out data/creddata-output-v1
```

There is no upstream conversation or LLM response: this explicitly simulates the
same credential-bearing text as output. Do not describe it as an upstream response
benchmark. A redaction policy needs a separately reviewed action/span mapping;
accepting any transformed action alone does not prove that secrets were removed.

## Interpretation

Source class imbalance is retained. A high accuracy can hide low credential
recall, so inspect recall and false-positive rate as well. Exact duplicate text
may occur in different source files; source-based case IDs preserve that fact.
If constructing development and holdout cohorts, group by text/value and source
repository before splitting rather than randomly splitting annotation IDs.

These scores establish a public credential-detection baseline. They are not
directly comparable with F5 or Nemo scores from the internal DBS Secrets workbook.
No Target traffic or model calls occur during archive reconstruction or import.
