# Releasing Veritas

Veritas is distributed as a GHCR container image, a Helm OCI chart, and a GitHub
Release with a Helm archive, Compose file, release manifest and `SHA256SUMS`.
The npm package is private; operators use the container or run from source.

## Prepare a stable release

Work on `main` after merging the intended feature branches and worktrees.
Update these references together:

- `package.json` and both root versions in `package-lock.json`.
- `charts/tasklattice-veritas/Chart.yaml` (`version` and `appVersion`).
- `charts/tasklattice-veritas/values.yaml` (`image.tag`) and `compose.yaml`.
- Versioned install examples and `docs/releases/vMAJOR.MINOR.PATCH.md`.

Run `npm run check:release`, source tests, synthetic integration and the frontend
build. Stage the intended sources, run `npm run check:publication`, and push
`main`. Wait for all hosted Verify jobs, including both native image checks, to
pass for that commit. Then tag that exact commit:

```sh
git switch main
git pull --ff-only
npm run check:release -- v0.1.0
git tag -a v0.1.0 -m 'TaskLattice Veritas v0.1.0'
git push origin v0.1.0
```

The Release workflow rejects malformed or mismatched tags, missing release
notes and commits outside `main`. It reuses Verify, builds both native images,
tests startup/protocols/re-scoring/persistence, and only then pushes them.
It combines those tested images into the version tag, a full source-SHA tag,
and `latest`, packages/pushes Helm, and creates the GitHub Release. Actions are
pinned; publication jobs use only the workflow's scoped `GITHUB_TOKEN`.

For the first publication, ensure the two new GHCR packages
`tasklattice-veritas` and `charts/tasklattice-veritas` are public in their package
settings. Check pulls without registry credentials before announcing the release.
Do not move an existing release tag to different source code. A failed workflow
can be rerun on the same tag; investigate its failed step before doing so.

## Check distribution artifacts

Download all four assets from the same GitHub Release into an empty directory.
Verify them with `sha256sum -c SHA256SUMS` (Linux) or
`shasum -a 256 -c SHA256SUMS` (macOS). Inspect `release-manifest.json` for the
source revision, image digest and supported platforms. Use the digest reference
from that file when an immutable container reference is required.

```sh
docker buildx imagetools inspect ghcr.io/tasklattice/tasklattice-veritas:0.1.0
helm pull oci://ghcr.io/tasklattice/charts/tasklattice-veritas --version 0.1.0
```

`npm run release:package -- v0.1.0` prepares local assets under `dist/release`
for inspection; only the hosted Release workflow publishes the official files
with a verified multi-architecture image digest. The release uses an explicit
asset list so private data, local captures and build output cannot be uploaded
through a broad directory glob.
