import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  NormalizedRecord,
  SessionFilter,
} from '../src/shared/contracts.js';
import { openStore, type Store } from '../src/server/data/store.js';

const stores: Store[] = [];
const directories: string[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
function open(path = ':memory:') {
  const store = openStore(path);
  stores.push(store);
  return store;
}
const filter: SessionFilter = { sort: 'lastActivity', offset: 0, limit: 50 };
function entry(overrides: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return {
    kind: 'entry',
    role: 'original-user',
    text: 'Original prompt',
    truncated: false,
    sourceId: 'source',
    namespace: 'cli',
    sessionRef: 'native-id',
    eventId: 'prompt',
    model: null,
    timestamp: 1000,
    observedAt: 2000,
    ...overrides,
  } as NormalizedRecord;
}
test('reopenPreservesHistoryAndSearch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'copilot-store-'));
  directories.push(directory);
  const path = join(directory, 'data.db');
  const store = open(path);
  store.commitBatch(
    { records: [entry()], warnings: [] },
    { sourceId: 'source', value: 'checkpoint' },
  );
  stores.pop();
  store.close();
  const reopened = open(path);
  expect(reopened.listSessions({ ...filter, query: 'Original' }).total).toBe(1);
  expect(reopened.getCheckpoint('source')).toBe('checkpoint');
});
test('repeatBatchIsIdempotent', () => {
  const store = open();
  for (let n = 0; n < 2; n++)
    store.commitBatch({ records: [entry()], warnings: [] });
  const session = store.listSessions(filter).items[0];
  expect(store.getEntries(session.id, 0, 50).total).toBe(1);
});
test('sameNativeIdAcrossClientsStaysSeparate', () => {
  const store = open();
  store.commitBatch({
    records: [entry(), entry({ namespace: 'vscode', sourceId: 'editor' })],
    warnings: [],
  });
  expect(store.listSessions(filter).total).toBe(2);
});
test('verifiedOverlapCountsOnce', () => {
  const store = open();
  store.commitBatch({
    records: [entry(), entry({ sourceId: 'duplicate-source' })],
    warnings: [],
  });
  expect(store.listSessions(filter).total).toBe(1);
  expect(
    store.getEntries(store.listSessions(filter).items[0].id, 0, 50).total,
  ).toBe(1);
});
test('ambiguousOverlapIsExcludedFromCombinedTotals', () => {
  const store = open();
  const base = entry();
  store.commitBatch({
    records: [
      {
        ...base,
        kind: 'usage',
        usage: {
          id: 'snapshot',
          origin: 'vscode-import',
          scope: 'invocation',
          model: null,
          input: null,
          output: null,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
          aic: 2,
          start: null,
          end: null,
          combinedEligible: false,
        },
      },
    ],
    warnings: [],
  });
  expect(store.getUsage(filter)).toMatchObject({
    excluded: 1,
    totals: { aic: null },
  });
  expect(store.listSessions(filter).items[0].usage.aic).toBe(2);
});
test('promptSearchFindsTextAfter1000Characters', () => {
  const store = open();
  store.commitBatch({
    records: [entry({ text: `${'prefix '.repeat(200)}needle` })],
    warnings: [],
  });
  const page = store.listSessions({ ...filter, query: 'needle' });
  expect(page.total).toBe(1);
  expect(page.items[0].matchedEntryId).toBeDefined();
});
test('lateHistoryIsChronologicalAndSearchOffsetsUseTheSameOrder', () => {
  const store = open();
  store.commitBatch({
    records: [
      entry({ eventId: 'answer', role: 'assistant-preview', timestamp: 200 }),
      entry({
        eventId: 'prompt',
        text: 'chronological needle',
        timestamp: 100,
      }),
    ],
    warnings: [],
  });
  const session = store.listSessions({ ...filter, query: 'needle' }).items[0];
  expect(
    store.getEntries(session.id, 0, 50).items.map((row) => row.id),
  ).toEqual(['prompt', 'answer']);
  expect(session.matchedEntryOffset).toBe(0);
});
test('conversationSortRunsBeforePaginationAndSearchOffsets', () => {
  const store = open();
  store.commitBatch({
    records: [
      entry({ kind: 'session', eventId: 'start', title: 'Conversation title' }),
      entry({ eventId: 'old', text: 'old needle', timestamp: 100 }),
      entry({ eventId: 'prompt', timestamp: 200 }),
      entry({ eventId: 'answer', role: 'assistant-preview', timestamp: 200 }),
      entry({
        eventId: 'empty',
        role: 'assistant-preview',
        text: ' \n ',
        timestamp: 300,
      }),
      entry({ eventId: 'undated', timestamp: null }),
    ],
    warnings: [],
  });
  const session = store.listSessions({
    ...filter,
    query: 'needle',
    hideEmptyPreviews: true,
    entryOrder: 'desc',
  }).items[0];
  expect(session.matchedEntryOffset).toBe(2);
  expect(
    store.getEntries(session.id, 0, 2, true, 'desc').items.map((row) => row.id),
  ).toEqual(['answer', 'prompt']);
  expect(
    store.getEntries(session.id, 2, 2, true, 'desc').items.map((row) => row.id),
  ).toEqual(['old', 'undated']);
  expect(
    store.getEntries(session.id, 0, 50, true, 'asc').items.map((row) => row.id),
  ).toEqual(['old', 'prompt', 'answer', 'undated']);
});
test('searchPreservesOriginalCrlfAndWhitespace', () => {
  const store = open();
  const text = '\r\n  café e\u0301 😀\r\n';
  store.commitBatch({ records: [entry({ text })], warnings: [] });
  const session = store.listSessions({ ...filter, query: 'café' }).items[0];
  expect(store.getEntries(session.id, 0, 50).items[0].text).toBe(text);
});
test('searchOperatorsAreTreatedAsText', () => {
  const store = open();
  store.commitBatch({ records: [entry()], warnings: [] });
  expect(() =>
    store.listSessions({ ...filter, query: '" OR NOT *' }),
  ).not.toThrow();
});
test('clearLeavesSourceFilesUntouchedAndDisablesSources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'copilot-clear-'));
  directories.push(directory);
  const path = join(directory, 'source.jsonl');
  await writeFile(path, 'keep');
  const store = open();
  store.saveSource({
    id: 'source',
    kind: 'cli-telemetry',
    path,
    enabled: true,
  });
  store.commitBatch({ records: [entry()], warnings: [] });
  store.clearLocalData();
  expect(store.listSessions(filter).total).toBe(0);
  expect(store.listSources()[0].enabled).toBe(false);
  expect(await readFile(path, 'utf8')).toBe('keep');
});
test('capturedContextIsNotPersistedOrIndexed', () => {
  const store = open();
  store.commitBatch({
    records: [entry({ role: 'captured-context', text: 'secret context' })],
    warnings: [],
  });
  expect(store.listSessions({ ...filter, query: 'secret' }).total).toBe(0);
});

test('combinedTotalsRetainIndependentClientSessions', () => {
  const store = open();
  const base = entry();
  const usage = {
    id: 'call',
    scope: 'call' as const,
    model: 'model',
    start: null,
    end: null,
    input: 100,
    output: 20,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    aic: null,
  };
  store.commitBatch({
    records: [
      { ...base, kind: 'usage', usage: { ...usage, origin: 'cli-history' } },
      {
        ...base,
        namespace: 'vscode',
        sourceId: 'editor',
        kind: 'usage',
        usage: { ...usage, origin: 'vscode-telemetry' },
      },
    ],
    warnings: [],
  });
  expect(store.getUsage(filter).totals.input).toBe(200);
});
test('sourceTotalsMarkMissingSessionMetricsPartial', () => {
  const store = open();
  const base = entry({ namespace: 'vscode', sourceId: 'editor' });
  store.commitBatch({
    records: [
      {
        ...base,
        kind: 'usage',
        usage: {
          id: 'call',
          scope: 'call',
          origin: 'vscode-telemetry',
          model: null,
          start: null,
          end: null,
          input: 100,
          output: null,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
          aic: null,
        },
      },
      entry({ namespace: 'vscode', sourceId: 'editor', sessionRef: 'missing' }),
    ],
    warnings: [],
  });
  const report = store.getUsage(filter);
  expect(report.totals.input).toBe(100);
  expect(report.sources[0].usage.coverage.input).toBe('partial');
});
