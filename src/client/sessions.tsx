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
const sourceNames = {
  'cli-history': 'CLI history',
  'cli-telemetry': 'CLI telemetry',
  'vscode-import': 'VS Code import',
  'vscode-telemetry': 'VS Code telemetry',
};
type FilterEditor = 'source' | 'state' | 'model' | 'date';
function SessionIcon({
  kind,
}: {
  kind: FilterEditor | 'lastActivity' | 'agentTime' | 'credits';
}) {
  const paths = {
    source: 'M9 5 3 12l6 7m6-14 6 7-6 7',
    state: 'M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0m4 0 2 2 4-5',
    model: 'M6 6h12v12H6zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4',
    date: 'M3 5h18v16H3zM7 2v6m10-6v6M3 11h18',
    lastActivity: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0m9-6v6l4 2',
    agentTime: 'M7 3h10M7 21h10M8 3v4l8 10v4M16 3v4L8 17v4',
    credits:
      'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0m12-4h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12',
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
function revealPromptMatch(body: HTMLPreElement, query: string) {
  // SQLite FTS folds both forms of Greek sigma to the same token.
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/\u03c2/g, '\u03c3');
  const terms = normalize(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    !terms.length ||
    !body.firstChild ||
    body.firstChild.nodeType !== Node.TEXT_NODE
  )
    return;
  let text = '';
  let offset = 0;
  const starts: number[] = [];
  const ends: number[] = [];
  for (const character of body.textContent ?? '') {
    const normalized = normalize(character);
    for (let n = 0; n < normalized.length; n++) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    text += normalized;
    offset += character.length;
  }
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  const index = tokens.findIndex((_, n) =>
    terms.every((term, m) => tokens[n + m]?.[0] === term),
  );
  if (index < 0) return;
  const first = tokens[index];
  const last = tokens[index + terms.length - 1];
  const range = document.createRange();
  range.setStart(body.firstChild, starts[first.index]);
  range.setEnd(body.firstChild, ends[last.index + last[0].length - 1]);
  if (!range.getBoundingClientRect) return;
  const hit = range.getBoundingClientRect();
  const viewport = body.getBoundingClientRect();
  if (hit.top < viewport.top || hit.bottom > viewport.bottom) {
    body.scrollTop +=
      hit.top - viewport.top - parseFloat(getComputedStyle(body).lineHeight);
  }
}
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
function ModelBadges({ models }: { models: string[] }) {
  return (
    <span className="model-badges">
      {models.length
        ? models.map((model) => {
            const family = /gpt/i.test(model)
              ? 'gpt'
              : /claude/i.test(model)
                ? 'claude'
                : 'other';
            return (
              <span key={model} className={`model-badge model-${family}`}>
                {model}
              </span>
            );
          })
        : 'Unavailable'}
    </span>
  );
}
function Pagination({
  offset,
  total,
  onChange,
  label,
  limit = 50,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
  label: string;
  limit?: number;
}) {
  return (
    <nav className="pagination" aria-label={label}>
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span>
        {total ? offset + 1 : 0}–{Math.min(offset + limit, total)} of {total}
      </span>
      <button
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </button>
    </nav>
  );
}

export function SessionsPage({
  onConnectionChange,
}: {
  onConnectionChange?: (connected: boolean) => void;
} = {}) {
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
  const [entryLimit, setEntryLimit] = useState(25);
  const [hideEmptyPreviews, setHideEmptyPreviews] = useState(true);
  const [entryOrder, setEntryOrder] = useState<'asc' | 'desc'>('desc');
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [filterEditor, setFilterEditor] = useState<FilterEditor | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listVisible, setListVisible] = useState(true);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const listRowsRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const listToggleRef = useRef<HTMLButtonElement>(null);
  const toggledList = useRef(false);
  const revealedMatches = useRef(new WeakMap<HTMLPreElement, string>());
  const [page, setPage] = useState<Page<SessionSummary> | null>(null);
  const [detail, setDetail] = useState<SessionDetails | null>(null);
  const [entries, setEntries] = useState<Page<ConversationEntry> | null>(null);
  const [activity, setActivity] = useState<Page<ActivityEntry> | null>(null);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const focusedSearch = useRef('');
  const detailKey = useRef('');
  useEffect(() => {
    if (toggledList.current) {
      if (listVisible && listRowsRef.current)
        listRowsRef.current.scrollTop = listScroll.current;
      listToggleRef.current?.focus();
    }
  }, [listVisible]);
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const update = () => {
      workspace.style.setProperty(
        '--workspace-top',
        `${workspace.getBoundingClientRect().top + window.scrollY}px`,
      );
    };
    update();
    window.addEventListener('resize', update);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (workspace.parentElement) observer?.observe(workspace.parentElement);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const stop = subscribeChanges(
      () => setVersion((v) => v + 1),
      () => setVersion((v) => v + 1),
      (connected) => {
        if (active) onConnectionChange?.(connected);
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [onConnectionChange]);
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
      hideEmptyPreviews: String(hideEmptyPreviews),
      entryOrder,
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
        const searchKey = `${current?.id}:${query}:${entryLimit}:${hideEmptyPreviews}:${entryOrder}`;
        if (focusedSearch.current !== searchKey) {
          focusedSearch.current = searchKey;
          setEntryOffset(
            Math.floor((current?.matchedEntryOffset ?? 0) / entryLimit) *
              entryLimit,
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
  }, [
    query,
    source,
    state,
    model,
    from,
    to,
    sort,
    offset,
    version,
    entryLimit,
    hideEmptyPreviews,
    entryOrder,
  ]);
  useEffect(() => {
    const key = `${selected}:${entryOffset}:${entryLimit}:${hideEmptyPreviews}:${entryOrder}`;
    if (detailKey.current !== key) {
      if (!detailKey.current.startsWith(`${selected}:`)) {
        setDetail(null);
        setActivity(null);
      }
      detailKey.current = key;
      setEntries(null);
    }
    setDetailError('');
    if (!selected) return;
    const controller = new AbortController();
    void Promise.all([
      apiRequest<SessionDetails>(`/api/sessions/${selected}`, {
        signal: controller.signal,
      }),
      apiRequest<Page<ConversationEntry>>(
        `/api/sessions/${selected}/entries?offset=${entryOffset}&limit=${entryLimit}&hideEmptyPreviews=${hideEmptyPreviews}&entryOrder=${entryOrder}`,
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
  }, [
    selected,
    entryOffset,
    entryLimit,
    hideEmptyPreviews,
    entryOrder,
    version,
  ]);
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
  const activeFilters = [
    { name: 'Search', value: query, clear: () => reset(setQuery, '') },
    {
      name: 'Source',
      value: source
        ? (sourceNames[source as keyof typeof sourceNames] ?? source)
        : '',
      clear: () => reset(setSource, ''),
    },
    {
      name: 'State',
      value: state
        ? (stateNames[state as keyof typeof stateNames] ?? state)
        : '',
      clear: () => reset(setState, ''),
    },
    { name: 'Model', value: model, clear: () => reset(setModel, '') },
    {
      name: 'Date range',
      value: from || to ? `${from || 'Any'} to ${to || 'Any'}` : '',
      clear: () => {
        reset(setFrom, '');
        setTo('');
      },
    },
  ].filter((filter) => filter.value);
  const filterLabels: Record<FilterEditor, string> = {
    source: 'Source',
    state: 'State',
    model: 'Model',
    date: 'Date range',
  };
  const filters = (
    <form
      className="session-filters"
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && filterEditor) {
          document.getElementById(`filter-${filterEditor}`)?.focus();
          setFilterEditor(null);
        }
      }}
    >
      <label>
        Search original prompts
        <input
          type="search"
          value={query}
          onChange={(event) => reset(setQuery, event.target.value)}
          placeholder="Search full prompts and titles"
        />
      </label>
      <div
        className="session-filter-buttons"
        role="group"
        aria-label="Session filters"
      >
        {(Object.keys(filterLabels) as FilterEditor[]).map((kind) => {
          const value = activeFilters.find(
            (filter) => filter.name === filterLabels[kind],
          )?.value;
          return (
            <button
              key={kind}
              id={`filter-${kind}`}
              type="button"
              className={value ? 'filter-active' : ''}
              aria-label={filterLabels[kind]}
              title={`${filterLabels[kind]}: ${value || 'All'}`}
              aria-expanded={filterEditor === kind}
              aria-controls={`editor-${kind}`}
              onClick={() =>
                setFilterEditor(filterEditor === kind ? null : kind)
              }
            >
              <SessionIcon kind={kind} />
            </button>
          );
        })}
      </div>
      {(Object.keys(filterLabels) as FilterEditor[]).map((kind) => (
        <div
          className="session-filter-editor"
          key={kind}
          id={`editor-${kind}`}
          hidden={filterEditor !== kind}
        >
          {(kind === 'source' || kind === 'state') && (
            <fieldset>
              <legend>{filterLabels[kind]}</legend>
              {Object.entries(
                kind === 'source'
                  ? { '': 'All sources', ...sourceNames }
                  : { '': 'All states', ...stateNames },
              ).map(([value, label]) => (
                <label className="radio-choice" key={value}>
                  <input
                    type="radio"
                    name={kind}
                    value={value}
                    checked={(kind === 'source' ? source : state) === value}
                    onChange={() =>
                      reset(kind === 'source' ? setSource : setState, value)
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {kind === 'model' && (
            <label>
              Model
              <input
                value={model}
                placeholder="Any model"
                onChange={(event) => reset(setModel, event.target.value)}
              />
            </label>
          )}
          {kind === 'date' && (
            <>
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
            </>
          )}
        </div>
      ))}
      <div
        className="session-filter-buttons"
        role="group"
        aria-label="Session sort"
      >
        <span className="muted">Sort</span>
        {(
          [
            ['lastActivity', 'Latest activity'],
            ['agentTime', 'Recorded agent time'],
            ['credits', 'Reported AIC'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            title={label}
            aria-label={label}
            aria-pressed={sort === value}
            onClick={() => reset(setSort, value)}
          >
            <SessionIcon kind={value} />
          </button>
        ))}
      </div>
      {activeFilters.length > 0 && (
        <div className="filter-chips">
          {activeFilters.map((filter) => (
            <button
              key={filter.name}
              type="button"
              aria-label={`Clear ${filter.name}`}
              title={`${filter.name}: ${filter.value}`}
              onClick={filter.clear}
            >
              {filter.name}: {filter.value}{' '}
              <span aria-hidden="true">&times;</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOffset(0);
              setQuery('');
              setSource('');
              setState('');
              setModel('');
              setFrom('');
              setTo('');
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </form>
  );
  const toggleLabel = listVisible
    ? 'Hide sessions'
    : `Show sessions${activeFilters.length ? ` (${activeFilters.length} ${activeFilters.length === 1 ? 'filter' : 'filters'})` : ''}`;
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
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div
        ref={workspaceRef}
        className={`workspace${listVisible ? '' : ' workspace-list-hidden'}`}
      >
        <aside
          id="session-list"
          className="session-list"
          aria-label="Session list"
          hidden={!listVisible}
        >
          <div className="session-list-controls">
            <div className="list-heading">
              {page ? `${page.total} sessions` : 'Loading sessions…'}
            </div>
            <details
              className="session-search"
              open={filtersOpen}
              onToggle={(event) => {
                setFiltersOpen(event.currentTarget.open);
                if (!event.currentTarget.open) setFilterEditor(null);
              }}
            >
              <summary>
                Search and filters
                {activeFilters.length
                  ? ` (${activeFilters.length} ${activeFilters.length === 1 ? 'filter' : 'filters'})`
                  : ''}
              </summary>
              {filters}
            </details>
          </div>
          <div className="session-list-rows" ref={listRowsRef}>
            {page?.items.map((item) => (
              <button
                className={`session-row ${selected === item.id ? 'selected' : ''}`}
                key={item.id}
                aria-label={`Open ${item.title}`}
                aria-pressed={selected === item.id}
                onClick={() => {
                  setSelected(item.id);
                  setEntryOffset(
                    Math.floor((item.matchedEntryOffset ?? 0) / entryLimit) *
                      entryLimit,
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
                    {item.models.length > 1 ? (
                      'Multiple models'
                    ) : item.models.length ? (
                      <ModelBadges models={item.models} />
                    ) : (
                      'Model unavailable'
                    )}
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
          </div>
          {page && (
            <div className="session-list-pagination">
              <Pagination
                offset={offset}
                total={page.total}
                onChange={setOffset}
                label="Session pages"
              />
            </div>
          )}
        </aside>
        <div className="session-detail" aria-label="Selected session">
          <div className="session-detail-toolbar">
            <button
              type="button"
              ref={listToggleRef}
              aria-label={toggleLabel}
              title={toggleLabel}
              aria-controls="session-list"
              aria-expanded={listVisible}
              onClick={() => {
                if (listVisible)
                  listScroll.current = listRowsRef.current?.scrollTop ?? 0;
                setFilterEditor(null);
                toggledList.current = true;
                setListVisible(!listVisible);
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
                <path d={listVisible ? 'm7 10-2 2 2 2' : 'm5 10 2 2-2 2'} />
              </svg>
            </button>
            {summary && (
              <div className="session-status">
                <p>
                  {summary.snapshot
                    ? 'Imported snapshot'
                    : stateNames[summary.state]}
                  {summary.stateScope === 'turn' ? ' — turn scope' : ''}
                </p>
                {!summary.snapshot && now - summary.observedAt > 30000 && (
                  <p className="warning">
                    Observation stale: no new records for 30s or more. Long
                    operations may be silent.
                  </p>
                )}
              </div>
            )}
          </div>
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
              </header>
              <details
                className="session-overview"
                open={overviewOpen}
                onToggle={(event) => setOverviewOpen(event.currentTarget.open)}
              >
                <summary>Session information and usage</summary>
                <div className="detail-heading">
                  <h3>Session information</h3>
                  <p>
                    Models: <ModelBadges models={summary.models} />
                  </p>
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
                  {!summary.snapshot && now - summary.observedAt <= 30000 && (
                    <p className="muted">
                      Showing the latest exported observations.
                    </p>
                  )}
                </div>
                <h3>Session usage</h3>
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
              </details>
              {[...new Set([...detail!.warnings, ...summary.usage.warnings])]
                .length > 0 && (
                <details className="coverage">
                  <summary>
                    Data coverage and limitations (
                    {
                      new Set([...detail!.warnings, ...summary.usage.warnings])
                        .size
                    }{' '}
                    warnings)
                  </summary>
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
                <div className="conversation-controls">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={hideEmptyPreviews}
                      onChange={(event) => {
                        setHideEmptyPreviews(event.target.checked);
                        setEntryOffset(0);
                      }}
                    />
                    Hide empty assistant previews
                  </label>
                  <div className="conversation-page-controls">
                    <label className="entry-limit">
                      Entries per page
                      <select
                        value={entryLimit}
                        onChange={(event) => {
                          setEntryLimit(Number(event.target.value));
                          setEntryOffset(0);
                        }}
                      >
                        {[25, 50, 100, 150].map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div
                      className="conversation-order"
                      role="group"
                      aria-label="Conversation order"
                    >
                      {(['desc', 'asc'] as const).map((order) => {
                        const label =
                          order === 'desc'
                            ? 'Descending (newest first)'
                            : 'Ascending (oldest first)';
                        return (
                          <button
                            key={order}
                            type="button"
                            aria-label={label}
                            title={label}
                            aria-pressed={entryOrder === order}
                            onClick={() => {
                              setEntryOrder(order);
                              setEntryOffset(0);
                            }}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path
                                d={
                                  order === 'desc'
                                    ? 'M12 5v14m-5-5 5 5 5-5'
                                    : 'M12 19V5m-5 5 5-5 5 5'
                                }
                              />
                            </svg>
                          </button>
                        );
                      })}
                    </div>
                  </div>
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
                    <pre
                      role={
                        entry.role === 'original-user' ? 'region' : undefined
                      }
                      aria-label={
                        entry.role === 'original-user'
                          ? `Original prompt ${entryOffset + index + 1} text`
                          : undefined
                      }
                      tabIndex={entry.role === 'original-user' ? 0 : undefined}
                      ref={(body) => {
                        if (
                          !body ||
                          entry.role !== 'original-user' ||
                          entry.id !== matched ||
                          !query.trim()
                        )
                          return;
                        const key = `${selected}:${matched}:${query}`;
                        if (revealedMatches.current.get(body) === key) return;
                        revealPromptMatch(body, query);
                        revealedMatches.current.set(body, key);
                      }}
                    >
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
                    {hideEmptyPreviews
                      ? 'No conversation entries match these display settings.'
                      : 'Original prompts are unavailable from this source. Import a chat export to browse and reuse them.'}
                  </p>
                )}
                {entries && (
                  <Pagination
                    offset={entryOffset}
                    total={entries.total}
                    limit={entryLimit}
                    onChange={setEntryOffset}
                    label="Conversation pages"
                  />
                )}
              </section>
              <details className="activity" key={summary.id}>
                <summary>
                  <span className="activity-title">Observed activity</span>
                  <span className="muted">
                    {detail!.counts.modelCalls} model calls /{' '}
                    {detail!.counts.toolCalls} tool calls observed
                  </span>
                </summary>
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
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
