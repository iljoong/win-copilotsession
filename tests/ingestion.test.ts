import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '../src/server/data/store.js';
import {
  createIngestion,
  type IngestionService,
} from '../src/server/sources/ingestion.js';
import { readJsonlChunk } from '../src/server/sources/jsonl.js';

let root: string;
let store: Store;
let ingestion: IngestionService;
const filter = { sort: 'lastActivity' as const, offset: 0, limit: 50 };
function span(id: string) {
  return (
    JSON.stringify({
      spanId: id,
      name: 'chat test',
      attributes: {
        'gen_ai.conversation.id': 'session',
        'gen_ai.operation.name': 'chat',
        'gen_ai.usage.input_tokens': 100,
      },
    }) + '\n'
  );
}
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'copilot-ingest-'));
  store = openStore(join(root, 'app.db'));
  ingestion = createIngestion({ store, onChange: () => {} });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await ingestion.stop();
  store.close();
  await fs.rm(root, { recursive: true, force: true });
});
async function enable(path: string) {
  await ingestion.enableSource({
    id: 'source',
    kind: 'cli-telemetry',
    path,
    enabled: true,
  });
}
test('splitUtf8AndPartialLineWaitForCompletion', () => {
  const bytes = Buffer.from('{"text":"😀"}\n');
  const first = readJsonlChunk({
    pending: Buffer.alloc(0),
    chunk: bytes.subarray(0, 11),
  });
  expect(first.lines).toEqual([]);
  const second = readJsonlChunk({
    pending: first.pending,
    chunk: bytes.subarray(11),
  });
  expect(second.lines).toEqual(['{"text":"😀"}']);
});
test('restartResumesWithoutDuplicates', async () => {
  const path = join(root, 'telemetry.jsonl');
  await fs.writeFile(path, span('one'));
  await enable(path);
  await ingestion.scanNow();
  await ingestion.stop();
  ingestion = createIngestion({ store, onChange: () => {} });
  await fs.appendFile(path, span('two'));
  await ingestion.scanNow();
  expect(store.listSessions(filter).items[0].usage.input).toBe(200);
});
test('truncateAndRotateDoNotSkipRecords', async () => {
  const path = join(root, 'telemetry.jsonl');
  await fs.writeFile(path, span('one'));
  await enable(path);
  await ingestion.scanNow();
  await fs.writeFile(path, span('two'));
  await ingestion.scanNow();
  await fs.rename(path, join(root, 'old.jsonl'));
  await fs.writeFile(path, span('three'));
  await ingestion.scanNow();
  expect(store.listSessions(filter).items[0].usage.input).toBe(300);
});
test('disabledSourceIsNeverRead', async () => {
  const path = join(root, 'telemetry.jsonl');
  await fs.writeFile(path, span('one'));
  store.saveSource({
    id: 'source',
    kind: 'cli-telemetry',
    path,
    enabled: false,
  });
  await ingestion.scanNow();
  expect(store.listSessions(filter).total).toBe(0);
});
test('newCliSessionIsDiscovered', async () => {
  const path = join(root, 'history');
  await fs.mkdir(path);
  await ingestion.enableSource({
    id: 'source',
    kind: 'cli-history',
    path,
    enabled: true,
  });
  await fs.mkdir(join(path, 'new-session'));
  await fs.writeFile(
    join(path, 'new-session', 'events.jsonl'),
    JSON.stringify({
      id: 'prompt',
      type: 'user.message',
      data: { content: 'New session prompt' },
    }) + '\n',
  );
  await ingestion.scanNow();
  expect(store.listSessions({ ...filter, query: 'New session' }).total).toBe(1);
});
test('junctionOutsideRootIsRejected', async () => {
  const path = join(root, 'history');
  const outside = join(root, 'outside');
  await fs.mkdir(path);
  await fs.mkdir(outside);
  await fs.writeFile(
    join(outside, 'events.jsonl'),
    '{"id":"p","type":"user.message","data":{"content":"Outside"}}\n',
  );
  await fs.symlink(outside, join(path, 'linked'), 'junction');
  await ingestion.enableSource({
    id: 'source',
    kind: 'cli-history',
    path,
    enabled: true,
  });
  await ingestion.scanNow();
  expect(store.listSessions(filter).total).toBe(0);
  expect(store.listSources()[0].warnings.join(' ')).toMatch(
    /outside|boundary/i,
  );
});
test('permissionLossKeepsExistingHistory', async () => {
  const path = join(root, 'telemetry.jsonl');
  await fs.writeFile(path, span('one'));
  await enable(path);
  await ingestion.scanNow();
  vi.spyOn(fs, 'open').mockRejectedValueOnce(
    Object.assign(new Error('Denied'), { code: 'EACCES' }),
  );
  await ingestion.scanNow();
  expect(store.listSources()[0].error).toMatch(/access|permission/i);
  expect(store.listSessions(filter).total).toBe(1);
});
test('disappearedSourceRecoversWhenRestored', async () => {
  const path = join(root, 'telemetry.jsonl');
  await fs.writeFile(path, span('one'));
  await enable(path);
  await ingestion.scanNow();
  await fs.unlink(path);
  await ingestion.scanNow();
  expect(store.listSources()[0].error).not.toBeNull();
  await fs.writeFile(path, span('two'));
  await ingestion.scanNow();
  expect(store.listSources()[0].error).toBeNull();
  expect(store.listSessions(filter).items[0].usage.input).toBe(200);
});
test('oversizedRecordIsWarnedAndNextRecordStillImports', () => {
  let state = readJsonlChunk({
    pending: Buffer.alloc(0),
    chunk: Buffer.alloc(8 * 1024 * 1024, 97),
  });
  state = readJsonlChunk({
    pending: state.pending,
    chunk: Buffer.from('x\n{"ok":true}\n'),
    discarding: state.discarding,
  });
  expect(state.warnings.join(' ')).toMatch(/size|large|limit/i);
  expect(state.pending.length).toBeLessThan(8 * 1024 * 1024);
  expect(state.lines).toEqual(['{"ok":true}']);
});
test('partialJsonlResumesAcrossScans', async () => {
  const path = join(root, 'telemetry.jsonl');
  const line = span('one');
  await fs.writeFile(path, line.slice(0, 20));
  await enable(path);
  await ingestion.scanNow();
  expect(store.listSessions(filter).total).toBe(0);
  await fs.appendFile(path, line.slice(20));
  await ingestion.scanNow();
  expect(store.listSessions(filter).items[0].usage.input).toBe(100);
});
test('recordsAndCheckpointRollbackTogether', () => {
  const invalid = {
    kind: 'session',
    sourceId: 'source',
    eventId: 'one',
    namespace: 'cli',
    sessionRef: 's',
    timestamp: 1000,
    observedAt: 1n,
    model: null,
  } as unknown as import('../src/shared/contracts.js').NormalizedRecord;
  expect(() =>
    store.commitBatch(
      { records: [invalid], warnings: [] },
      { sourceId: 'source', value: 'bad' },
    ),
  ).toThrow();
  expect(store.getCheckpoint('source')).toBeNull();
  expect(store.listSessions(filter).total).toBe(0);
});
