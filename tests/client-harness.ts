import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { createHttpServer } from '../src/server/http.js';
import { createApi } from '../src/server/routes.js';
import { createEventHub } from '../src/server/events.js';
import { createIngestion } from '../src/server/sources/ingestion.js';
import { openStore } from '../src/server/data/store.js';
import type { NormalizedRecord } from '../src/shared/contracts.js';

export async function createClientHarness() {
  const root = await mkdtemp(join(tmpdir(), 'copilot-ui-'));
  await mkdir(join(root, 'history'));
  const store = openStore(':memory:');
  const events = createEventHub();
  const ingestion = createIngestion({
    store,
    onChange: (change) => events.publish(change),
  });
  const server = createHttpServer({
    accessToken: 'test',
    assetDir: root,
    handleApi: createApi({
      store,
      ingestion,
      events,
      info: {
        dataDirectory: root,
        defaultCliRoot: join(root, 'history'),
        privacyWarning: null,
      },
    }),
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No TCP address');
  const origin = `http://127.0.0.1:${address.port}`;
  const nativeFetch = globalThis.fetch;
  const login = await nativeFetch(`${origin}/?token=test`, {
    redirect: 'manual',
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  let gate: ((path: string) => Promise<void>) | undefined;
  vi.stubGlobal(
    'fetch',
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        origin,
      );
      await gate?.(url.pathname);
      const headers = new Headers(init?.headers);
      headers.set('cookie', cookie);
      headers.set('origin', origin);
      return nativeFetch(url, { ...init, headers });
    },
  );
  window.history.replaceState({}, '', '/');
  return {
    store,
    root,
    delay(callback: (path: string) => Promise<void>) {
      gate = callback;
    },
    entry(
      sessionRef: string,
      text: string,
      extra: Partial<NormalizedRecord> = {},
    ): NormalizedRecord {
      return {
        sourceId: 'source',
        namespace: 'cli',
        sessionRef,
        eventId: `${sessionRef}-prompt`,
        timestamp: 1000,
        observedAt: 1000,
        model: null,
        kind: 'entry',
        role: 'original-user',
        text,
        truncated: false,
        ...extra,
      } as NormalizedRecord;
    },
    async close() {
      vi.unstubAllGlobals();
      await ingestion.stop();
      events.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
