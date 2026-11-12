import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHttpServer } from './http.js';
import { prepareDataDirectory } from './storage.js';
import { openStore } from './data/store.js';
import { createEventHub } from './events.js';
import { createIngestion } from './sources/ingestion.js';
import { createApi } from './routes.js';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    port: { type: 'string', default: '0' },
    'no-open': { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('Invalid TCP port');
const accessToken = randomBytes(32).toString('hex');
const storage = await prepareDataDirectory(
  values['data-dir'] ??
    join(process.env.LOCALAPPDATA ?? homedir(), 'CopilotSessionDashboard'),
);
if (storage.warning) console.error(storage.warning);
const store = openStore(join(storage.directory, 'sessions.db'));
const events = createEventHub();
const ingestion = createIngestion({
  store,
  onChange: (change) => events.publish(change),
});
const api = createApi({
  store,
  ingestion,
  events,
  info: {
    dataDirectory: storage.directory,
    defaultCliRoot: resolve(
      process.env.COPILOT_HOME ?? join(homedir(), '.copilot'),
      'session-state',
    ),
    privacyWarning: storage.warning,
  },
});
const developmentAssets = resolve('dist', 'dev-client');
const watcher = values.dev
  ? await import('vite').then(async (module) => {
      const build = await module.build({
        build: { outDir: developmentAssets, watch: {} },
      });
      if (!('on' in build))
        throw new Error('Expected a frontend build watcher');
      await new Promise<void>((done, reject) => {
        build.on('event', (event) => {
          if (event.code === 'BUNDLE_END') void event.result.close();
          if (event.code === 'END') done();
          if (event.code === 'ERROR') reject(event.error);
        });
      });
      return build;
    })
  : null;
const server = createHttpServer({
  accessToken,
  assetDir: values.dev
    ? developmentAssets
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'client'),
  handleApi: api,
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  const url = `http://127.0.0.1:${address.port}/?token=${accessToken}`;
  console.log(`Dashboard: ${url}`);
  console.log(`Data: ${storage.directory}`);
  ingestion.start();
  if (!values['no-open'] && process.platform === 'win32') {
    const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      stdio: 'ignore',
    });
    opener.on('error', () =>
      console.error('Open the startup URL in your browser.'),
    );
  }
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await ingestion.stop();
  events.close();
  await watcher?.close();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  store.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
