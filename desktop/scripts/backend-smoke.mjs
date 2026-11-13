#!/usr/bin/env node
// Smoke-tests a staged portable package's backend sidecar, the same way the
// shell runs it: `node\node.exe app\dist\server\main.js --desktop --no-open
// --port 0`, plus a disposable `--data-dir` so this never touches real app
// data. Verifies the ready handshake, the token-for-cookie exchange, one
// authenticated API call, clean shutdown on stdin close, and that the
// backend actually created its SQLite database (WAL mode, so a `-wal`
// sidecar file is expected too).
//
// Usage: node backend-smoke.mjs <stagedRoot>
//   <stagedRoot> is the staged package directory, e.g.
//   desktop\artifacts\Release\CopilotSessionDashboard\.
//
// Exits 0 and prints "backend smoke ok" on success; exits 1 with a
// descriptive stderr message otherwise.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const READY_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 5_000;

function fail(message) {
  console.error(`backend smoke failed: ${message}`);
  process.exitCode = 1;
}

// Never print raw stdout lines from the backend: a malformed ready line can
// still contain a real token (e.g. valid token but a bad port type), so any
// diagnostic text must have long hex runs (32+ chars, covering the 64-hex
// token) redacted before it is logged or included in an error message.
function redact(text) {
  return text.replace(/[0-9a-f]{32,}/gi, '[redacted]');
}

async function main() {
  const stagedRootArg = process.argv[2];
  if (!stagedRootArg) {
    fail('usage: node backend-smoke.mjs <stagedRoot>');
    return;
  }
  const stagedRoot = resolve(stagedRootArg);

  const nodeExe = join(stagedRoot, 'node', 'node.exe');
  const mainJs = join(stagedRoot, 'app', 'dist', 'server', 'main.js');
  const workingDirectory = join(stagedRoot, 'app');
  const dataDir = await mkdtemp(join(tmpdir(), 'csd-backend-smoke-'));

  const child = spawn(
    nodeExe,
    [mainJs, '--desktop', '--no-open', '--port', '0', '--data-dir', dataDir],
    {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let stderrOutput = '';
  child.stderr.on('data', (chunk) => {
    stderrOutput += chunk.toString('utf8');
  });

  try {
    const ready = await readReadyLine(child, READY_TIMEOUT_MS);
    const cookie = await fetchSessionCookie(ready.port, ready.token);
    await fetchSmokeSessions(ready.port, cookie);
    // Check for sessions.db and its -wal sidecar while the backend still
    // holds the connection open: SQLite's WAL mode checkpoints and removes
    // the -wal file on a clean last-connection close, so this must run
    // before stdin is closed below.
    await assertDatabaseFiles(dataDir);
    await stopAndWaitExit(child, EXIT_TIMEOUT_MS);
    console.log('backend smoke ok');
  } catch (error) {
    if (!child.killed) child.kill();
    fail(
      `${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\nstderr: ${redact(stderrOutput)}` : ''}`,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
}

function readReadyLine(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    const timer = setTimeout(() => {
      rl.close();
      reject(new Error(`timed out waiting ${timeoutMs}ms for the ready line`));
    }, timeoutMs);

    const onExit = (code) => {
      clearTimeout(timer);
      rl.close();
      reject(
        new Error(`backend exited before printing a ready line (code ${code})`),
      );
    };
    child.once('exit', onExit);

    rl.once('line', (line) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      rl.close();
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        reject(new Error(`ready line was not valid JSON: ${redact(line)}`));
        return;
      }
      if (
        parsed.event !== 'ready' ||
        typeof parsed.port !== 'number' ||
        typeof parsed.token !== 'string' ||
        !/^[0-9a-f]{64}$/.test(parsed.token)
      ) {
        // Never log the raw line: it may contain a real token even when some
        // other field is malformed. Report only field names/types.
        const shape = Object.keys(parsed ?? {})
          .map((key) => `${key}:${typeof parsed[key]}`)
          .join(', ');
        reject(
          new Error(`unexpected ready line shape (fields: ${shape || 'none'})`),
        );
        return;
      }
      resolve({ port: parsed.port, token: parsed.token });
    });
  });
}

async function fetchSessionCookie(port, token) {
  const url = `http://127.0.0.1:${port}/?token=${token}`;
  const response = await fetch(url, { redirect: 'manual' });
  if (response.status !== 303) {
    throw new Error(`expected 303 from token exchange, got ${response.status}`);
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length === 0) {
    throw new Error('token exchange response had no Set-Cookie header');
  }
  const cookie = cookies[0].split(';')[0];
  if (!cookie) throw new Error('could not parse session cookie');
  return cookie;
}

async function fetchSmokeSessions(port, cookie) {
  const url = `http://127.0.0.1:${port}/api/sessions?query=smoke`;
  const response = await fetch(url, { headers: { cookie } });
  if (!response.ok) {
    throw new Error(`/api/sessions?query=smoke returned ${response.status}`);
  }
  await response.json();
}

function stopAndWaitExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`backend did not exit within ${timeoutMs}ms of stdin close`),
      );
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`backend exited with code ${code} after stdin close`));
        return;
      }
      resolve();
    });
    child.stdin.end();
  });
}

async function assertDatabaseFiles(dataDir) {
  // prepareDataDirectory() (src/server/storage.ts) nests the actual database
  // under a `dashboard-data` subdirectory of the given --data-dir.
  const dbPath = join(dataDir, 'dashboard-data', 'sessions.db');
  const walPath = `${dbPath}-wal`;
  await access(dbPath).catch(() => {
    throw new Error(`expected ${dbPath} to exist while the backend is running`);
  });
  await access(walPath).catch(() => {
    throw new Error(
      `expected ${walPath} to exist (schema.ts sets journal_mode=WAL)`,
    );
  });
}

await main();
