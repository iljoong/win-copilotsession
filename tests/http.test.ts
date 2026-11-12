import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Server } from 'node:http';
import { createHttpServer } from '../src/server/http.js';

let server: Server;
let directory: string;
let origin: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'copilot-http-'));
  await writeFile(join(directory, 'index.html'), '<h1>Local dashboard</h1>');
  server = createHttpServer({
    accessToken: 'test-bootstrap-token',
    assetDir: directory,
    handleApi: async (req, res) => {
      if (req.url === '/api/health') {
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
        return true;
      }
      return false;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No TCP address');
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function authenticate() {
  const response = await fetch(`${origin}/?token=test-bootstrap-token`, {
    redirect: 'manual',
  });
  return response.headers.get('set-cookie')!.split(';')[0];
}

test('anonymousCannotReadUiOrApi', async () => {
  for (const path of ['/', '/api/health', '/src/client/main.tsx']) {
    expect((await fetch(origin + path)).status).toBe(401);
  }
  expect((await fetch(`${origin}/?token=wrong`)).status).toBe(401);
});

test('bootstrapExchangesTokenAndRedirects', async () => {
  const response = await fetch(`${origin}/?token=test-bootstrap-token`, {
    redirect: 'manual',
  });
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/');
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
  expect(response.headers.get('set-cookie')).not.toContain(
    'test-bootstrap-token',
  );
});

test('authenticatedShellLoads', async () => {
  const cookie = await authenticate();
  const page = await fetch(origin, { headers: { cookie } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('Local dashboard');
  const response = await fetch(`${origin}/api/health`, { headers: { cookie } });
  expect(await response.json()).toEqual({ ok: true });
});

test('wrongHostOrForeignOriginIsRejected', async () => {
  const cookie = await authenticate();
  expect(
    (
      await fetch(`${origin}/api/health`, {
        headers: { cookie, origin: 'https://untrusted.example' },
      })
    ).status,
  ).toBe(403);
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      origin,
      { headers: { host: 'untrusted.example', cookie } },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on('error', reject);
    req.end();
  });
  expect(status).toBe(403);
});

test('unsafeAssetPathIsRejected', async () => {
  const cookie = await authenticate();
  for (const path of ['/%2e%2e%5cpackage.json', '/%00', '/.git/config']) {
    const response = await fetch(origin + path, { headers: { cookie } });
    expect(response.status).not.toBe(200);
  }
});

test('stateChangingRequestsRequireSameOrigin', async () => {
  const cookie = await authenticate();
  expect(
    (
      await fetch(`${origin}/api/health`, {
        method: 'POST',
        headers: { cookie },
      })
    ).status,
  ).toBe(403);
});

test('nonLoopbackBindIsRejected', async () => {
  const other = createHttpServer({
    accessToken: 'other',
    assetDir: directory,
    handleApi: async () => false,
  });
  expect(() => other.listen(0, '0.0.0.0')).toThrow(/loopback/i);
});
