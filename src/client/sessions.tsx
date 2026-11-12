import { useEffect, useRef, useState } from 'react';
import type {
  ConversationEntry,
  ActivityEntry,
  Page,
  SessionDetails,
  SessionSummary,
  MetricKey,
} from '../shared/contracts.js';
import { apiRequest, subscribeChanges } from './api.js';

const stateNames = {
  active: 'Active (observed)',
  idle: 'Idle',
  completed: 'Completed',
  interrupted: 'Interrupted',
  error: 'Error',
  unknown: 'Unknown',
};
const quantity = (value: number | null) =>
  value === null
    ? 'Unavailable'
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
function duration(value: number | null) {
  if (value === null) return 'Unavailable';
  return value < 60000
    ? `${(value / 1000).toFixed(1)}s`
    : `${Math.floor(value / 60000)}m ${Math.floor((value % 60000) / 1000)}s`;
}
function stamp(value: number | null) {
  return value === null ? 'Time unavailable' : new Date(value).toLocaleString();
}
function Pagination({
  offset,
  total,
  onChange,
  label,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
  label: string;
}) {
  return (
    <nav className="pagination" aria-label={label}>
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - 50))}
      >
        Previous
      </button>
      <span>
        {total ? offset + 1 : 0}–{Math.min(offset + 50, total)} of {total}
      </span>
      <button
        disabled={offset + 50 >= total}
        onClick={() => onChange(offset + 50)}
      >
        Next
      </button>
    </nav>
  );
}

export function SessionsPage() {
  const initial = new URLSearchParams(window.location.search);
  const [query, setQuery] = useState(initial.get('q') ?? '');
  const [source, setSource] = useState(initial.get('source') ?? '');
  const [state, setState] = useState(initial.get('state') ?? '');
  const [model, setModel] = useState(initial.get('model') ?? '');
  const [from, setFrom] = useState(initial.get('from') ?? '');
  const [to, setTo] = useState(initial.get('to') ?? '');
  const [sort, setSort] = useState(initial.get('sort') ?? 'lastActivity');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(initial.get('session') ?? '');
  const [entryOffset, setEntryOffset] = useState(0);
  const [page, setPage] = useState<Page<SessionSummary> | null>(null);
  const [detail, setDetail] = useState<SessionDetails | null>(null);
  const [entries, setEntries] = useState<Page<ConversationEntry> | null>(null);
  const [activity, setActivity] = useState<Page<ActivityEntry> | null>(null);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const focusedSearch = useRef('');
  const detailKey = useRef('');
  useEffect(
    () =>
      subscribeChanges(
        () => setVersion((v) => v + 1),
        () => setVersion((v) => v + 1),
        setConnected,
      ),
    [],
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({
      q: query,
      source,
      state,
      model,
      from,
      to,
      sort,
      session: selected,
    })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState({}, '', url);
  }, [query, source, state, model, from, to, sort, selected]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      query,
      source,
      state,
      model,
      sort,
      offset: String(offset),
      limit: '50',
    });
    if (from)
      params.set('from', String(new Date(`${from}T00:00:00`).getTime()));
    if (to) params.set('to', String(new Date(`${to}T23:59:59.999`).getTime()));
    setError('');
    void apiRequest<Page<SessionSummary>>(`/api/sessions?${params}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPage(result);
        const current =
          result.items.find((row) => row.id === selectedRef.current) ??
          result.items[0];
        setSelected(current?.id ?? '');
        const searchKey = `${current?.id}:${query}`;
        if (focusedSearch.current !== searchKey) {
          focusedSearch.current = searchKey;
          setEntryOffset(
            Math.floor((current?.matchedEntryOffset ?? 0) / 50) * 50,
          );
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not load sessions.',
          );
      });
    return () => controller.abort();
  }, [query, source, state, model, from, to, sort, offset, version]);
  useEffect(() => {
    const key = `${selected}:${entryOffset}`;
    if (detailKey.current !== key) {
      detailKey.current = key;
      setDetail(null);
      setEntries(null);
      setActivity(null);
    }
    setDetailError('');
    if (!selected) return;
    const controller = new AbortController();
    void Promise.all([
      apiRequest<SessionDetails>(`/api/sessions/${selected}`, {
        signal: controller.signal,
      }),
      apiRequest<Page<ConversationEntry>>(
        `/api/sessions/${selected}/entries?offset=${entryOffset}&limit=50`,
        { signal: controller.signal },
      ),
      apiRequest<Page<ActivityEntry>>(
        `/api/sessions/${selected}/activity?limit=50`,
        { signal: controller.signal },
      ),
    ])
      .then(([next, conversation, events]) => {
        if (!controller.signal.aborted) {
          setDetail(next);
          setEntries(conversation);
          setActivity(events);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setDetailError(
            failure instanceof Error
              ? failure.message
              : 'Could not load this session.',
          );
      });
    return () => controller.abort();
  }, [selected, entryOffset, version]);
  const reset = (setter: (value: string) => void, value: string) => {
    setOffset(0);
    setter(value);
  };
  const metrics: [MetricKey, string][] = [
    ['input', 'Input'],
    ['output', 'Output'],
    ['cacheRead', 'Cache read'],
    ['cacheWrite', 'Cache write'],
    ['reasoning', 'Reasoning'],
    ['aic', 'Reported AIC'],
  ];
  const summary = detail?.summary;
  const matched = page?.items.find(
    (item) => item.id === selected,
  )?.matchedEntryId;
  async function copyPrompt(value: string) {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setNotice('Copied original prompt.');
    } catch {
      setNotice(
        'Clipboard access failed. Select and copy the prompt text manually.',
      );
    }
  }
  return (
    <section className="sessions-page">
      <div className="page-heading">
        <div>
          <h1>Sessions</h1>
          <p>Trace the work. Find the prompt. Understand the usage.</p>
        </div>
        <span className={`connection ${connected ? 'connected' : ''}`}>
          {connected ? 'Live updates connected' : 'Live updates disconnected'}
        </span>
      </div>
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <label className="search-field">
          Search original prompts
          <input
            type="search"
            aria-label="Search original prompts"
            value={query}
            onChange={(event) => reset(setQuery, event.target.value)}
            placeholder="Search full prompts and titles"
          />
        </label>
        <label>
          Source
          <select
            value={source}
            onChange={(event) => reset(setSource, event.target.value)}
          >
            <option value="">All sources</option>
            <option value="cli-history">CLI history</option>
            <option value="cli-telemetry">CLI telemetry</option>
            <option value="vscode-import">VS Code import</option>
            <option value="vscode-telemetry">VS Code telemetry</option>
          </select>
        </label>
        <label>
          State
          <select
            value={state}
            onChange={(event) => reset(setState, event.target.value)}
          >
            <option value="">All states</option>
            {Object.entries(stateNames).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <input
            value={model}
            placeholder="Any model"
            onChange={(event) => reset(setModel, event.target.value)}
          />
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(event) => reset(setFrom, event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(event) => reset(setTo, event.target.value)}
          />
        </label>
        <label>
          Sort
          <select
            value={sort}
            onChange={(event) => reset(setSort, event.target.value)}
          >
            <option value="lastActivity">Latest activity</option>
            <option value="agentTime">Recorded agent time</option>
            <option value="credits">Reported AIC</option>
          </select>
        </label>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="workspace">
        <aside className="session-list" aria-label="Session list">
          <div className="list-heading">
            {page ? `${page.total} sessions` : 'Loading sessions…'}
          </div>
          {page?.items.map((item) => (
            <button
              className={`session-row ${selected === item.id ? 'selected' : ''}`}
              key={item.id}
              aria-label={`Open ${item.title}`}
              aria-pressed={selected === item.id}
              onClick={() => {
                setSelected(item.id);
                setEntryOffset(
                  Math.floor((item.matchedEntryOffset ?? 0) / 50) * 50,
                );
                setNotice('');
              }}
            >
              <strong>{item.title}</strong>
              <span className="row-meta">
                <span className={`state state-${item.state}`}>
                  {item.snapshot ? 'Snapshot' : stateNames[item.state]}
                </span>
                <span>
                  {item.sourceKinds.some((kind) => kind.startsWith('cli-'))
                    ? 'CLI'
                    : 'VS Code'}
                </span>
              </span>
              <span className="row-meta">
                <span>
                  {item.models.length > 1
                    ? 'Multiple models'
                    : (item.models[0] ?? 'Model unavailable')}
                </span>
                <span>
                  {quantity(item.usage.aic)} AIC
                  {item.usage.coverage.aic === 'partial' ? ' (partial)' : ''}
                </span>
              </span>
              <span className="row-meta">
                <span>{duration(item.usage.agentMs)} agent time</span>
                <time>{stamp(item.lastAt)}</time>
              </span>
            </button>
          ))}
          {page?.total === 0 && (
            <div className="empty">
              <h2>No matching sessions</h2>
              <p>
                Clear filters, enable CLI history, or import a VS Code chat in{' '}
                <a href="/?view=sources">Sources</a>.
              </p>
            </div>
          )}
          {page && (
            <Pagination
              offset={offset}
              total={page.total}
              onChange={setOffset}
              label="Session pages"
            />
          )}
        </aside>
        <div className="session-detail" aria-label="Selected session">
          {detailError && (
            <p role="alert" className="error">
              {detailError}
            </p>
          )}
          {!selected && (
            <div className="empty">
              <h2>Your work, one session at a time</h2>
              <p>
                Select a session to inspect prompts, response previews, usage,
                and observed activity.
              </p>
            </div>
          )}
          {selected && !detail && !detailError && (
            <p role="status">Loading session…</p>
          )}
          {summary && (
            <>
              <header className="detail-heading">
                <h2>{summary.title}</h2>
                <p>
                  {summary.snapshot
                    ? 'Imported snapshot'
                    : stateNames[summary.state]}
                  {summary.stateScope === 'turn' ? ' — turn scope' : ''}
                </p>
                <p>Models: {summary.models.join(', ') || 'Unavailable'}</p>
                <p className="path">
                  {summary.repository ??
                    summary.directory ??
                    'Repository unavailable'}
                </p>
                <p className="muted">
                  First source time: {stamp(summary.firstAt)}
                  <br />
                  Last source time: {stamp(summary.lastAt)}
                </p>
                {!summary.snapshot && (
                  <p
                    className={
                      now - summary.observedAt > 30000 ? 'warning' : 'muted'
                    }
                  >
                    {now - summary.observedAt > 30000
                      ? 'Observation stale: no new records for 30s or more. Long operations may be silent.'
                      : 'Showing the latest exported observations.'}
                  </p>
                )}
              </header>
              <dl className="metrics">
                {metrics.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {quantity(summary.usage[key])}
                      {summary.usage.coverage[key] === 'partial'
                        ? ' (partial)'
                        : ''}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>Recorded agent time</dt>
                  <dd>{duration(summary.usage.agentMs)}</dd>
                </div>
                <div>
                  <dt>Wall span</dt>
                  <dd>{duration(summary.usage.wallMs)}</dd>
                </div>
              </dl>
              {[...new Set([...detail!.warnings, ...summary.usage.warnings])]
                .length > 0 && (
                <details className="coverage">
                  <summary>Data coverage and limitations</summary>
                  {[
                    ...new Set([
                      ...detail!.warnings,
                      ...summary.usage.warnings,
                    ]),
                  ].map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </details>
              )}
              <section aria-label="Conversation">
                <div className="section-heading">
                  <h3>Conversation</h3>
                  <span className="muted">
                    Full prompts. Text-only response previews.
                  </span>
                </div>
                <p role="status" className="notice">
                  {notice}
                </p>
                {entries?.items.map((entry, index) => (
                  <article
                    key={entry.id}
                    className={`conversation-entry ${entry.role === 'original-user' ? 'user-entry' : 'assistant-entry'} ${entry.id === matched ? 'search-match' : ''}`}
                    aria-label={
                      entry.role === 'original-user'
                        ? `Original prompt ${entryOffset + index + 1}`
                        : `Assistant preview ${entryOffset + index + 1}`
                    }
                  >
                    <header>
                      <span>
                        {entry.role === 'original-user'
                          ? 'Original user prompt'
                          : 'Assistant preview'}
                      </span>
                      <span className="muted">{stamp(entry.timestamp)}</span>
                      {entry.role === 'original-user' && (
                        <button
                          aria-label={`Copy prompt ${entryOffset + index + 1}`}
                          onClick={() => void copyPrompt(entry.text)}
                        >
                          Copy
                        </button>
                      )}
                    </header>
                    <pre>
                      {entry.role === 'original-user'
                        ? entry.text
                        : Array.from(entry.text).slice(0, 1000).join('')}
                    </pre>
                    {(entry.truncated ||
                      (entry.role === 'assistant-preview' &&
                        Array.from(entry.text).length > 1000)) && (
                      <p className="muted">
                        Preview truncated at 1,000 characters.
                      </p>
                    )}
                  </article>
                ))}
                {entries?.total === 0 && (
                  <p className="muted">
                    Original prompts are unavailable from this source. Import a
                    chat export to browse and reuse them.
                  </p>
                )}
                {entries && (
                  <Pagination
                    offset={entryOffset}
                    total={entries.total}
                    onChange={setEntryOffset}
                    label="Conversation pages"
                  />
                )}
              </section>
              <section className="activity">
                <div className="section-heading">
                  <h3>Observed activity</h3>
                  <span className="muted">
                    {detail!.counts.modelCalls} model calls /{' '}
                    {detail!.counts.toolCalls} tool calls observed
                  </span>
                </div>
                <p className="muted">
                  Export delivery can lag. Completed spans do not prove a tool
                  is currently running.
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Source time</th>
                      <th>Observed event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity?.items.map((event) => (
                      <tr key={event.id}>
                        <td>
                          <time>{stamp(event.timestamp)}</time>
                        </td>
                        <td>
                          {event.label}
                          <small>Ingested {stamp(event.observedAt)}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!activity?.total && (
                  <p className="muted">
                    No activity events are available for this session.
                  </p>
                )}
                {!!activity?.total && (
                  <p className="muted">
                    Latest {activity.items.length} of {activity.total} observed
                    events.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
