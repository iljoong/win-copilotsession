import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpServer } from './http.js';

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
const vite = values.dev
  ? await import('vite').then((module) =>
      module.createServer({ server: { middlewareMode: true } }),
    )
  : null;
const server = createHttpServer({
  accessToken,
  assetDir: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'client'),
  handleApi: async (req, res) => {
    if (req.url === '/api/health') {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
      return true;
    }
    if (vite && !req.url?.startsWith('/api/')) {
      return new Promise<boolean>((done, reject) => {
        res.once('finish', () => done(true));
        vite.middlewares(req, res, (error?: unknown) =>
          error ? reject(error) : done(false),
        );
      });
    }
    return false;
  },
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  const url = `http://127.0.0.1:${address.port}/?token=${accessToken}`;
  console.log(`Dashboard: ${url}`);
  if (!values['no-open'] && process.platform === 'win32') {
    const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      stdio: 'ignore',
    });
    opener.on('error', () =>
      console.error('Open the startup URL in your browser.'),
    );
  }
});
async function shutdown() {
  await vite?.close();
  server.closeAllConnections();
  server.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
