import { beforeEach, afterEach, expect, test } from 'vitest';
import {
  readFile,
  readdir,
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  symlink,
} from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
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
async function todoSession(sessionRef = 'todo-session') {
  const history = join(root, 'history');
  const directory = join(history, sessionRef);
  await mkdir(directory, { recursive: true });
  store.saveSource({
    id: 'cli',
    kind: 'cli-history',
    path: history,
    enabled: true,
  });
  const { sessionIds } = store.commitBatch({
    records: [
      {
        sourceId: 'cli',
        namespace: 'cli',
        sessionRef,
        eventId: sessionRef,
        kind: 'session',
        timestamp: 1000,
        observedAt: 1000,
        model: null,
        title: sessionRef,
      },
    ],
    warnings: [],
  });
  return { id: sessionIds[0], directory, file: join(directory, 'session.db') };
}
test('todosReadSelectedIdentityAndLiveWalWithoutChangingSources', async () => {
  const first = await todoSession();
  const other = await todoSession('other-session');
  const db = new DatabaseSync(first.file);
  const otherDb = new DatabaseSync(other.file);
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE todos(id TEXT PRIMARY KEY, created_at TEXT, title TEXT, status TEXT, secret TEXT);
      INSERT INTO todos VALUES ('b','2026-11-17 01:00:00','Second','in_progress','not-returned'),
        ('a','2026-11-17 01:00:00','<img src=x onerror=alert(1)>','done','not-returned');`);
    otherDb.exec(`CREATE TABLE todos(id TEXT, created_at TEXT, title TEXT, status TEXT);
      INSERT INTO todos VALUES ('foreign',NULL,'Other session','pending');`);
    const names = await readdir(first.directory);
    const before = await Promise.all(
      names.map((name) => readFile(join(first.directory, name))),
    );
    const response = await call(
      `/api/sessions/${first.id}/todos?offset=0&limit=1`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      availability: 'available',
      message: null,
      items: [
        {
          id: 'b',
          created_at: '2026-11-17 01:00:00',
          updated_at: null,
          title: 'Second',
          status: 'in_progress',
        },
      ],
      total: 2,
      completed: 1,
      offset: 0,
      limit: 1,
    });
    expect(await readdir(first.directory)).toEqual(names);
    for (const [index, name] of names.entries())
      expect(await readFile(join(first.directory, name))).toEqual(
        before[index],
      );
    db.exec(
      "UPDATE todos SET status='blocked' WHERE id='b'; DELETE FROM todos WHERE id='a';",
    );
    const updated = await (
      await call(`/api/sessions/${first.id}/todos`)
    ).json();
    expect(updated.items).toEqual([
      {
        id: 'b',
        created_at: '2026-11-17 01:00:00',
        updated_at: null,
        title: 'Second',
        status: 'blocked',
      },
    ]);
    expect(updated.total).toBe(1);
    expect(updated.completed).toBe(0);
    for (const query of ['limit=201', 'offset=-1'])
      expect(
        (await call(`/api/sessions/${first.id}/todos?${query}`)).status,
      ).toBe(400);
  } finally {
    db.close();
    otherDb.close();
  }
});
test('todosDistinguishEmptyMissingUnsupportedAndDisabledSources', async () => {
  const session = await todoSession();
  const url = `/api/sessions/${session.id}/todos`;
  expect((await (await call(url)).json()).availability).toBe('unavailable');
  expect(await readdir(session.directory)).toEqual([]);
  const db = new DatabaseSync(session.file);
  try {
    db.exec('CREATE TABLE unrelated(secret TEXT)');
    expect((await (await call(url)).json()).availability).toBe('unavailable');
    db.exec(
      'CREATE TABLE todo(id TEXT, created_at TEXT, title TEXT, status TEXT)',
    );
    expect(await (await call(url)).json()).toMatchObject({
      availability: 'available',
      total: 0,
      completed: 0,
      items: [],
    });
    db.exec("INSERT INTO todo VALUES ('legacy',NULL,'Legacy','custom_status')");
    expect((await (await call(url)).json()).items[0]).toEqual({
      id: 'legacy',
      created_at: null,
      updated_at: null,
      title: 'Legacy',
      status: 'custom_status',
    });
    const source = store.listSources()[0];
    store.saveSource({ ...source, enabled: false });
    expect((await (await call(url)).json()).availability).toBe('unavailable');
    store.saveSource({ ...source, enabled: true });
    db.exec('DROP TABLE todo; CREATE TABLE todos(id TEXT)');
    const unsupported = await (await call(url)).json();
    expect(unsupported.availability).toBe('unavailable');
    expect(JSON.stringify(unsupported)).not.toContain(session.file);
  } finally {
    db.close();
  }
  await writeFile(session.file, 'not a SQLite database');
  expect((await (await call(url)).json()).availability).toBe('unavailable');
  await imported();
  const importedSession = store
    .listSessions({
      sort: 'lastActivity',
      offset: 0,
      limit: 50,
    })
    .items.find((item) => item.snapshot)!;
  expect(
    (await (await call(`/api/sessions/${importedSession.id}/todos`)).json())
      .availability,
  ).toBe('unavailable');
});
test('todoCompletionCountsAllPagesAndOrdersNewestFirstWithUndatedLast', async () => {
  const session = await todoSession();
  const db = new DatabaseSync(session.file);
  try {
    db.exec(`CREATE TABLE todos(id TEXT, created_at INTEGER, title TEXT, status TEXT);
      INSERT INTO todos VALUES ('undated',NULL,'Undated','done'),
        ('tie-a',2,'Tie A','completed'), ('tie-b',2,'Tie B','in_progress'),
        ('older',1,'Older','done'), ('newest',3,'Newest','Done');`);
    const url = `/api/sessions/${session.id}/todos?limit=2`;
    const first = await (await call(url)).json();
    expect(first).toMatchObject({ total: 5, completed: 2 });
    expect(first.items.map((row: { id: string }) => row.id)).toEqual([
      'newest',
      'tie-b',
    ]);
    const second = await (await call(`${url}&offset=2`)).json();
    expect(second).toMatchObject({ total: 5, completed: 2 });
    expect(second.items.map((row: { id: string }) => row.id)).toEqual([
      'tie-a',
      'older',
    ]);
    const last = await (await call(`${url}&offset=4`)).json();
    expect(last.items.map((row: { id: string }) => row.id)).toEqual([
      'undated',
    ]);
  } finally {
    db.close();
  }
});
test('todosRejectEscapingSessionAndDatabaseLinks', async () => {
  const session = await todoSession();
  const outside = join(root, 'outside');
  await mkdir(outside);
  const db = new DatabaseSync(join(outside, 'session.db'));
  db.exec(`CREATE TABLE todos(id TEXT, created_at TEXT, title TEXT, status TEXT);
    INSERT INTO todos VALUES ('secret',NULL,'Never expose','pending')`);
  db.close();
  await rm(session.directory, { recursive: true });
  await symlink(outside, session.directory, 'junction');
  const response = await (
    await call(`/api/sessions/${session.id}/todos`)
  ).json();
  expect(response.availability).toBe('unavailable');
  expect(JSON.stringify(response)).not.toContain('Never expose');
  await rm(session.directory);
  await mkdir(session.directory);
  await symlink(join(outside, 'session.db'), session.file, 'file');
  expect(
    (await (await call(`/api/sessions/${session.id}/todos`)).json())
      .availability,
  ).toBe('unavailable');
});
test('todoGroupsUseDependenciesAndWholeSessionCountsWithSourceClockSpans', async () => {
  const session = await todoSession();
  const db = new DatabaseSync(session.file);
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE todos(id TEXT, created_at TEXT, updated_at TEXT, title TEXT, status TEXT);
      CREATE TABLE todo_deps(todo_id TEXT, depends_on TEXT);
      INSERT INTO todos VALUES
        ('job-design','2026-11-17 04:18:07','2026-11-17 04:18:31','Design','done'),
        ('job-backend','2026-11-17 04:18:07','2026-11-17 04:20:39','Backend','in_progress'),
        ('job-ux','2026-11-17 04:18:07','2026-11-17 04:20:39','UX','done'),
        ('job-verify','2026-11-17 04:18:07','2026-11-17 04:21:15','Verify','blocked'),
        ('standalone','2026-11-17 04:19:00','2026-11-17 04:20:00','Separate','done');
      INSERT INTO todo_deps VALUES ('job-backend','job-design'),
        ('job-ux','job-design'),('job-verify','job-backend'),('job-verify','job-ux'),
        ('job-verify','job-ux');`);
    const names = await readdir(session.directory);
    const before = await Promise.all(
      names.map((name) => readFile(join(session.directory, name))),
    );
    const url = `/api/sessions/${session.id}/todo-groups?limit=1`;
    const response = await call(url);
    expect(response.status).toBe(200);
    const groups = await response.json();
    expect(groups).toMatchObject({
      availability: 'available',
      dependenciesAvailable: true,
      total: 2,
      taskTotal: 5,
      completed: 3,
      detail: null,
    });
    expect(groups.items[0]).toMatchObject({
      label: 'job',
      total: 4,
      completed: 2,
      statuses: { done: 2, in_progress: 1, blocked: 1 },
      createdAt: '2026-11-17 04:18:07',
      updatedAt: '2026-11-17 04:21:15',
      spanMs: 188000,
      warnings: [],
    });
    const expanded = await (
      await call(`${url}&group=${groups.items[0].id}`)
    ).json();
    expect(expanded.detail).toMatchObject({ total: 4, offset: 0, limit: 50 });
    expect(expanded.detail.graph.edges).toHaveLength(4);
    expect(expanded.detail.graph.edges).toContainEqual({
      todo_id: 'job-backend',
      depends_on: 'job-design',
    });
    expect(expanded.detail.items.map((row: { id: string }) => row.id)).toEqual([
      'job-verify',
      'job-ux',
      'job-design',
      'job-backend',
    ]);
    const byCreation = await (await call(`${url}&groupOrder=created`)).json();
    expect(byCreation.items[0]).toMatchObject({ label: 'Separate', total: 1 });
    const second = await (await call(`${url}&offset=1`)).json();
    expect(second.items[0]).toMatchObject({ label: 'Separate', total: 1 });
    const flat = await (await call(`/api/sessions/${session.id}/todos`)).json();
    expect(
      flat.items.find((row: { id: string }) => row.id === 'job-design')
        .updated_at,
    ).toBe('2026-11-17 04:18:31');
    expect(await readdir(session.directory)).toEqual(names);
    for (const [index, name] of names.entries())
      expect(await readFile(join(session.directory, name))).toEqual(
        before[index],
      );
    for (const query of [
      'groupOrder=bad',
      'group=../../other',
      'taskOffset=-1',
    ])
      expect((await call(`${url}&${query}`)).status).toBe(400);
  } finally {
    db.close();
  }
});
test('todoGroupsKeepIncompleteDependenciesAndTimesTruthful', async () => {
  const session = await todoSession();
  const db = new DatabaseSync(session.file);
  const url = `/api/sessions/${session.id}/todo-groups`;
  try {
    db.exec(`CREATE TABLE todos(id TEXT, created_at TEXT, updated_at TEXT, title TEXT, status TEXT);
      CREATE TABLE todo_deps(todo_id TEXT, depends_on TEXT);
      INSERT INTO todos VALUES
        ('a','2026-11-17 01:00:00','2026-11-17 01:00:00','A','done'),
        ('b','2026-11-17 01:00:00','2026-11-17 01:01:00','B','custom'),
        ('invalid','2026-11-17 01:00:00','2026-11-17 00:59:00','Invalid','pending'),
        ('mixed','2026-11-17 01:00:00','2026-11-17T01:01:00Z','Mixed','pending');
      INSERT INTO todo_deps VALUES ('a','b'),('b','a'),('a','missing');`);
    const result = await (await call(url)).json();
    expect(result).toMatchObject({ total: 3, taskTotal: 4, completed: 1 });
    const cycle = result.items.find(
      (group: { total: number }) => group.total === 2,
    );
    expect(cycle.warnings.join(' ')).toMatch(/cycl/i);
    expect(cycle.warnings.join(' ')).toMatch(/missing/i);
    const detail = await (await call(`${url}?group=${cycle.id}`)).json();
    expect(detail.detail.graph).toBeNull();
    expect(detail.detail.graphMessage).toMatch(/cycl/i);
    for (const label of ['Invalid', 'Mixed'])
      expect(
        result.items.find((group: { label: string }) => group.label === label)
          .spanMs,
      ).toBeNull();
    db.exec("DELETE FROM todo_deps; DELETE FROM todos WHERE id != 'a'");
    const equal = await (await call(url)).json();
    expect(equal.items[0]).toMatchObject({ spanMs: 0, warnings: [] });
    db.exec('DROP TABLE todo_deps; ALTER TABLE todos DROP COLUMN updated_at;');
    const legacy = await (await call(url)).json();
    expect(legacy).toMatchObject({
      availability: 'available',
      dependenciesAvailable: false,
      taskTotal: 1,
    });
    expect(legacy.message).toMatch(/dependenc/i);
    expect(legacy.items[0]).toMatchObject({ updatedAt: null, spanMs: null });
  } finally {
    db.close();
  }
});
test('todoGroupsWarnWhenGroupOrderingUsesDifferentSourceClocks', async () => {
  const session = await todoSession();
  const db = new DatabaseSync(session.file);
  try {
    db.exec(`CREATE TABLE todos(id TEXT, created_at TEXT, updated_at TEXT, title TEXT, status TEXT);
      CREATE TABLE todo_deps(todo_id TEXT, depends_on TEXT);
      INSERT INTO todos VALUES
        ('source-clock','2026-11-17 01:00:00','2026-11-17 01:01:00','Source clock','done'),
        ('instant','2026-11-17T01:00:00Z','2026-11-17T01:02:00Z','Instant','done');`);
    const data = await (
      await call(`/api/sessions/${session.id}/todo-groups`)
    ).json();
    expect(data.dependenciesAvailable).toBe(true);
    expect(data.message).toMatch(/different clock/i);
    expect(
      data.items.map((group: { spanMs: number }) => group.spanMs).sort(),
    ).toEqual([120000, 60000]);
  } finally {
    db.close();
  }
});
test('todoGroupsJoinAcrossPagesAndRefuseTruncatedComponents', async () => {
  const session = await todoSession();
  const db = new DatabaseSync(session.file);
  const url = `/api/sessions/${session.id}/todo-groups`;
  try {
    db.exec(`CREATE TABLE todos(id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, title TEXT, status TEXT);
      CREATE TABLE todo_deps(todo_id TEXT, depends_on TEXT);
      WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<80)
      INSERT INTO todos SELECT printf('task-%03d',x),'2026-11-17 01:00:00','2026-11-17 01:01:00','Task','done' FROM n;
      INSERT INTO todo_deps SELECT id,'task-000' FROM todos WHERE id!='task-000';`);
    const all = await (await call(`${url}?limit=1`)).json();
    expect(all).toMatchObject({ total: 1, taskTotal: 81, completed: 81 });
    const expanded = await (
      await call(`${url}?group=${all.items[0].id}&taskOffset=50`)
    ).json();
    expect(expanded.detail).toMatchObject({
      total: 81,
      offset: 50,
      graph: null,
    });
    expect(expanded.detail.items).toHaveLength(31);
    expect(expanded.detail.graphMessage).toMatch(/80/);
    db.exec(`DELETE FROM todo_deps;
      WITH RECURSIVE n(x) AS (VALUES(81) UNION ALL SELECT x+1 FROM n WHERE x<10000)
      INSERT INTO todos SELECT printf('task-%05d',x),NULL,NULL,'Task','pending' FROM n;`);
    expect(await (await call(url)).json()).toMatchObject({
      availability: 'unavailable',
      items: [],
      detail: null,
    });
    expect(
      (await (await call(`/api/sessions/${session.id}/todos?limit=1`)).json())
        .total,
    ).toBe(10001);
    db.exec(`DELETE FROM todos WHERE id!='task-000';
      WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<50000)
      INSERT INTO todo_deps SELECT 'task-000','task-000' FROM n;`);
    const edges = await (await call(url)).json();
    expect(edges.availability).toBe('unavailable');
    expect(edges.message).toMatch(/50,000/);
  } finally {
    db.close();
  }
});
test('todosWaitForRollbackJournalTransactionsToFinish', async () => {
  const session = await todoSession();
  const db = new DatabaseSync(session.file);
  try {
    db.exec(`PRAGMA journal_mode=DELETE;
      CREATE TABLE todos(id TEXT, created_at TEXT, title TEXT, status TEXT);
      INSERT INTO todos VALUES ('a',NULL,'Task','pending');
      BEGIN IMMEDIATE;
      UPDATE todos SET status='done';`);
    const url = `/api/sessions/${session.id}/todos`;
    expect((await (await call(url)).json()).availability).toBe('unavailable');
    db.exec('ROLLBACK');
    expect((await (await call(url)).json()).items[0].status).toBe('pending');
  } finally {
    db.close();
  }
});
test('paginationAndFilterValidation', async () => {
  for (const query of [
    'limit=201',
    'offset=-1',
    'state=made-up',
    'sort=bad',
    'entryOrder=bad',
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
test('changedSnapshotWithSameRequestIdsPreservesBothVersions', async () => {
  for (const [response, credits] of [
    ['partial', 1],
    ['complete', 2],
  ] as const) {
    expect(
      (
        await call('/api/imports/vscode', 'POST', {
          responderUsername: 'GitHub Copilot',
          requests: [
            {
              requestId: 'same-request',
              message: 'Original',
              response: [{ value: response }],
              copilotCredits: credits,
            },
          ],
        })
      ).status,
    ).toBe(201);
  }
  const page = await (await call('/api/sessions')).json();
  expect(page.total).toBe(2);
  const updated = page.items.find(
    (row: { usage: { aic: number } }) => row.usage.aic === 2,
  );
  expect(updated).toBeDefined();
  const entries = await (
    await call(`/api/sessions/${updated.id}/entries`)
  ).json();
  expect(entries.items.map((row: { text: string }) => row.text)).toContain(
    'complete',
  );
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
test.skipIf(process.platform !== 'win32')(
  'explicitSharedWindowsAclCannotReportOwnerOnlySuccess',
  async () => {
    const directory = join(root, 'dashboard-data');
    await mkdir(directory);
    execFileSync('icacls.exe', [directory, '/grant', '*S-1-1-0:(OI)(CI)R'], {
      stdio: 'pipe',
      windowsHide: true,
    });
    const result = await prepareDataDirectory(root);
    expect(result.warning).toMatch(/owner-only|permissions/i);
  },
);
test.skipIf(process.platform !== 'win32')(
  'explicitSharedDatabaseAclAlsoProducesPermissionWarning',
  async () => {
    const { directory, warning } = await prepareDataDirectory(root);
    expect(warning).toBeNull();
    const database = join(directory, 'sessions.db');
    await writeFile(database, '');
    execFileSync('icacls.exe', [database, '/grant', '*S-1-1-0:R'], {
      stdio: 'pipe',
      windowsHide: true,
    });
    expect((await prepareDataDirectory(root)).warning).toMatch(
      /owner-only|permissions/i,
    );
  },
);
