import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import type { AddressInfo } from 'node:net';
import type { Page, SessionSummary } from '../../src/shared/contracts.js';

export async function startDashboard(context: BrowserContext, dev = false) {
  const root = await mkdtemp(join(tmpdir(), 'copilot-dashboard-e2e-'));
  const telemetryPath = join(root, 'synthetic-telemetry.jsonl');
  await writeFile(telemetryPath, '');
  let child: ChildProcessWithoutNullStreams | null = null;
  let origin = '';
  let cookie = '';
  const bindings = new Map<string, AddressInfo>();
  async function stop() {
    const process = child;
    child = null;
    if (!process || process.exitCode !== null || process.signalCode !== null)
      return;
    const exited = once(process, 'exit');
    process.kill('SIGTERM');
    await exited;
  }
  async function boot(browser: BrowserContext) {
    bindings.clear();
    const process = spawn(
      globalThis.process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(`import { Server } from 'node:net';
         const listen = Server.prototype.listen;
         Server.prototype.listen = function (...args) {
           this.once('listening', () => console.log('Bound: ' + JSON.stringify(this.address())));
           return listen.apply(this, args);
         };`)}`,
        join(globalThis.process.cwd(), 'dist', 'server', 'main.js'),
        '--data-dir',
        join(root, 'data'),
        '--no-open',
        ...(dev ? ['--dev'] : []),
      ],
      { stdio: 'pipe', windowsHide: true },
    );
    child = process;
    const accessUrl = await new Promise<string>((resolve, reject) => {
      let output = '';
      let errors = '';
      const timer = setTimeout(
        () => reject(new Error('Dashboard startup timed out.')),
        20000,
      );
      process.stderr.on('data', (chunk) => {
        errors = (errors + String(chunk)).slice(-2000);
      });
      process.once('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not launch the dashboard process.'));
      });
      process.once('exit', (code) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Dashboard exited during startup (${code}): ${errors.replace(/token=[^\s]+/g, 'token=[redacted]')}`,
          ),
        );
      });
      process.stdout.on('data', (chunk) => {
        output = (output + String(chunk)).slice(-4096);
        for (const line of output.matchAll(/Bound: ([^\r\n]+)/g)) {
          try {
            const address = JSON.parse(line[1]) as AddressInfo;
            bindings.set(`${address.address}:${address.port}`, address);
          } catch {
            /* Wait for the next chunk when a line is incomplete. */
          }
        }
        const found = output.match(
          /Dashboard: (http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]{64})/,
        );
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
    });
    origin = new URL(accessUrl).origin;
    const login = await fetch(accessUrl, { redirect: 'manual' });
    cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    if (login.status !== 303 || !cookie)
      throw new Error('Dashboard login did not establish a local cookie.');
    await browser.clearCookies();
    const split = cookie.indexOf('=');
    await browser.addCookies([
      {
        name: cookie.slice(0, split),
        value: cookie.slice(split + 1),
        url: origin,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    const health = await fetch(`${origin}/api/health`, { headers: { cookie } });
    if (!health.ok)
      throw new Error('Authenticated production health check failed.');
  }
  try {
    await boot(context);
  } catch (error) {
    await stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  }
  return {
    get origin() {
      return origin;
    },
    get bindings() {
      return [...bindings.values()];
    },
    telemetryPath,
    async sessions(): Promise<Page<SessionSummary>> {
      const response = await fetch(`${origin}/api/sessions`, {
        headers: { cookie },
      });
      if (!response.ok)
        throw new Error('Could not query authoritative session state.');
      return response.json() as Promise<Page<SessionSummary>>;
    },
    async restart(browser: BrowserContext) {
      await stop();
      await boot(browser);
    },
    async close() {
      await stop();
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
