import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const imageRepository = 'ghcr.io/tasklattice/tasklattice-veritas';

/** Reject a tag that would publish inconsistent application or deployment versions. */
export function checkRelease(root: string, tag?: string): string {
  const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const yaml = (path: string) => parse(readFileSync(resolve(root, path), 'utf8'));
  const pkg = json('package.json');
  const version = tag === undefined ? pkg.version : tag.replace(/^v/, '');
  if (!stableVersion.test(version) || (tag !== undefined && tag !== `v${version}`)) {
    throw new Error('Release tag must be vMAJOR.MINOR.PATCH without a prerelease or leading zeros.');
  }
  const lock = json('package-lock.json');
  const chart = yaml('charts/tasklattice-veritas/Chart.yaml');
  const values = yaml('charts/tasklattice-veritas/values.yaml');
  const compose = yaml('compose.yaml');
  const versions: Record<string, unknown> = {
    'package.json version': pkg.version,
    'package-lock.json version': lock.version,
    'package-lock.json root package version': lock.packages?.['']?.version,
    'Helm chart version': chart.version,
    'Helm appVersion': chart.appVersion,
    'Helm image tag': values.image?.tag,
  };
  for (const [name, actual] of Object.entries(versions)) {
    if (actual !== version) throw new Error(`${name} must be ${version}; found ${String(actual)}.`);
  }
  if (values.image?.repository !== imageRepository) {
    throw new Error(`Helm image repository must be ${imageRepository}.`);
  }
  if (compose.services?.veritas?.image !== `${imageRepository}:${version}`) {
    throw new Error(`Compose image must be ${imageRepository}:${version}.`);
  }
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const version = checkRelease(root, process.argv[2]);
    console.log(`Release references agree: v${version} (application, lockfile, Helm and Compose).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
