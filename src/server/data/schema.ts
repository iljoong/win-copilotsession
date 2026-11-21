import type { DatabaseSync } from 'node:sqlite';

export function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '{}', warnings TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
      kind TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL,
      UNIQUE(session_id, kind, event_id)
    );
    CREATE INDEX IF NOT EXISTS records_session ON records(session_id, kind);
    CREATE TABLE IF NOT EXISTS source_links (
      session_id TEXT NOT NULL REFERENCES sessions(id), source_id TEXT NOT NULL,
      PRIMARY KEY(session_id, source_id)
    );
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cli_workspace_titles (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY(session_id, source_id)
    );
    CREATE TABLE IF NOT EXISTS checkpoints (source_id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS prompt_search USING fts5(
      session_id UNINDEXED, entry_id UNINDEXED, text, title
    );
    PRAGMA user_version = 1;
  `);
}
