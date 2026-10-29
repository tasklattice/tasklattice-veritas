import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const tag = process.argv[2] ?? `v${pkg.version}`;
if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) || tag !== `v${pkg.version}`) {
  throw new Error('A stable release tag matching package.json is required.');
}
const version = tag.slice(1);
const image = 'ghcr.io/tasklattice/tasklattice-veritas';
const digest = process.env.RELEASE_IMAGE_DIGEST;
if (digest && !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid release image digest.');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const destination = resolve(root, 'dist/release');
mkdirSync(destination, {recursive: true});
execFileSync('helm', ['lint', '--strict', 'charts/tasklattice-veritas'], {cwd: root, stdio: 'inherit'});
execFileSync('helm', ['package', 'charts/tasklattice-veritas', '--destination', destination,
  '--version', version, '--app-version', version], {cwd: root, stdio: 'inherit'});
copyFileSync(resolve(root, 'compose.yaml'), resolve(destination, 'compose.yaml'));
const chart = `tasklattice-veritas-${version}.tgz`;
writeFileSync(resolve(destination, 'release-manifest.json'), JSON.stringify({
  version, revision,
  image: {repository: image, tag: version, ...(digest ? {digest} : {}),
    reference: digest ? `${image}@${digest}` : `${image}:${version}`,
    platforms: ['linux/amd64', 'linux/arm64']},
  chart: {file: chart, version, oci: 'oci://ghcr.io/tasklattice/charts/tasklattice-veritas'},
}, null, 2) + '\n');
const assets = [chart, 'compose.yaml', 'release-manifest.json'];
writeFileSync(resolve(destination, 'SHA256SUMS'), assets.map(file =>
  `${createHash('sha256').update(readFileSync(resolve(destination, file))).digest('hex')}  ${file}\n`).join(''));
console.log(`Release assets: ${destination}`);
