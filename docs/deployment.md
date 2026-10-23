# Deployment

Veritas packages the React desktop UI, Fastify API, CLI, pinned catalog and public
fixtures in one image. It does not deploy TaskLattice Guard or download upstream
Datasets during startup. The process owns a serialized queue and filesystem
state, so run exactly one replica. A restart leaves unfinished tests interrupted;
saved Reports and evidence remain available.

## Local Docker startup

```sh
docker compose up --build -d
docker compose exec veritas npm run veritas -- demo
```

Visit [localhost:38100](http://localhost:38100). Compose publishes the server on
host loopback and uses the `veritas-data` named volume. `docker compose down`
keeps that volume; `docker compose down -v` permanently deletes it.

The image runs as UID/GID 1000 and stores all mutable state under
`/var/lib/veritas`. Application-relative `data`, `runs`, `.cache` and `.promptfoo`
are symlinks into that directory. Mount the whole directory to preserve Targets,
job state, raw/imported Datasets, frozen evidence, Reports and promptfoo state.
The entrypoint creates child directories on a new volume. Bind-mounted storage
must be writable by UID/GID 1000.

```sh
docker build -t tasklattice-veritas:0.3.0 .
docker run --rm --init --name veritas \
  -p 127.0.0.1:38100:38100 \
  -v veritas-data:/var/lib/veritas \
  tasklattice-veritas:0.3.0
```

The build context excludes local data, credentials, Reports, caches and Git
history. A full Node build stage supplies the native-module compiler toolchain;
the slim final stage contains production dependencies and built frontend assets.
TypeScript sources remain because promptfoo loads providers/assertions
from them and Veritas records their hashes for reproducibility. `tsx` is an
explicit production dependency. The image uses Node.js 22.22.0 on Debian
Bookworm; override `--build-arg NODE_VERSION=...` to use another supported patch.

## Kubernetes installation

Requirements: Helm 3 or 4, Kubernetes 1.25+, an image accessible to every node,
and a default StorageClass or existing PVC. For a remote cluster, substitute your
registry for this placeholder:

```sh
docker build -t registry.example.test/tasklattice/veritas:0.3.0 .
docker push registry.example.test/tasklattice/veritas:0.3.0
helm upgrade --install veritas ./charts/tasklattice-veritas \
  --namespace veritas --create-namespace \
  --set image.repository=registry.example.test/tasklattice/veritas \
  --set-string image.tag=0.3.0 \
  --wait --timeout 5m
kubectl -n veritas port-forward service/veritas-tasklattice-veritas 38100:80
```

Visit [localhost:38100](http://localhost:38100). For kind, load the locally built
image with `kind load docker-image tasklattice-veritas:0.3.0` and use the default
image values. Other local clusters may use a separate image store; import the
image using their supported command. Use an image built for the nodes'
architecture; a local ARM image does not run on AMD64 nodes. For both platforms:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -t registry.example.test/tasklattice/veritas:0.3.0 --push .
```

The chart uses one replica and the `Recreate` strategy so an upgrade cannot run
two writers against the same files. It runs as UID/GID 1000 with `fsGroup: 1000`,
a read-only root filesystem, writable state and `/tmp`, dropped capabilities,
and no service-account token. Health probes call `/healthz` with `Host:
localhost`, preserving the application Host check. The endpoint only confirms
that the API process responds; it does not contact a Target or download data.

| Helm value | Default | Purpose |
|---|---|---|
| `image.repository`, `image.tag` | `tasklattice-veritas`, `0.3.0` | Image built from this repository |
| `image.pullPolicy` | `IfNotPresent` | Use a node-local or registry image |
| `imagePullSecrets` | `[]` | Existing registry credential references |
| `service.port` | `80` | ClusterIP Service port; container port is 38100 |
| `allowedHosts` | `[]` | Extra exact hostnames, in addition to loopback |
| `existingSecret` | `""` | Existing Secret whose keys become environment variables |
| `extraEnv` | `[]` | Kubernetes environment entries, including `valueFrom` |
| `persistence.enabled` | `true` | Persist state; false uses disposable `emptyDir` |
| `persistence.existingClaim` | `""` | Reuse a claim in the release namespace |
| `persistence.size` | `20Gi` | New claim size; raw archives may need much more |
| `persistence.storageClass` | `null` | Cluster default; `""` requests no class |
| `persistence.retain` | `true` | Keep a chart-created PVC when uninstalling |
| `resources` | 250m CPU / 512Mi requested, 2Gi memory limit | Adjust for corpus size and concurrency |
| `podAnnotations`, `nodeSelector`, `tolerations` | Empty | Pod metadata and scheduling |

For an existing claim, set `--set persistence.existingClaim=veritas-state`.
That claim must support writes by UID/GID 1000; `fsGroup` support depends on the
storage driver. The chart does not modify an existing claim. For temporary
synthetic demonstrations only, use `--set persistence.enabled=false`; replacing
the Pod then loses all state. Do not override the chart's `HOST`, `PORT` or
`VERITAS_ALLOWED_HOSTS` entries through `extraEnv`.

## Credentials and data preparation

Configure and publish the real Guard Endpoint before creating a Veritas Target.
Inside Docker or Kubernetes, `127.0.0.1` points to the Veritas container/Pod.
Use a Guard address reachable from there, such as its Kubernetes Service DNS
name. Docker Desktop can reach a host service using `host.docker.internal`;
Linux Docker may need an explicit host-gateway mapping.

Target configuration stores only the credential's environment-variable name.
For Compose, add an override containing `env_file` that points to an ignored
local credential file. For example, save this as
`/tmp/veritas-compose-credentials.yaml`:

```yaml
services:
  veritas:
    env_file:
      - /absolute/path/to/private/veritas.env
```

The file can supply `VERITAS_F5_API_KEY` and `HF_TOKEN`. Start with:

```sh
docker compose -f compose.yaml -f /tmp/veritas-compose-credentials.yaml up -d
```

For Kubernetes, create a Secret from that private file and reference its name:

```sh
kubectl create namespace veritas --dry-run=client -o yaml | kubectl apply -f -
kubectl -n veritas create secret generic veritas-credentials \
  --from-env-file=/absolute/path/to/private/veritas.env
helm upgrade --install veritas ./charts/tasklattice-veritas \
  --namespace veritas --set existingSecret=veritas-credentials \
  --wait --timeout 5m
```

Include the same image/storage overrides as your first install. Keep credential
values out of Helm values files and shell history. Secret changes require a Pod
restart (`kubectl -n veritas rollout restart deployment/veritas-tasklattice-veritas`).

Fetch only the Datasets you need; the application works without any archive:

```sh
docker compose exec veritas npm run veritas -- datasets download --dataset xstest
docker compose exec veritas npm run veritas -- datasets download \
  --dataset xstest --verify-only

kubectl -n veritas exec deployment/veritas-tasklattice-veritas -- \
  npm run veritas -- datasets download --dataset xstest
```

Downloads use the persistent volume. Gated sources need approved upstream
access and `HF_TOKEN`; CredData additionally needs local reconstruction. See
[Dataset recipes](datasets.md) and [CredData](creddata.md). The UI converts the
selected archived scope when testing starts. The demo uses only synthetic
fixtures and never downloads these archives.

## Access, upgrades and backups

`HOST` defaults to `127.0.0.1` outside the image and `0.0.0.0` inside it. `PORT`
defaults to 38100. Requests accept `localhost`, `127.0.0.1`, and `[::1]` Hosts.
`VERITAS_ALLOWED_HOSTS` adds comma-separated exact hostnames without schemes,
ports or wildcards; Helm maps `allowedHosts` to it. Cross-origin requests remain
rejected. The Host list is not authentication: keep the loopback/tunnel default,
or configure a trusted authenticated proxy before allowing a remote hostname.

Stop or cancel active tests before upgrading. Build a new immutable image tag,
then use `docker compose up -d --build` locally, or `helm upgrade --install` with
the new registry tag. A graceful shutdown closes the API and cancels active
execution; it does not resume unfinished jobs automatically.

Back up the entire `/var/lib/veritas` volume with the process stopped, including
`data`, `runs`, `cache` and `promptfoo`. This keeps request evidence, source
provenance and promptfoo's SQLite state together. Restore to a writable volume
owned by UID/GID 1000. Do not share one volume across two running instances.
Evidence can contain sensitive source text and responses.

`helm uninstall veritas -n veritas` retains the default PVC. Reinstall using
`--set persistence.existingClaim=veritas-tasklattice-veritas` to reuse it. Delete
the claim explicitly only when its evidence is no longer needed. For a PVC
stuck Pending, inspect the StorageClass, capacity and provisioning events with
`kubectl -n veritas describe pvc veritas-tasklattice-veritas`.

## Validate the package

```sh
helm lint --strict charts/tasklattice-veritas
helm template veritas charts/tasklattice-veritas --kube-version 1.31.0
docker compose config --quiet
docker build -t tasklattice-veritas:0.3.0 .
```

`helm template` uses an explicit Kubernetes version so offline rendering also
works with Helm installations whose synthetic default predates Kubernetes 1.25.
Run `npm test` and `npm run build` before building a release image.
