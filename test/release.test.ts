import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {checkRelease} from '../scripts/check-release.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'veritas-release-'));
  mkdirSync(join(root, 'charts/tasklattice-veritas'), {recursive: true});
  const write = (path: string, value: unknown) => writeFileSync(join(root, path), JSON.stringify(value));
  write('package.json', {version: '0.1.0'});
  write('package-lock.json', {version: '0.1.0', packages: {'': {version: '0.1.0'}}});
  write('charts/tasklattice-veritas/Chart.yaml', {version: '0.1.0', appVersion: '0.1.0'});
  write('charts/tasklattice-veritas/values.yaml', {image: {
    repository: 'ghcr.io/tasklattice/tasklattice-veritas', tag: '0.1.0',
  }});
  write('compose.yaml', {services: {veritas: {image: 'ghcr.io/tasklattice/tasklattice-veritas:0.1.0'}}});
  return {root, write, dispose: () => rmSync(root, {recursive: true, force: true})};
}

test('release preflight accepts consistent versions and rejects malformed or wrong tags', () => {
  const f = fixture();
  try {
    assert.equal(checkRelease(f.root), '0.1.0');
    assert.equal(checkRelease(f.root, 'v0.1.0'), '0.1.0');
    for (const tag of ['0.1.0', 'v00.1.0', 'v0.1.0-rc.1', 'v0.1.0/other', 'v0.1.1']) {
      assert.throws(() => checkRelease(f.root, tag));
    }
  } finally { f.dispose(); }
});

test('release preflight blocks stale deployment references and lockfiles', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['package-lock.json', {version: '0.1.0', packages: {'': {version: '0.2.0'}}}, /root package version/],
    ['charts/tasklattice-veritas/Chart.yaml', {version: '0.2.0', appVersion: '0.1.0'}, /chart version/],
    ['charts/tasklattice-veritas/values.yaml', {image: {tag: '0.1.0', repository: 'local-only'}}, /repository/],
    ['compose.yaml', {services: {veritas: {image: 'ghcr.io/tasklattice/tasklattice-veritas:latest'}}}, /Compose image/],
  ];
  for (const [file, contents, expected] of cases) {
    const f = fixture();
    try {
      f.write(file, contents);
      assert.throws(() => checkRelease(f.root, 'v0.1.0'), expected);
    } finally { f.dispose(); }
  }
});
