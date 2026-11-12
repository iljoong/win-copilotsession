import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StoreChange } from '../shared/contracts.js';

export interface EventHub {
  publish(change: StoreChange): void;
  attach(req: IncomingMessage, res: ServerResponse): void;
  close(): void;
}
export function createEventHub(): EventHub {
  const clients = new Set<ServerResponse>();
  const send = (res: ServerResponse, value: string) => {
    if (
      res.destroyed ||
      res.writableLength + Buffer.byteLength(value) > 64 * 1024
    ) {
      clients.delete(res);
      res.destroy();
      return;
    }
    res.write(value);
  };
  const heartbeat = setInterval(() => {
    for (const client of clients) send(client, ': heartbeat\n\n');
  }, 15000);
  heartbeat.unref();
  return {
    publish(change) {
      const event = `event: change\ndata: ${JSON.stringify(change)}\n\n`;
      for (const client of clients) send(client, event);
    },
    attach(_req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      clients.add(res);
      res.once('close', () => clients.delete(res));
      res.flushHeaders();
      send(res, 'event: ready\ndata: {}\n\n');
    },
    close() {
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
    },
  };
}
