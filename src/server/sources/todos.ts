import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SessionTodo, SessionTodos } from '../../shared/contracts.js';

function inside(root: string, file: string) {
  const path = relative(root, file);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

export async function readSessionTodos(
  location: { root: string; sessionRef: string } | null,
  offset: number,
  limit: number,
): Promise<SessionTodos> {
  const unavailable: SessionTodos = {
    availability: 'unavailable',
    message:
      'TODO data unavailable. An enabled CLI history source and a readable session.db TODO table are required.',
    items: [],
    total: 0,
    completed: null,
    offset,
    limit,
  };
  return (
    (await withTodoSnapshot(location, (db, table) => {
      const counts = db
        .prepare(
          `SELECT count(*) AS total,
          count(CASE WHEN status COLLATE BINARY = 'done' THEN 1 END) AS completed
          FROM ${table}`,
        )
        .get()!;
      return {
        availability: 'available' as const,
        message: null,
        items: todoRows(db, table, limit, offset),
        total: Number(counts.total),
        completed: Number(counts.completed),
        offset,
        limit,
      };
    })) ?? unavailable
  );
}

export function todoRows(
  db: DatabaseSync,
  table: string,
  limit: number,
  offset: number,
): SessionTodo[] {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const updated = columns.some((column) => column.name === 'updated_at')
    ? 'updated_at'
    : 'NULL AS updated_at';
  return db
    .prepare(
      `SELECT id, created_at, ${updated}, title, status FROM ${table}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset)
    .map((row): SessionTodo => {
      if (
        (typeof row.id !== 'string' && typeof row.id !== 'number') ||
        typeof row.title !== 'string' ||
        typeof row.status !== 'string' ||
        [row.created_at, row.updated_at].some(
          (value) =>
            value !== null &&
            typeof value !== 'string' &&
            typeof value !== 'number',
        )
      )
        throw new Error('Unsupported TODO schema');
      return {
        id: String(row.id),
        created_at: row.created_at as SessionTodo['created_at'],
        updated_at: row.updated_at as SessionTodo['updated_at'],
        title: row.title,
        status: row.status,
      };
    });
}

export async function withTodoSnapshot<T>(
  location: { root: string; sessionRef: string } | null,
  read: (db: DatabaseSync, table: string) => T,
): Promise<T | null> {
  if (!location) return null;
  const handles: FileHandle[] = [];
  let temporary: string | undefined;
  let db: DatabaseSync | undefined;
  try {
    if (
      !isAbsolute(location.root) ||
      !location.sessionRef ||
      /[\\/:]/.test(location.sessionRef) ||
      ['.', '..'].includes(location.sessionRef)
    )
      return null;
    const root = await fs.realpath(location.root);
    const directory = await fs.realpath(join(root, location.sessionRef));
    if (!inside(root, directory)) return null;
    const snapshots = [];
    let remaining = 64 * 1024 * 1024;
    for (const name of ['session.db', 'session.db-wal', 'session.db-journal']) {
      const path = join(directory, name);
      let resolved: string;
      try {
        resolved = await fs.realpath(path);
      } catch (error) {
        if (
          name !== 'session.db' &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          snapshots.push({ path, name, handle: null, stat: null });
          continue;
        }
        throw error;
      }
      if (!inside(directory, resolved)) return null;
      const handle = await fs.open(resolved, 'r');
      handles.push(handle);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > remaining) return null;
      if (name.endsWith('-journal') && stat.size > 0) return null;
      remaining -= stat.size;
      snapshots.push({ path, name, handle, stat });
    }
    // Never open the source in SQLite: WAL readers can write its SHM sidecar.
    temporary = await fs.mkdtemp(join(tmpdir(), 'copilot-todos-'));
    for (const snapshot of snapshots) {
      if (
        !snapshot.handle ||
        !snapshot.stat ||
        snapshot.name.endsWith('-journal')
      )
        continue;
      const bytes = Buffer.alloc(snapshot.stat.size);
      let position = 0;
      while (position < bytes.length) {
        const { bytesRead } = await snapshot.handle.read(
          bytes,
          position,
          Math.min(64 * 1024, bytes.length - position),
          position,
        );
        if (!bytesRead) throw new Error('Source changed');
        position += bytesRead;
      }
      await fs.writeFile(join(temporary, snapshot.name), bytes, {
        flag: 'wx',
        mode: 0o600,
      });
    }
    for (const snapshot of snapshots) {
      const current = await fs
        .stat(snapshot.path)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      const previous = snapshot.stat;
      if (
        previous === null
          ? current !== null
          : current === null ||
            (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const).some(
              (key) => current[key] !== previous[key],
            )
      )
        return null;
    }
    db = new DatabaseSync(join(temporary, 'session.db'), { readOnly: true });
    db.exec(
      'PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=100;',
    );
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('todos','todo')",
      )
      .all();
    const table = tables.some((row) => row.name === 'todos')
      ? 'todos'
      : tables.some((row) => row.name === 'todo')
        ? 'todo'
        : null;
    return table ? read(db, table) : null;
  } catch {
    return null;
  } finally {
    db?.close();
    await Promise.all(handles.map((handle) => handle.close()));
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}
