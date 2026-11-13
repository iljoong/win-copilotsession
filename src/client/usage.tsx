import { useEffect, useState } from 'react';
import type { Coverage, MetricKey, UsageReport } from '../shared/contracts.js';
import { apiRequest, subscribeChanges } from './api.js';

const number = (value: number) =>
  value.toLocaleString(undefined, { maximumSignificantDigits: 9 });
export function formatMetric(
  value: number | null,
  coverage: Coverage,
  unit: 'tokens' | 'aic' | 'milliseconds',
): string {
  if (value === null || coverage === 'unavailable') return 'Unavailable';
  const formatted =
    unit === 'milliseconds'
      ? `${number(value / 1000)} s`
      : `${number(value)} ${unit === 'aic' ? 'AIC' : 'tokens'}`;
  return formatted + (coverage === 'partial' ? ' (partial)' : '');
}
const metrics: [MetricKey, string][] = [
  ['input', 'Input tokens'],
  ['output', 'Output tokens'],
  ['cacheRead', 'Cache-read tokens'],
  ['cacheWrite', 'Cache-write tokens'],
  ['reasoning', 'Reasoning tokens'],
  ['aic', 'Reported AIC'],
];
export function UsagePage() {
  const initial = new URLSearchParams(window.location.search);
  const [source, setSource] = useState(initial.get('source') ?? '');
  const [model, setModel] = useState(initial.get('model') ?? '');
  const [from, setFrom] = useState(initial.get('from') ?? '');
  const [to, setTo] = useState(initial.get('to') ?? '');
  const [report, setReport] = useState<UsageReport | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(
    () =>
      subscribeChanges(
        () => setVersion((v) => v + 1),
        () => setVersion((v) => v + 1),
      ),
    [],
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ source, model, from, to })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState({}, '', url);
    const controller = new AbortController();
    const params = new URLSearchParams({ source, model });
    if (from)
      params.set('from', String(new Date(`${from}T00:00:00`).getTime()));
    if (to) params.set('to', String(new Date(`${to}T23:59:59.999`).getTime()));
    setLoading(true);
    setError('');
    void apiRequest<UsageReport>(`/api/usage?${params}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setReport(value);
          setLoading(false);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not load usage.',
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [source, model, from, to, version]);
  return (
    <section className="usage-page">
      <form
        className="filters usage-filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <label>
          Source
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">All sources</option>
            <option value="cli-history">CLI history</option>
            <option value="cli-telemetry">CLI telemetry</option>
            <option value="vscode-import">VS Code import</option>
            <option value="vscode-telemetry">VS Code telemetry</option>
          </select>
        </label>
        <label>
          Model
          <input
            value={model}
            placeholder="Any model"
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => setVersion((v) => v + 1)}>
          Refresh usage
        </button>
      </form>
      {model && (
        <p className="warning">
          Model selects matching sessions; totals include every model in those
          sessions.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="muted">
          {report
            ? 'Updating usage; previous results remain visible.'
            : 'Loading usage...'}
        </p>
      )}
      {report && !error && (
        <>
          <div className="usage-overview">
            <dl className="usage-ledger">
              {metrics.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd aria-label={label}>
                    {formatMetric(
                      report.totals[key],
                      report.totals.coverage[key],
                      key === 'aic' ? 'aic' : 'tokens',
                    )}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Recorded agent time</dt>
                <dd>
                  {formatMetric(
                    report.totals.agentMs,
                    report.totals.agentMs === null ? 'unavailable' : 'complete',
                    'milliseconds',
                  )}
                </dd>
              </div>
              <div>
                <dt>Cache-read share</dt>
                <dd aria-label="Cache-read share">
                  {report.totals.cacheShare === null
                    ? 'Unavailable'
                    : `${number(report.totals.cacheShare * 100)}%`}
                </dd>
              </div>
            </dl>
            <aside className="usage-notes">
              <h2>Read the coverage first</h2>
              <p>
                {report.sessions} matching sessions. {report.missing} sessions
                without reported AIC; {report.partial} sessions with partial
                metrics; {report.excluded} snapshot sessions excluded from
                combined totals.
              </p>
              <p>
                Cache and reasoning counts are subsets, not added to input or
                output. A reported zero is not missing data.
              </p>
              <p>
                {report.totals.cacheShareRead == null ||
                report.totals.cacheShareInput == null
                  ? 'Cache denominator unavailable.'
                  : `${number(report.totals.cacheShareRead)} cached / ${number(report.totals.cacheShareInput)} compatible input tokens.`}{' '}
                Share uses only records with compatible known input and
                cache-read counts.
              </p>
              <p>
                Agent time uses the union of measured root invocation intervals.
                Wall span includes waiting and is shown separately in each
                session; it is not summed here.
              </p>
              <p>
                These are descriptive usage totals, not a task-quality or
                efficiency ranking. Compare similar tasks before drawing
                conclusions.
              </p>
            </aside>
          </div>
          {!!report.totals.warnings.length && (
            <div className="coverage">
              {report.totals.warnings.map((value) => (
                <p key={value} className="warning">
                  {value}
                </p>
              ))}
            </div>
          )}
          {!report.sessions && (
            <p className="empty">
              No sessions match. Adjust filters or enable a source in Sources.
            </p>
          )}
          <h2>Model breakdown</h2>
          <p className="muted">
            Recorded call-level values may be incomplete or differ from
            authoritative session totals. Unknown models remain separate.
          </p>
          <div className="table-scroll">
            <table aria-label="Usage by model">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Calls</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Cache read</th>
                  <th>Cache write</th>
                  <th>Reasoning</th>
                  <th>Reported AIC</th>
                  <th>Measured inference</th>
                </tr>
              </thead>
              <tbody>
                {report.models.map((row) => (
                  <tr key={row.model}>
                    <th scope="row">{row.model}</th>
                    <td>{number(row.calls)}</td>
                    {metrics.map(([key]) => (
                      <td key={key}>
                        {row[key] === null ? 'Unavailable' : number(row[key]!)}
                      </td>
                    ))}
                    <td>
                      {formatMetric(
                        row.inferenceMs,
                        row.inferenceMs === null ? 'unavailable' : 'complete',
                        'milliseconds',
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="breakdown-heading">Source breakdown</h2>
          <p className="muted">
            Logical client sources, with overlapping history and telemetry
            counted once where identity is verified.
          </p>
          <div className="table-scroll">
            <table aria-label="Usage by source">
              <thead>
                <tr>
                  <th>Source</th>
                  {metrics.map(([key, label]) => (
                    <th key={key}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.sources.map((row) => (
                  <tr key={row.source}>
                    <th scope="row">{row.source}</th>
                    {metrics.map(([key]) => (
                      <td key={key}>
                        {formatMetric(
                          row.usage[key],
                          row.usage.coverage[key],
                          key === 'aic' ? 'aic' : 'tokens',
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
