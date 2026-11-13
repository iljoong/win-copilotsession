import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { startDashboard } from './lifecycle.js';
import { formatReadyLine, attachStdinLifeline } from './desktop.js';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    port: { type: 'string', default: '0' },
    'no-open': { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
    desktop: { type: 'boolean', default: false },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('Invalid TCP port');
if (values.desktop && !values['no-open'])
  throw new Error('--desktop requires --no-open');

const dashboard = await startDashboard({
  dataDir: values['data-dir'],
  port,
  dev: values.dev,
});
if (dashboard.warning) console.error(dashboard.warning);

let shuttingDown: Promise<void> | null = null;
function shutdown() {
  shuttingDown ??= dashboard.stop();
  return shuttingDown;
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

if (values.desktop) {
  process.stdout.write(
    formatReadyLine({ port: dashboard.port, token: dashboard.token }),
  );
  attachStdinLifeline(process.stdin, shutdown, process.exit);
} else {
  console.log(`Dashboard: ${dashboard.url}`);
  console.log(`Data: ${dashboard.dataDirectory}`);
  if (!values['no-open'] && process.platform === 'win32') {
    const opener = spawn(
      'rundll32.exe',
      ['url.dll,FileProtocolHandler', dashboard.url],
      { stdio: 'ignore' },
    );
    opener.on('error', () =>
      console.error('Open the startup URL in your browser.'),
    );
  }
}
