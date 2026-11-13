import { afterEach, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = resolveRepoRoot();

function resolveRepoRoot() {
  return join(import.meta.dirname, '..');
}

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length) {
    const directory = cleanupDirs.pop()!;
    await rm(directory, { recursive: true, force: true });
  }
});

async function makeTempDirs() {
  const dataDir = await mkdtemp(join(tmpdir(), 'copilot-cli-data-'));
  const copilotHome = await mkdtemp(join(tmpdir(), 'copilot-cli-home-'));
  cleanupDirs.push(dataDir, copilotHome);
  return { dataDir, copilotHome };
}

function spawnDashboard(args: string[], copilotHome: string) {
  return spawn(
    process.execPath,
    ['--import', 'tsx', 'src/server/main.ts', ...args],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        COPILOT_HOME: copilotHome,
      },
    },
  );
}

function collect(
  child: ReturnType<typeof spawn>,
  onReady?: (result: { stdout: string; stderr: string }) => void,
): Promise<ChildResult> {
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
    onReady?.({ stdout, stderr });
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  return new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('desktop mode prints exactly one ready line on stdout', async () => {
  const { dataDir, copilotHome } = await makeTempDirs();
  const child = spawnDashboard(
    ['--desktop', '--no-open', '--port', '0', '--data-dir', dataDir],
    copilotHome,
  );
  const resultPromise = collect(child, ({ stdout }) => {
    if (/\n/.test(stdout)) child.stdin.end();
  });
  const result = await resultPromise;
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(
    /^\{"event":"ready","port":\d+,"token":"[0-9a-f]{64}"\}\n$/,
  );
  expect(result.stdout).not.toContain('Dashboard:');
  const token = result.stdout.match(/"token":"([0-9a-f]{64})"/)?.[1];
  expect(token).toBeTruthy();
  expect(result.stderr).not.toContain(token!);
}, 30000);

test('closing stdin shuts down with exit code 0 within 5 seconds', async () => {
  const { dataDir, copilotHome } = await makeTempDirs();
  const child = spawnDashboard(
    ['--desktop', '--no-open', '--port', '0', '--data-dir', dataDir],
    copilotHome,
  );
  let shutdownStart = 0;
  const resultPromise = collect(child, ({ stdout }) => {
    if (/\n/.test(stdout) && shutdownStart === 0) {
      shutdownStart = Date.now();
      child.stdin.end();
    }
  });
  const result = await resultPromise;
  expect(result.code).toBe(0);
  expect(Date.now() - shutdownStart).toBeLessThan(5000);
}, 30000);

test('--desktop without --no-open fails', async () => {
  const { dataDir, copilotHome } = await makeTempDirs();
  const child = spawnDashboard(
    ['--desktop', '--port', '0', '--data-dir', dataDir],
    copilotHome,
  );
  const result = await collect(child);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain('--desktop requires --no-open');
}, 30000);

test('default mode still prints Dashboard and Data lines', async () => {
  const { dataDir, copilotHome } = await makeTempDirs();
  const child = spawnDashboard(
    ['--no-open', '--port', '0', '--data-dir', dataDir],
    copilotHome,
  );
  const resultPromise = collect(child, ({ stdout }) => {
    if (stdout.includes('Data:')) child.kill('SIGTERM');
  });
  const result = await resultPromise;
  expect(result.stdout).toContain('Dashboard:');
  expect(result.stdout).toContain('Data:');
}, 30000);
