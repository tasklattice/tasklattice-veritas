import {readFileSync, statSync} from 'node:fs';
import type {Adapter} from '../shared/types.js';

type SnapshotMetadata = {createdAt?: string; adapter?: Adapter; evidence?: string; datasetIds: string[]};

/** Keep list polling independent of the number and size of recorded request payloads. */
export class SnapshotMetadataCache {
  private entries = new Map<string, {signature: string; value: SnapshotMetadata}>();
  get(path: string): SnapshotMetadata | null {
    let stat;
    try {stat = statSync(path);} catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.entries.delete(path); return null;
    }
    const signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const cached = this.entries.get(path);
    if (cached?.signature === signature) return cached.value;
    const snapshot = JSON.parse(readFileSync(path, 'utf8'));
    const value: SnapshotMetadata = {createdAt: snapshot.createdAt, adapter: snapshot.target?.adapter,
      evidence: snapshot.evidence, datasetIds: [...new Set<string>((snapshot.cases ?? []).map((c: {dataset: string}) => c.dataset))]};
    this.entries.set(path, {signature, value});
    return value;
  }
}
