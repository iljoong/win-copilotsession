import { beforeEach, afterEach, expect, test } from 'vitest';
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createHttpServer } from '../src/server/http.js';
import { createApi } from '../src/server/routes.js';
import { createEventHub, type EventHub } from '../src/server/events.js';
import {
  createIngestion,
  type IngestionService,
} from '../src/server/sources/ingestion.js';
import { openStore, type Store } from '../src/server/data/store.js';
import { prepareDataDirectory } from '../src/server/storage.js';

let server: Server;
let store: Store;
let ingestion: IngestionService;
let events: EventHub;
let root: string;
let origin: string;
let cookie: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'copilot-api-'));
  store = openStore(':memory:');
  events = createEventHub();
  ingestion = createIngestion({
    store,
    onChange: (change) => events.publish(change),
  });
  server = createHttpServer({
    accessToken: 'test',
    assetDir: root,
    handleApi: createApi({ store, ingestion, events }),
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No TCP address');
  origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${origin}/?token=test`, { redirect: 'manual' });
  cookie = response.headers.get('set-cookie')!.split(';')[0];
});
afterEach(async () => {
  await ingestion.stop();
  events.close();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  store.close();
  await rm(root, { recursive: true, force: true });
});
function call(
  path: string,
  method = 'GET',
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return fetch(origin + path, {
    method,
    headers: { cookie, origin, 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function imported() {
  const fixture = JSON.parse(
    await readFile(
      new URL('./fixtures/vscode-export.json', import.meta.url),
      'utf8',
    ),
  );
  return call('/api/imports/vscode', 'POST', fixture);
}
test('paginationAndFilterValidation', async () => {
  for (const query of [
    'limit=201',
    'offset=-1',
    'state=made-up',
    'sort=bad',
    'from=100&to=10',
  ]) {
    expect((await call(`/api/sessions?${query}`)).status).toBe(400);
  }
  expect((await call('/api/sessions/absent')).status).toBe(404);
});
test('repeatedJsonImportIsIdempotent', async () => {
  expect((await imported()).status).toBe(201);
  expect((await imported()).status).toBe(201);
  const page = await (await call('/api/sessions')).json();
  expect(page.total).toBe(1);
  const entries = await (
    await call(`/api/sessions/${page.items[0].id}/entries`)
  ).json();
  expect(entries.total).toBe(2);
});
test('unsupportedImportCommitsNothingAndDoesNotEchoContent', async () => {
  const response = await call('/api/imports/vscode', 'POST', {
    secret: 'do-not-echo',
  });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain('do-not-echo');
  expect((await (await call('/api/sources')).json()).length).toBe(0);
});
test('disabledSourcesDoNotScan', async () => {
  const path = join(root, 'history');
  await mkdir(path);
  expect(
    (
      await call('/api/sources/example', 'PUT', {
        kind: 'cli-history',
        path,
        enabled: false,
      })
    ).status,
  ).toBe(200);
  expect(store.listSources()[0].enabled).toBe(false);
  expect((await (await call('/api/sessions')).json()).total).toBe(0);
});
test('clearRequiresExactConfirmation', async () => {
  await imported();
  expect(
    (await call('/api/local-data/clear', 'POST', { confirmation: 'yes' }))
      .status,
  ).toBe(400);
  expect(
    (
      await call('/api/local-data/clear', 'POST', {
        confirmation: 'CLEAR LOCAL DASHBOARD DATA',
      })
    ).status,
  ).toBe(200);
  expect((await (await call('/api/sessions')).json()).total).toBe(0);
});
test('clearingDuringScanCannotRepopulateHistory', async () => {
  const path = join(root, 'telemetry.jsonl');
  const data = await readFile(
    new URL('./fixtures/cli-telemetry.jsonl', import.meta.url),
    'utf8',
  );
  await writeFile(path, data.repeat(2000));
  store.saveSource({
    id: 'source',
    kind: 'cli-telemetry',
    path,
    enabled: true,
  });
  const scanning = ingestion.scanNow();
  await call('/api/local-data/clear', 'POST', {
    confirmation: 'CLEAR LOCAL DASHBOARD DATA',
  });
  await scanning;
  await ingestion.scanNow();
  expect(
    store.listSessions({ sort: 'lastActivity', offset: 0, limit: 50 }).total,
  ).toBe(0);
  expect(store.listSources()[0].enabled).toBe(false);
});
test('foreignOriginMutationsAreRejected', async () => {
  expect(
    (
      await call(
        '/api/imports/vscode',
        'POST',
        {},
        { origin: 'https://other.example' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        '/api/local-data/clear',
        'POST',
        { confirmation: 'CLEAR LOCAL DASHBOARD DATA' },
        { origin: 'https://other.example' },
      )
    ).status,
  ).toBe(403);
});
test('sseNotificationsContainIdsNotTranscriptsAndDisconnectCleanly', async () => {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/events`, {
    headers: { cookie },
    signal: controller.signal,
  });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  await reader.read();
  events.publish({ sessionIds: ['session-one'], sourceIds: ['source-one'] });
  const chunk = await reader.read();
  const text = new TextDecoder().decode(chunk.value);
  expect(text).toContain('session-one');
  expect(text).not.toContain('Original prompt');
  controller.abort();
  events.publish({ sessionIds: ['later'], sourceIds: [] });
  expect((await call('/api/sessions')).status).toBe(200);
});
test('slowSseClientDoesNotBlockIngestion', async () => {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/events`, {
    headers: { cookie },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  await reader.read();
  events.publish({ sessionIds: ['x'.repeat(70 * 1024)], sourceIds: [] });
  expect((await imported()).status).toBe(201);
  controller.abort();
});
test('dataDirectoryDoesNotAdoptUnrelatedExistingFiles', async () => {
  await mkdir(join(root, 'dashboard-data'));
  await writeFile(join(root, 'dashboard-data', 'unrelated.txt'), 'keep');
  await expect(prepareDataDirectory(root)).rejects.toThrow(
    /dedicated|owned|empty/i,
  );
  expect(
    await readFile(join(root, 'dashboard-data', 'unrelated.txt'), 'utf8'),
  ).toBe('keep');
});
