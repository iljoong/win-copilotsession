import { randomBytes } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHttpServer } from './http.js';
import { prepareDataDirectory } from './storage.js';
import { openStore } from './data/store.js';
import { createEventHub } from './events.js';
import { createIngestion } from './sources/ingestion.js';
import { createApi } from './routes.js';

export interface DashboardOptions {
  dataDir?: string;
  port: number;
  dev: boolean;
}

export interface RunningDashboard {
  url: string;
  port: number;
  token: string;
  dataDirectory: string;
  warning?: string;
  stop(): Promise<void>;
}

export async function startDashboard(
  options: DashboardOptions,
): Promise<RunningDashboard> {
  const accessToken = randomBytes(32).toString('hex');
  const storage = await prepareDataDirectory(
    options.dataDir ??
      join(process.env.LOCALAPPDATA ?? homedir(), 'CopilotSessionDashboard'),
  );
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
  const watcher = options.dev
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
    assetDir: options.dev
      ? developmentAssets
      : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'client'),
    handleApi: api,
  });
  try {
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(options.port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        done();
      });
    });
  } catch (error) {
    await watcher?.close();
    store.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    await watcher?.close();
    store.close();
    throw new Error('No TCP address');
  }
  const port = address.port;
  const url = `http://127.0.0.1:${port}/?token=${accessToken}`;
  ingestion.start();
  let shuttingDown = false;
  async function stop() {
    if (shuttingDown) return;
    shuttingDown = true;
    await ingestion.stop();
    events.close();
    await watcher?.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
  }
  return {
    url,
    port,
    token: accessToken,
    dataDirectory: storage.directory,
    warning: storage.warning ?? undefined,
    stop,
  };
}
