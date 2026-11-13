import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page } from '@playwright/test';

const run = promisify(execFile);

/** The Testing package staged by `npm run desktop:package -- -Flavor Testing`. */
export const stagedRoot = resolve(
  'desktop',
  'artifacts',
  'Testing',
  'CopilotSessionDashboard',
);
const dotnetExe = join(stagedRoot, 'runtime', 'dotnet.exe');
const shellDll = join(stagedRoot, 'CopilotSessionDashboard.dll');
const startupTimeoutMs = 60000;

export interface DesktopApp {
  page: Page;
  shellPid: number;
  /** Asks the shell window to close, as the user would with the close button. */
  requestClose(): Promise<void>;
  /** Waits up to `timeoutMs` for the shell process to exit; true if it did. */
  waitForExit(timeoutMs: number): Promise<boolean>;
  /** Closes the window (forcing it if needed) and removes the shell's state folder. */
  close(): Promise<void>;
}

/** Creates a disposable root with a data folder and a synthetic Copilot home. */
export async function makeDesktopFolders() {
  const root = await mkdtemp(join(tmpdir(), 'copilot-dashboard-desktop-e2e-'));
  const dataDir = join(root, 'data');
  const cliRoot = join(root, 'copilot-home');
  await mkdir(join(cliRoot, 'session-state'), { recursive: true });
  return {
    root,
    dataDir,
    cliRoot,
    remove: () => rm(root, { recursive: true, force: true, maxRetries: 10 }),
  };
}

async function pwsh(script: string) {
  const { stdout } = await run(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true },
  );
  return stdout.trim();
}
export async function nativeWindowTitle(pid: number) {
  return pwsh(`(Get-Process -Id ${pid}).MainWindowTitle`);
}

/** PIDs of running node.exe processes whose image lives under the staged folder. */
export async function stagedNodePids(): Promise<number[]> {
  const prefix = (stagedRoot + '\\').replace(/'/g, "''");
  const out = await pwsh(
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
      `Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${prefix}', [StringComparison]::OrdinalIgnoreCase) } | ` +
      `ForEach-Object { $_.ProcessId }`,
  );
  return out ? out.split(/\s+/).map(Number) : [];
}

/** Replaces the clipboard with a sentinel so a later read proves a fresh copy. */
export async function resetClipboard() {
  await pwsh(`Set-Clipboard -Value 'desktop-e2e-sentinel'`);
}

/** Clipboard text, read from outside the WebView so no page permission is involved. */
export async function readClipboard(): Promise<string> {
  const base64 = await pwsh(
    `$t = Get-Clipboard -Raw; if ($null -eq $t) { $t = '' }; ` +
      `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))`,
  );
  return Buffer.from(base64, 'base64').toString('utf8');
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

function alive(child: ChildProcess) {
  return child.exitCode === null && child.signalCode === null;
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (!alive(child)) return true;
  let timer: NodeJS.Timeout | undefined;
  const exited = once(child, 'exit').then(() => true);
  const timedOut = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(false), timeoutMs);
  });
  const result = await Promise.race([exited, timedOut]);
  clearTimeout(timer);
  return result;
}

async function forceKill(pid: number) {
  await run('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
  }).catch(() => undefined);
}

async function shellLogTail(localAppData: string) {
  const log = join(
    localAppData,
    'CopilotSessionDashboard',
    'desktop',
    'logs',
    'shell.log',
  );
  const text = await readFile(log, 'utf8').catch(() => '(no shell.log)');
  return text.slice(-1500);
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function connect(port: number, child: ChildProcess, deadline: number) {
  const endpoint = `http://127.0.0.1:${port}`;
  while (Date.now() < deadline) {
    if (!alive(child)) throw new Error('Desktop shell exited during startup.');
    const ready = await fetch(`${endpoint}/json/version`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return chromium.connectOverCDP(endpoint);
    await pause(250);
  }
  throw new Error('WebView2 remote debugging endpoint never came up.');
}

async function dashboardPage(browser: Browser, deadline: number) {
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) =>
        /^http:\/\/127\.0\.0\.1:\d+\/(?!.*token=)/.test(candidate.url()),
      );
    if (page) {
      await page.waitForLoadState('domcontentloaded');
      return page;
    }
    await pause(250);
  }
  throw new Error('The dashboard page never finished loading.');
}

/**
 * Starts the staged Testing shell through its bundled, Microsoft-signed
 * `runtime\dotnet.exe` (never the apphost exe), with app-owned state, data, and
 * the Copilot home all in disposable folders, and attaches Playwright over CDP.
 */
export async function launchDesktop({
  dataDir,
  cliRoot,
}: {
  dataDir: string;
  cliRoot: string;
}): Promise<DesktopApp> {
  if (!existsSync(shellDll) || !existsSync(dotnetExe))
    throw new Error(
      'Testing package is not staged. Run `npm run desktop:package -- -Flavor Testing`.',
    );
  const localAppData = await mkdtemp(
    join(tmpdir(), 'copilot-dashboard-desktop-state-'),
  );
  const port = await freePort();
  const child = spawn(
    dotnetExe,
    [shellDll, '--data-dir', dataDir, '--remote-debugging-port', String(port)],
    {
      cwd: stagedRoot,
      stdio: 'ignore',
      env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
        COPILOT_HOME: cliRoot,
      },
    },
  );
  const shellPid = child.pid ?? 0;
  let browser: Browser | null = null;

  async function requestClose() {
    if (!alive(child)) return;
    await pwsh(
      `$p = Get-Process -Id ${shellPid} -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() }`,
    );
  }

  async function close() {
    await browser?.close().catch(() => undefined);
    browser = null;
    if (alive(child)) {
      await requestClose().catch(() => undefined);
      if (!(await waitForExit(child, 15000)) && shellPid)
        await forceKill(shellPid);
      await waitForExit(child, 5000);
    }
    for (const pid of await stagedNodePids().catch(() => []))
      await forceKill(pid);
    await rm(localAppData, { recursive: true, force: true, maxRetries: 10 });
  }

  try {
    if (!shellPid) throw new Error('Could not launch the desktop shell.');
    const deadline = Date.now() + startupTimeoutMs;
    browser = await connect(port, child, deadline);
    const page = await dashboardPage(browser, deadline);
    return {
      page,
      shellPid,
      requestClose,
      waitForExit: (timeoutMs) => waitForExit(child, timeoutMs),
      close,
    };
  } catch (error) {
    const log = await shellLogTail(localAppData);
    await close();
    throw new Error(`${(error as Error).message}\nshell.log tail:\n${log}`);
  }
}
