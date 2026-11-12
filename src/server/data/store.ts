import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type {
  ActivityEntry,
  ConversationEntry,
  NormalizedBatch,
  NormalizedRecord,
  Page,
  SessionDetails,
  SessionFilter,
  SessionSummary,
  SourceConfig,
  SourceKind,
  SourceStatus,
  StoreChange,
  UsageObservation,
  UsageReport,
  UsageSummary,
} from '../../shared/contracts.js';
import { migrate } from './schema.js';
import { metricKeys, projectUsage } from './accounting.js';

export interface Store {
  commitBatch(
    batch: NormalizedBatch,
    checkpoint?: { sourceId: string; value: string },
  ): StoreChange;
  getCheckpoint(sourceId: string): string | null;
  listSessions(filter: SessionFilter): Page<SessionSummary>;
  getSession(id: string): SessionDetails | null;
  getEntries(
    id: string,
    offset: number,
    limit: number,
  ): Page<ConversationEntry>;
  getActivity(id: string, offset: number, limit: number): Page<ActivityEntry>;
  getUsage(filter: SessionFilter): UsageReport;
  saveSource(config: SourceConfig): void;
  listSources(): SourceStatus[];
  setSourceStatus(
    id: string,
    update: {
      lastSuccessAt?: number;
      error?: string | null;
      warnings?: string[];
    },
  ): void;
  clearLocalData(): void;
  close(): void;
}

function canonical(record: NormalizedRecord) {
  return `s-${createHash('sha256').update(`${record.namespace}\0${record.sessionRef}`).digest('hex').slice(0, 40)}`;
}
function paginate<T>(items: T[], offset: number, limit: number): Page<T> {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error('Invalid pagination');
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit,
  };
}

export function openStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  migrate(db);
  const parse = <T>(value: unknown) => JSON.parse(String(value)) as T;
  const records = (id: string) =>
    db
      .prepare('SELECT payload FROM records WHERE session_id=? ORDER BY id')
      .all(id)
      .map((row) => parse<NormalizedRecord>(row.payload));
  const chronological = (id: string, kind: string) =>
    records(id)
      .filter((row) => row.kind === kind)
      .sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity));
  const sourceKind = (record: NormalizedRecord): SourceKind => {
    const row = db
      .prepare('SELECT value FROM sources WHERE id=?')
      .get(record.sourceId);
    return row
      ? parse<SourceStatus>(row.value).kind
      : record.kind === 'usage'
        ? record.usage.origin
        : record.namespace === 'cli'
          ? 'cli-history'
          : record.namespace === 'vscode-export'
            ? 'vscode-import'
            : 'vscode-telemetry';
  };
  const sessionWarnings = (id: string) => {
    const row = db.prepare('SELECT warnings FROM sessions WHERE id=?').get(id);
    return row ? parse<string[]>(row.warnings) : [];
  };
  function refresh(id: string) {
    const rows = records(id);
    const ordered = [...rows].sort(
      (a, b) => (a.timestamp ?? -1) - (b.timestamp ?? -1),
    );
    const sessionRows = ordered.filter((row) => row.kind === 'session');
    const original = rows.find(
      (row) => row.kind === 'entry' && row.role === 'original-user',
    );
    const title =
      sessionRows
        .map((row) => row.title)
        .filter(Boolean)
        .at(-1) ??
      (original?.kind === 'entry'
        ? Array.from(original.text).slice(0, 90).join('')
        : (rows[0]?.sessionRef ?? 'Untitled session'));
    const times = rows.flatMap((row) =>
      row.timestamp === null ? [] : [row.timestamp],
    );
    const firstAt = times.length ? Math.min(...times) : null;
    const lastAt = times.length ? Math.max(...times) : null;
    const usage = projectUsage(
      rows.flatMap((row) => (row.kind === 'usage' ? [row.usage] : [])),
    );
    usage.wallMs =
      firstAt !== null && lastAt !== null ? lastAt - firstAt : null;
    const stateRow = sessionRows
      .filter((row) => row.state !== undefined)
      .at(-1);
    const sourceIds = db
      .prepare('SELECT source_id FROM source_links WHERE session_id=?')
      .all(id)
      .map((row) => String(row.source_id));
    const sourceKinds = [...new Set(rows.map(sourceKind))];
    const summary: SessionSummary = {
      id,
      title,
      sourceIds,
      sourceKinds,
      models: [
        ...new Set(rows.flatMap((row) => (row.model ? [row.model] : []))),
      ],
      state: stateRow?.state ?? 'unknown',
      stateScope: stateRow?.stateScope ?? 'session',
      snapshot: sourceKinds.every((kind) => kind === 'vscode-import'),
      firstAt,
      lastAt,
      observedAt: Math.max(0, ...rows.map((row) => row.observedAt)),
      directory:
        sessionRows
          .map((row) => row.directory)
          .filter(Boolean)
          .at(-1) ?? null,
      repository:
        sessionRows
          .map((row) => row.repository)
          .filter(Boolean)
          .at(-1) ?? null,
      usage,
    };
    db.prepare('UPDATE sessions SET summary=? WHERE id=?').run(
      JSON.stringify(summary),
      id,
    );
    db.prepare('UPDATE prompt_search SET title=? WHERE session_id=?').run(
      title,
      id,
    );
  }
  function selected(filter: SessionFilter) {
    let rows = db
      .prepare('SELECT summary FROM sessions')
      .all()
      .map((row) => parse<SessionSummary>(row.summary));
    if (filter.query?.trim()) {
      const phrase = `"${filter.query.trim().replaceAll('"', '""')}"`;
      const matches = db
        .prepare(
          'SELECT session_id, entry_id FROM prompt_search WHERE prompt_search MATCH ?',
        )
        .all(phrase);
      const bySession = new Map(
        matches.map((row) => [String(row.session_id), String(row.entry_id)]),
      );
      rows = rows
        .filter((row) => bySession.has(row.id))
        .map((row) => {
          const index = Math.max(
            0,
            chronological(row.id, 'entry').findIndex(
              (entry) => entry.eventId === bySession.get(row.id),
            ),
          );
          return {
            ...row,
            matchedEntryId: bySession.get(row.id),
            matchedEntryOffset: index,
          };
        });
    }
    rows = rows.filter(
      (row) =>
        (!filter.source ||
          row.sourceIds.includes(filter.source) ||
          row.sourceKinds.includes(filter.source as SourceKind)) &&
        (!filter.state || row.state === filter.state) &&
        (!filter.model || row.models.includes(filter.model)) &&
        (filter.from === undefined ||
          (row.lastAt !== null && row.lastAt >= filter.from)) &&
        (filter.to === undefined ||
          (row.firstAt !== null && row.firstAt <= filter.to)),
    );
    const value = (row: SessionSummary) =>
      filter.sort === 'credits'
        ? row.usage.aic
        : filter.sort === 'agentTime'
          ? row.usage.agentMs
          : row.lastAt;
    return rows.sort(
      (a, b) => (value(b) ?? -1) - (value(a) ?? -1) || a.id.localeCompare(b.id),
    );
  }
  function pageRecords<T>(
    id: string,
    kind: string,
    offset: number,
    limit: number,
    map: (record: NormalizedRecord) => T,
  ): Page<T> {
    const rows = chronological(id, kind);
    if (kind === 'activity') rows.reverse();
    return paginate(rows.map(map), offset, limit);
  }
  const store: Store = {
    commitBatch(batch, checkpoint) {
      const sessions = new Set<string>();
      const sources = new Set<string>();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const record of batch.records) {
          if (record.kind === 'entry' && record.role === 'captured-context')
            continue;
          const id = canonical(record);
          db.prepare('INSERT OR IGNORE INTO sessions(id) VALUES (?)').run(id);
          db.prepare(
            'INSERT OR IGNORE INTO source_links(session_id,source_id) VALUES (?,?)',
          ).run(id, record.sourceId);
          const inserted = db
            .prepare(
              'INSERT OR IGNORE INTO records(session_id,kind,event_id,payload) VALUES (?,?,?,?)',
            )
            .run(id, record.kind, record.eventId, JSON.stringify(record));
          if (
            inserted.changes &&
            record.kind === 'entry' &&
            record.role === 'original-user'
          ) {
            db.prepare(
              'INSERT INTO prompt_search(session_id,entry_id,text,title) VALUES (?,?,?,?)',
            ).run(id, record.eventId, record.text, '');
          }
          const warnings = [
            ...new Set([...sessionWarnings(id), ...batch.warnings]),
          ].slice(0, 30);
          db.prepare('UPDATE sessions SET warnings=? WHERE id=?').run(
            JSON.stringify(warnings),
            id,
          );
          sessions.add(id);
          sources.add(record.sourceId);
        }
        for (const id of sessions) refresh(id);
        if (checkpoint)
          db.prepare(
            'INSERT INTO checkpoints VALUES (?,?) ON CONFLICT(source_id) DO UPDATE SET value=excluded.value',
          ).run(checkpoint.sourceId, checkpoint.value);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { sessionIds: [...sessions], sourceIds: [...sources] };
    },
    getCheckpoint(sourceId) {
      const row = db
        .prepare('SELECT value FROM checkpoints WHERE source_id=?')
        .get(sourceId);
      return row ? String(row.value) : null;
    },
    listSessions(filter) {
      return paginate(selected(filter), filter.offset, filter.limit);
    },
    getSession(id) {
      const row = db.prepare('SELECT summary FROM sessions WHERE id=?').get(id);
      if (!row) return null;
      const activity = records(id).filter(
        (record) => record.kind === 'activity',
      );
      return {
        summary: parse<SessionSummary>(row.summary),
        warnings: sessionWarnings(id),
        counts: {
          modelCalls: activity.filter(
            (r) => r.operation === 'model' && r.phase === 'end',
          ).length,
          toolCalls: activity.filter(
            (r) =>
              r.operation === 'tool' &&
              (r.phase === 'end' || r.phase === 'error'),
          ).length,
        },
      };
    },
    getEntries(id, offset, limit) {
      return pageRecords(id, 'entry', offset, limit, (r) => {
        if (r.kind !== 'entry' || r.role === 'captured-context')
          throw new Error('Unexpected entry');
        return {
          id: r.eventId,
          role: r.role,
          text: r.text,
          truncated: r.truncated,
          timestamp: r.timestamp,
          model: r.model,
          requestId: r.requestId,
        };
      });
    },
    getActivity(id, offset, limit) {
      return pageRecords(id, 'activity', offset, limit, (r) => {
        if (r.kind !== 'activity') throw new Error('Unexpected activity');
        return {
          id: r.eventId,
          label: r.label,
          phase: r.phase,
          operation: r.operation,
          timestamp: r.timestamp,
          observedAt: r.observedAt,
        };
      });
    },
    getUsage(filter) {
      const sessions = selected(filter);
      let excluded = 0;
      const bySource = new Map<string, UsageObservation[]>();
      const sourceSessions = new Map<string, SessionSummary[]>();
      const excludedIds = new Set<string>();
      const eligible = sessions.flatMap((session) => {
        const source = session.sourceKinds.some((kind) =>
          kind.startsWith('cli-'),
        )
          ? 'CLI'
          : 'VS Code';
        sourceSessions.set(source, [
          ...(sourceSessions.get(source) ?? []),
          session,
        ]);
        const observations = records(session.id).flatMap((record) =>
          record.kind === 'usage'
            ? [
                {
                  ...record.usage,
                  sessionKey: session.id,
                  id: `${session.id}:${record.usage.id}`,
                  parentId: record.usage.parentId
                    ? `${session.id}:${record.usage.parentId}`
                    : undefined,
                },
              ]
            : [],
        );
        if (observations.some((item) => item.combinedEligible === false)) {
          excluded++;
          excludedIds.add(session.id);
          return [];
        }
        bySource.set(source, [
          ...(bySource.get(source) ?? []),
          ...observations,
        ]);
        return observations;
      });
      function withCoverage(usage: UsageSummary, matching: SessionSummary[]) {
        for (const key of metricKeys()) {
          if (
            usage[key] !== null &&
            matching.some(
              (session) =>
                excludedIds.has(session.id) ||
                session.usage.coverage[key] !== 'complete',
            )
          )
            usage.coverage[key] = 'partial';
        }
        return usage;
      }
      const totals = withCoverage(projectUsage(eligible), sessions);
      return {
        totals,
        models: totals.models,
        sources: [...bySource].map(([source, rows]) => ({
          source,
          usage: withCoverage(
            projectUsage(rows),
            sourceSessions.get(source) ?? [],
          ),
        })),
        sessions: sessions.length,
        excluded,
        missing: sessions.filter(
          (session) => session.usage.coverage.aic === 'unavailable',
        ).length,
        partial: sessions.filter((session) =>
          Object.values(session.usage.coverage).some(
            (value) => value === 'partial',
          ),
        ).length,
      };
    },
    saveSource(config) {
      const previous = store
        .listSources()
        .find((source) => source.id === config.id);
      const status: SourceStatus = {
        lastSuccessAt: null,
        error: null,
        warnings: [],
        ...previous,
        ...config,
        capabilities: {
          history:
            config.kind === 'cli-history' || config.kind === 'vscode-import',
          content:
            config.kind === 'cli-history' || config.kind === 'vscode-import',
          usage: true,
          activity: config.kind !== 'vscode-import',
        },
      };
      db.prepare(
        'INSERT INTO sources VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      ).run(config.id, JSON.stringify(status));
    },
    listSources() {
      return db
        .prepare('SELECT value FROM sources ORDER BY id')
        .all()
        .map((row) => parse<SourceStatus>(row.value));
    },
    setSourceStatus(id, update) {
      const source = store.listSources().find((source) => source.id === id);
      if (source)
        db.prepare('UPDATE sources SET value=? WHERE id=?').run(
          JSON.stringify({ ...source, ...update }),
          id,
        );
    },
    clearLocalData() {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(
          'DELETE FROM prompt_search; DELETE FROM records; DELETE FROM source_links; DELETE FROM sessions; DELETE FROM checkpoints;',
        );
        for (const source of store.listSources())
          store.saveSource({ ...source, enabled: false });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
  return store;
}
