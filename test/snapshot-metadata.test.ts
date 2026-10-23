import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SnapshotMetadataCache} from '../src/server/snapshot-metadata.js';

test('report list cache retains metadata only and refreshes rewritten or recreated snapshots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veritas-snapshot-'));
  try {
    const path = join(dir, 'snapshot.json'), cache = new SnapshotMetadataCache();
    assert.equal(cache.get(path), null);
    writeFileSync(path, JSON.stringify({createdAt: '2026-10-23', target:{adapter:'f5-scan'}, evidence:'endpoint',
      cases:[{dataset:'creddata', text:'x'.repeat(1000000)}, {dataset:'creddata'}, {dataset:'aegis'}]}));
    const first = cache.get(path);
    assert.deepEqual(first, {createdAt:'2026-10-23', adapter:'f5-scan', evidence:'endpoint',datasetIds:['creddata','aegis']});
    assert.strictEqual(cache.get(path), first);
    writeFileSync(path, JSON.stringify({cases:[{dataset:'wildjailbreak'}]}));
    assert.deepEqual(cache.get(path)?.datasetIds, ['wildjailbreak']);
    rmSync(path); assert.equal(cache.get(path), null);
    writeFileSync(path, JSON.stringify({cases:[{dataset:'creddata'}]}));
    assert.deepEqual(cache.get(path)?.datasetIds, ['creddata']);
  } finally {rmSync(dir, {recursive:true, force:true});}
});
