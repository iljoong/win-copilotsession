import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type {
  NormalizedBatch,
  SourceConfig,
  SourceStatus,
  StoreChange,
} from '../../shared/contracts.js';
import type { Store } from '../data/store.js';
import { parseCliRecord } from './cli.js';
import { parseTelemetryRecord } from './telemetry.js';
import { readJsonlChunk } from './jsonl.js';

export interface IngestionService {
  enableSource(config: SourceConfig): Promise<void>;
  disableSource(id: string): Promise<void>;
  scanNow(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}
type Cursor = {
  identity: string;
  offset: number;
  pending: string;
  discarding: boolean;
  prefix: string;
  prefixLength: number;
  modified: number;
};
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
function inside(root: string, file: string) {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
function sourceError(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'EACCES' || code === 'EPERM')
    return 'Permission denied. Check read access to this source.';
  if (code === 'ENOENT')
    return 'Source is unavailable. It will be retried automatically.';
  return 'Source could not be read. Check its path, file type, and permissions.';
}

export function createIngestion(options: {
  store: Store;
  onChange: (change: StoreChange) => void;
  pollMs?: number;
}): IngestionService {
  let timer: ReturnType<typeof setInterval> | null = null;
  let flight: Promise<void> | null = null;
  let halted = false;
  const { store } = options;
  type Reader = {
    handle: FileHandle;
    identity: string;
    key: string;
    sourceId: string;
  };
  const readers = new Map<string, Reader>();
  const rotationWarning =
    'Source changed while its previous file was unavailable; unread rotated records may be unavailable.';
  const fileIdentity = (stat: {
    dev: number;
    ino: number;
    birthtimeMs: number;
  }) => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;

  async function closeReaders(sourceId?: string) {
    for (const [key, reader] of readers) {
      if (sourceId && reader.sourceId !== sourceId) continue;
      readers.delete(key);
      await reader.handle.close();
    }
  }
  async function recoverRotated(
    file: string,
    root: string,
    identity: string,
  ): Promise<FileHandle | null> {
    const entries = await fs.readdir(dirname(file), { withFileTypes: true });
    for (const entry of entries.slice(0, 1000)) {
      if (!entry.isFile()) continue;
      let candidate: FileHandle | null = null;
      try {
        const path = await fs.realpath(join(dirname(file), entry.name));
        if (
          !inside(root, path) ||
          fileIdentity(await fs.stat(path)) !== identity
        )
          continue;
        candidate = await fs.open(path, 'r');
        if (fileIdentity(await candidate.stat()) === identity) return candidate;
      } catch {
        /* Missing or inaccessible rotated identities are reported by the caller. */
      }
      await candidate?.close();
    }
    return null;
  }

  async function tail(
    source: SourceConfig,
    file: string,
    root: string,
    sessionRef?: string,
  ): Promise<string[]> {
    const resolved = await fs.realpath(file);
    if (!inside(root, resolved))
      return ['Source link points outside the configured boundary; skipped.'];
    const handle = await fs.open(resolved, 'r');
    let retained = false;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Expected regular file');
      const key = `${source.id}:${resolved}`;
      const readerKey = `${source.id}:${file}`;
      const identity = fileIdentity(stat);
      let previous = readers.get(readerKey);
      const saved = store.getCheckpoint(key);
      const oldIdentity = saved ? (JSON.parse(saved) as Cursor).identity : null;
      if (!previous && oldIdentity && oldIdentity !== identity) {
        const rotated = await recoverRotated(resolved, root, oldIdentity);
        if (rotated) {
          previous = {
            handle: rotated,
            identity: oldIdentity,
            key,
            sourceId: source.id,
          };
          readers.set(readerKey, previous);
        }
      }
      const warnings: string[] = [];
      let drained = false;
      if (previous && previous.identity !== identity) {
        const old = await read(
          previous.handle,
          source,
          previous.key,
          sessionRef,
        );
        warnings.push(...old.warnings);
        if (!old.complete) return warnings;
        if (old.partial)
          warnings.push(
            `${rotationWarning} An incomplete record remained in the rotated file.`,
          );
        drained = true;
      }
      if (previous) {
        readers.delete(readerKey);
        await previous.handle.close();
      }
      readers.set(readerKey, { handle, identity, key, sourceId: source.id });
      retained = true;
      const result = await read(handle, source, key, sessionRef, drained);
      return [...new Set([...warnings, ...result.warnings])].slice(0, 30);
    } finally {
      if (!retained) await handle.close();
    }
  }
  async function read(
    handle: FileHandle,
    source: SourceConfig,
    key: string,
    sessionRef?: string,
    drained = false,
  ) {
    const stat = await handle.stat();
    const saved = store.getCheckpoint(key);
    let cursor: Cursor | null = saved ? (JSON.parse(saved) as Cursor) : null;
    const identity = fileIdentity(stat);
    const initialWarnings =
      cursor && cursor.identity !== identity && !drained
        ? [rotationWarning]
        : [];
    const prefixLength = cursor?.prefixLength ?? Math.min(64, stat.size);
    const prefixBuffer = Buffer.alloc(prefixLength);
    await handle.read(prefixBuffer, 0, prefixLength, 0);
    if (
      cursor &&
      (cursor.identity !== identity ||
        stat.size < cursor.offset ||
        cursor.prefix !== hash(prefixBuffer) ||
        (stat.size === cursor.offset && cursor.modified !== stat.mtimeMs))
    )
      cursor = null;
    const state: Cursor = cursor ?? {
      identity,
      offset: 0,
      pending: '',
      discarding: false,
      prefix: hash(prefixBuffer),
      prefixLength,
      modified: stat.mtimeMs,
    };
    const warnings = [...initialWarnings];
    let chunks = 0;
    while (state.offset < stat.size && !halted && chunks++ < 128) {
      const buffer = Buffer.alloc(
        Math.min(64 * 1024, stat.size - state.offset),
      );
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        state.offset,
      );
      if (!bytesRead) break;
      const decoded = readJsonlChunk({
        pending: Buffer.from(state.pending, 'base64'),
        chunk: buffer.subarray(0, bytesRead),
        discarding: state.discarding,
      });
      const batch: NormalizedBatch = {
        records: [],
        warnings: [...initialWarnings, ...decoded.warnings],
      };
      for (const line of decoded.lines) {
        if (!line.trim()) continue;
        try {
          const value: unknown = JSON.parse(line.replace(/^\uFEFF/, ''));
          const context = {
            sourceId: source.id,
            sessionRef,
            recordId: hash(`${key}:${line}`),
            observedAt: Date.now(),
          };
          const parsed =
            source.kind === 'cli-history'
              ? parseCliRecord(value, context)
              : parseTelemetryRecord(
                  value,
                  context,
                  source.kind === 'cli-telemetry' ? 'cli' : 'vscode',
                );
          batch.records.push(...parsed.records);
          batch.warnings.push(...parsed.warnings);
        } catch {
          batch.warnings.push('Malformed complete JSONL record skipped.');
        }
      }
      const next: Cursor = {
        ...state,
        offset: state.offset + bytesRead,
        pending: decoded.pending.toString('base64'),
        discarding: decoded.discarding,
        modified: stat.mtimeMs,
      };
      const change = store.commitBatch(batch, {
        sourceId: key,
        value: JSON.stringify(next),
      });
      Object.assign(state, next);
      warnings.push(...batch.warnings);
      if (change.sessionIds.length) options.onChange(change);
    }
    if (state.offset < stat.size)
      warnings.push('Initial history catch-up is still in progress.');
    if (!cursor && !stat.size)
      store.commitBatch(
        { records: [], warnings: [] },
        { sourceId: key, value: JSON.stringify(state) },
      );
    return {
      warnings: [...new Set(warnings)].slice(0, 30),
      complete: state.offset >= stat.size,
      partial: !!state.pending,
    };
  }
  function updateStatus(
    source: SourceStatus,
    update: Parameters<Store['setSourceStatus']>[1],
  ) {
    store.setSourceStatus(source.id, update);
    if (
      (update.error !== undefined && update.error !== source.error) ||
      (update.warnings !== undefined &&
        JSON.stringify(update.warnings) !== JSON.stringify(source.warnings)) ||
      (source.lastSuccessAt === null && update.lastSuccessAt !== undefined)
    )
      options.onChange({ sourceIds: [source.id], sessionIds: [] });
  }
  async function scan() {
    for (const source of store.listSources()) {
      if (halted) break;
      if (!source.enabled || source.kind === 'vscode-import') continue;
      try {
        const warnings = source.warnings.filter((value) =>
          value.startsWith(rotationWarning),
        );
        if (source.kind === 'cli-history') {
          const root = await fs.realpath(source.path);
          const entries = await fs.readdir(root, { withFileTypes: true });
          for (const entry of entries) {
            if (halted) break;
            if (
              (!entry.isDirectory() && !entry.isSymbolicLink()) ||
              entry.name.startsWith('.')
            )
              continue;
            const directory = await fs.realpath(join(root, entry.name));
            if (!inside(root, directory)) {
              warnings.push(
                'Session link points outside the configured boundary; skipped.',
              );
              continue;
            }
            const file = join(directory, 'events.jsonl');
            try {
              warnings.push(
                ...(await tail(source, file, root, basename(directory))),
              );
            } catch (error) {
              if (
                error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 'ENOENT'
              )
                continue;
              throw error;
            }
          }
        } else {
          const root = await fs.realpath(dirname(source.path));
          warnings.push(...(await tail(source, source.path, root)));
        }
        updateStatus(source, {
          error: null,
          lastSuccessAt: Date.now(),
          warnings: [...new Set(warnings)].slice(0, 30),
        });
      } catch (error) {
        updateStatus(source, { error: sourceError(error) });
      }
    }
  }
  const service: IngestionService = {
    async enableSource(config) {
      if (!isAbsolute(config.path))
        throw new Error('Choose an absolute source path.');
      if (config.kind === 'vscode-import')
        throw new Error('Import chat snapshots through the import action.');
      await flight;
      await closeReaders(config.id);
      store.saveSource({ ...config, enabled: true });
      await service.scanNow();
    },
    async disableSource(id) {
      const source = store.listSources().find((item) => item.id === id);
      if (source) store.saveSource({ ...source, enabled: false });
      await flight;
      await closeReaders(id);
    },
    scanNow() {
      if (halted) return Promise.resolve();
      if (!flight)
        flight = scan().finally(() => {
          flight = null;
        });
      return flight;
    },
    start() {
      halted = false;
      if (!timer) {
        timer = setInterval(() => {
          void service.scanNow();
        }, options.pollMs ?? 1000);
        void service.scanNow();
      }
    },
    async stop() {
      halted = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await flight;
      await closeReaders();
    },
  };
  return service;
}
