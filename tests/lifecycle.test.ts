import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  startDashboard,
  type RunningDashboard,
} from '../src/server/lifecycle.js';
import { formatReadyLine, attachStdinLifeline } from '../src/server/desktop.js';

let directory: string;
let dashboard: RunningDashboard | undefined;

afterEach(async () => {
  await dashboard?.stop();
  dashboard = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('startDashboard serves health and stops idempotently', async () => {
  directory = await mkdtemp(join(tmpdir(), 'copilot-lifecycle-'));
  dashboard = await startDashboard({ dataDir: directory, port: 0, dev: false });
  const response = await fetch(dashboard.url, { redirect: 'manual' });
  expect(response.status).toBe(303);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const origin = new URL(dashboard.url).origin;
  const health = await fetch(`${origin}/api/health`, { headers: { cookie } });
  expect(await health.json()).toEqual({ ok: true });
  await dashboard.stop();
  await dashboard.stop();
  await expect(
    fetch(`${origin}/api/health`, { headers: { cookie } }),
  ).rejects.toThrow();
});

test('startDashboard url carries a 64-hex token on 127.0.0.1', async () => {
  directory = await mkdtemp(join(tmpdir(), 'copilot-lifecycle-'));
  dashboard = await startDashboard({ dataDir: directory, port: 0, dev: false });
  expect(dashboard.url).toMatch(
    /^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64}$/,
  );
  const url = new URL(dashboard.url);
  expect(url.port).toBe(String(dashboard.port));
  expect(url.searchParams.get('token')).toBe(dashboard.token);
});

test('formatReadyLine emits one JSON line', () => {
  const token = 'a'.repeat(64);
  expect(formatReadyLine({ port: 5, token })).toBe(
    '{"event":"ready","port":5,"token":"' + token + '"}\n',
  );
});

test('attachStdinLifeline stops once then exits 0', async () => {
  const input = new PassThrough();
  let stopCalls = 0;
  const stop = async () => {
    stopCalls += 1;
  };
  const exitCalls: number[] = [];
  const exit = (code: number) => exitCalls.push(code);
  attachStdinLifeline(input, stop, exit);
  input.end();
  input.emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  expect(stopCalls).toBe(1);
  expect(exitCalls).toEqual([0]);
});

test('attachStdinLifeline exits 1 when stop fails', async () => {
  const input = new PassThrough();
  const stop = async () => {
    throw new Error('boom');
  };
  const exitCalls: number[] = [];
  const exit = (code: number) => exitCalls.push(code);
  attachStdinLifeline(input, stop, exit);
  input.resume();
  input.end();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(exitCalls).toEqual([1]);
});
