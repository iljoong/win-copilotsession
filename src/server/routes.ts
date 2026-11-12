import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type {
  AppInfo,
  SessionFilter,
  SessionState,
  SourceKind,
} from '../shared/contracts.js';
import type { Store } from './data/store.js';
import type { IngestionService } from './sources/ingestion.js';
import type { EventHub } from './events.js';
import { parseVsCodeExport } from './sources/vscode.js';
import { object } from './sources/values.js';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<{ value: unknown; bytes: Buffer }> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new HttpError(415, 'Use application/json.');
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        tooLarge = true;
        chunks.length = 0;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.once('end', () => {
      if (tooLarge)
        return reject(
          new HttpError(413, 'File exceeds the upload size limit.'),
        );
      const buffer = Buffer.concat(chunks);
      try {
        resolve({ value: JSON.parse(buffer.toString('utf8')), bytes: buffer });
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.once('error', () =>
      reject(new HttpError(400, 'Upload was interrupted.')),
    );
    req.once('aborted', () =>
      reject(new HttpError(400, 'Upload was interrupted.')),
    );
  });
}
function filterFrom(url: URL): SessionFilter {
  const params = url.searchParams;
  const bounded = (name: string, fallback: number, max: number) => {
    const value = Number(params.get(name) ?? fallback);
    if (
      !Number.isInteger(value) ||
      value < (name === 'limit' ? 1 : 0) ||
      value > max
    )
      throw new HttpError(400, 'Invalid query bounds.');
    return value;
  };
  const sort = params.get('sort') ?? 'lastActivity';
  const state = params.get('state') || undefined;
  if (
    !['lastActivity', 'agentTime', 'credits'].includes(sort) ||
    (state &&
      ![
        'active',
        'idle',
        'completed',
        'interrupted',
        'error',
        'unknown',
      ].includes(state))
  )
    throw new HttpError(400, 'Invalid sort or state.');
  for (const key of ['query', 'source', 'model'])
    if ((params.get(key)?.length ?? 0) > 1024)
      throw new HttpError(400, 'Query is too long.');
  const from = params.has('from')
    ? bounded('from', 0, Number.MAX_SAFE_INTEGER)
    : undefined;
  const to = params.has('to')
    ? bounded('to', 0, Number.MAX_SAFE_INTEGER)
    : undefined;
  if (from !== undefined && to !== undefined && from > to)
    throw new HttpError(400, 'Invalid date range.');
  return {
    offset: bounded('offset', 0, Number.MAX_SAFE_INTEGER),
    limit: bounded('limit', 50, 200),
    sort: sort as SessionFilter['sort'],
    state: state as SessionState | undefined,
    query: params.get('query') || undefined,
    source: params.get('source') || undefined,
    model: params.get('model') || undefined,
    from,
    to,
  };
}

export function createApi(options: {
  store: Store;
  ingestion: IngestionService;
  events: EventHub;
  info?: AppInfo;
}) {
  const { store, ingestion, events } = options;
  let queue = Promise.resolve();
  function mutate<T>(action: () => T | Promise<T>): Promise<T> {
    const next = queue.then(action);
    queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  return async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    const send = (status: number, value: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/api/health') send(200, { ok: true });
        else if (url.pathname === '/api/info')
          send(
            200,
            options.info ?? {
              dataDirectory: '',
              defaultCliRoot: '',
              privacyWarning: null,
            },
          );
        else if (url.pathname === '/api/sessions')
          send(200, store.listSessions(filterFrom(url)));
        else if (url.pathname === '/api/usage')
          send(200, store.getUsage(filterFrom(url)));
        else if (url.pathname === '/api/sources')
          send(200, store.listSources());
        else if (url.pathname === '/api/events') events.attach(req, res);
        else {
          const match =
            /^\/api\/sessions\/([a-zA-Z0-9_-]+)(?:\/(entries|activity))?$/.exec(
              url.pathname,
            );
          if (!match || !store.getSession(match[1]))
            throw new HttpError(404, 'Session not found.');
          if (!match[2]) send(200, store.getSession(match[1]));
          else {
            const filter = filterFrom(url);
            send(
              200,
              match[2] === 'entries'
                ? store.getEntries(match[1], filter.offset, filter.limit)
                : store.getActivity(match[1], filter.offset, filter.limit),
            );
          }
        }
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/imports/vscode'
      ) {
        const { value, bytes } = await readBody(req, 50 * 1024 * 1024);
        const contentHash = createHash('sha256').update(bytes).digest('hex');
        const sourceId = `import-${contentHash.slice(0, 40)}`;
        const batch = parseVsCodeExport(value, {
          sourceId,
          contentHash,
          importedAt: Date.now(),
        });
        if (!batch.records.length)
          throw new HttpError(400, batch.warnings[0] ?? 'Unsupported export.');
        const change = await mutate(() => {
          store.saveSource({
            id: sourceId,
            kind: 'vscode-import',
            path: `Manual JSON export (${contentHash.slice(0, 8)})`,
            enabled: false,
          });
          const change = store.commitBatch(batch);
          store.setSourceStatus(sourceId, {
            lastSuccessAt: Date.now(),
            warnings: batch.warnings,
          });
          events.publish(change);
          return change;
        });
        send(201, change);
      } else if (
        req.method === 'PUT' &&
        /^\/api\/sources\/[a-zA-Z0-9_-]{1,80}$/.test(url.pathname)
      ) {
        const body = object((await readBody(req, 8192)).value);
        const id = url.pathname.split('/').at(-1)!;
        if (
          !['cli-history', 'cli-telemetry', 'vscode-telemetry'].includes(
            String(body.kind),
          ) ||
          typeof body.path !== 'string' ||
          body.path.length > 4096 ||
          typeof body.enabled !== 'boolean'
        )
          throw new HttpError(400, 'Invalid source configuration.');
        const config = {
          id,
          kind: body.kind as SourceKind,
          path: body.path,
          enabled: body.enabled,
        };
        await mutate(async () => {
          if (config.enabled) await ingestion.enableSource(config);
          else {
            await ingestion.disableSource(id);
            store.saveSource(config);
          }
          events.publish({ sessionIds: [], sourceIds: [id] });
        });
        send(
          200,
          store.listSources().find((source) => source.id === id),
        );
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/local-data/clear'
      ) {
        const body = object((await readBody(req, 8192)).value);
        if (body.confirmation !== 'CLEAR LOCAL DASHBOARD DATA')
          throw new HttpError(400, 'Exact confirmation is required.');
        await mutate(async () => {
          await ingestion.stop();
          store.clearLocalData();
          ingestion.start();
          events.publish({
            sessionIds: [],
            sourceIds: store.listSources().map((source) => source.id),
          });
        });
        send(200, { ok: true });
      } else throw new HttpError(405, 'Method or endpoint not supported.');
    } catch (error) {
      if (error instanceof HttpError)
        send(error.status, { error: error.message });
      else
        send(500, {
          error:
            'Operation failed. Check source configuration and available disk space.',
        });
    }
    return true;
  };
}
