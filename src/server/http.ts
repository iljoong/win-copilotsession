import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

type Options = {
  accessToken: string;
  assetDir: string;
  handleApi: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
};

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHttpServer(options: Options): Server {
  const cookie = randomBytes(32).toString('hex');
  const cookieName = `copilot_dashboard_${randomBytes(8).toString('hex')}`;
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Request failed');
    });
  });
  const listen = server.listen;
  server.listen = ((...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'object' && first !== null) {
      const settings = first as { host?: string; path?: string };
      if (settings.path || (settings.host && settings.host !== '127.0.0.1')) {
        throw new Error('Only loopback TCP binding is allowed');
      }
      args[0] = { ...settings, host: '127.0.0.1' };
    } else {
      if (typeof first !== 'number')
        throw new Error('Only loopback TCP binding is allowed');
      if (typeof args[1] === 'string') {
        if (args[1] !== '127.0.0.1')
          throw new Error('Only loopback binding is allowed');
      } else {
        args.splice(1, 0, '127.0.0.1');
      }
    }
    return Reflect.apply(listen, server, args);
  }) as Server['listen'];

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    const address = server.address();
    if (!address || typeof address === 'string')
      return res.writeHead(503).end();
    const host = `127.0.0.1:${address.port}`;
    const origin = `http://${host}`;
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      (req.headers['sec-fetch-site'] &&
        req.headers['sec-fetch-site'] !== 'same-origin' &&
        req.headers['sec-fetch-site'] !== 'none') ||
      (!['GET', 'HEAD'].includes(req.method ?? '') &&
        req.headers.origin !== origin)
    ) {
      return res.writeHead(403).end('Forbidden origin');
    }
    const url = new URL(req.url ?? '/', origin);
    if (
      req.method === 'GET' &&
      url.pathname === '/' &&
      equal(url.searchParams.get('token') ?? '', options.accessToken)
    ) {
      res.setHeader(
        'set-cookie',
        `${cookieName}=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
      res.writeHead(303, { location: '/' }).end();
      return;
    }
    const cookies = (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim());
    if (!cookies.some((part) => equal(part, `${cookieName}=${cookie}`))) {
      return res
        .writeHead(401)
        .end('Open the startup access URL to sign in locally.');
    }
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return res.writeHead(400).end('Invalid path');
    }
    if (
      path.includes('\0') ||
      path.includes('\\') ||
      path.split('/').some((part) => part.startsWith('.'))
    ) {
      return res.writeHead(400).end('Invalid path');
    }
    if (await options.handleApi(req, res)) return;
    if (!['GET', 'HEAD'].includes(req.method ?? ''))
      return res.writeHead(405).end();
    try {
      const root = await realpath(options.assetDir);
      const file = await realpath(
        resolve(root, path === '/' ? 'index.html' : `.${path}`),
      );
      const rel = relative(root, file);
      if (rel.startsWith('..') || isAbsolute(rel))
        return res.writeHead(403).end();
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      const type = types[extname(file)];
      if (!type) return res.writeHead(404).end();
      const content = await readFile(file);
      res.setHeader('content-type', type);
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
  return server;
}
