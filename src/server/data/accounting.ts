import type {
  Amounts,
  Coverage,
  MetricKey,
  UsageObservation,
  UsageSummary,
} from '../../shared/contracts.js';
import { amounts } from '../sources/values.js';

const keys: MetricKey[] = [
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'reasoning',
  'aic',
];

function intervalUnion(intervals: [number, number][]): number | null {
  if (!intervals.length) return null;
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = intervals[0];
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  return total + end - start;
}

export function projectUsage(observations: UsageObservation[]): UsageSummary {
  const warnings: string[] = [];
  const all = [
    ...new Map(
      observations.map((observation) => [
        `${observation.sessionKey ?? ''}:${observation.origin}:${observation.scope}:${observation.id}`,
        observation,
      ]),
    ).values(),
  ];
  const grouped = new Map<string, UsageObservation[]>();
  for (const item of all)
    grouped.set(item.sessionKey ?? '', [
      ...(grouped.get(item.sessionKey ?? '') ?? []),
      item,
    ]);
  const groups = [...grouped.values()].map((rows) => {
    const history = rows.filter(
      (item) => item.scope === 'call' && item.origin === 'cli-history',
    );
    if (
      history.length &&
      rows.some(
        (item) => item.scope === 'call' && item.origin !== 'cli-history',
      )
    ) {
      warnings.push(
        'Overlapping telemetry token totals excluded in favor of CLI history; cross-call correspondence is unverified.',
      );
    }
    return {
      calls: history.length
        ? history
        : rows.filter((item) => item.scope === 'call'),
      roots: rows.filter(
        (item) => item.scope === 'invocation' && !item.parentId,
      ),
      summaries: rows.filter(
        (item) => item.scope === 'session' && item.authoritative,
      ),
    };
  });
  const roots = groups.flatMap((group) => group.roots);
  const values = amounts();
  const coverage = {} as Record<MetricKey, Coverage>;
  for (const key of keys) {
    const candidates = groups.flatMap((group) => {
      const authoritative = group.summaries
        .filter((item) => item[key] !== null)
        .sort((a, b) => (a.end ?? 0) - (b.end ?? 0))
        .at(-1);
      if (authoritative) return [authoritative];
      return group.calls.some((item) => item[key] !== null)
        ? group.calls
        : group.roots;
    });
    const available = candidates.filter((item) => item[key] !== null);
    values[key] = available.length
      ? available.reduce((sum, item) => sum + item[key]!, 0)
      : null;
    coverage[key] = !available.length
      ? 'unavailable'
      : available.length !== candidates.length ||
          available.some((item) => item.coverage?.[key] === 'partial') ||
          warnings.length > 0
        ? 'partial'
        : 'complete';
  }
  const chosen = groups.flatMap((group) =>
    group.calls.length ? group.calls : group.roots,
  );
  const compatible = chosen.filter(
    (item) =>
      item.input !== null &&
      item.cacheRead !== null &&
      item.cacheRead <= item.input,
  );
  const denominator = compatible.reduce((sum, item) => sum + item.input!, 0);
  if (chosen.length && compatible.length !== chosen.length)
    warnings.push(
      'Cache-read share includes only records with compatible known input/cache counts.',
    );
  const modelNames = [
    ...new Set(chosen.map((item) => item.model ?? 'Unknown model')),
  ];
  const models = modelNames.map((model) => {
    const rows = chosen.filter(
      (item) => (item.model ?? 'Unknown model') === model,
    );
    const totals = amounts();
    for (const key of keys) {
      const available = rows.filter((item) => item[key] !== null);
      totals[key] = available.length
        ? available.reduce((sum, item) => sum + item[key]!, 0)
        : null;
    }
    const measured = rows.filter(
      (item) =>
        item.scope === 'call' &&
        item.start !== null &&
        item.end !== null &&
        item.end >= item.start,
    );
    return {
      ...totals,
      model,
      calls: rows.filter((item) => item.scope === 'call').length,
      inferenceMs: measured.length
        ? measured.reduce((sum, item) => sum + item.end! - item.start!, 0)
        : null,
    };
  });
  const intervals = roots.flatMap((item): [number, number][] =>
    item.start !== null && item.end !== null && item.end >= item.start
      ? [[item.start, item.end]]
      : [],
  );
  return {
    ...values,
    coverage,
    models,
    agentMs: intervalUnion(intervals),
    wallMs: null,
    warnings,
    cacheShareInput: compatible.length ? denominator : null,
    cacheShareRead: compatible.length
      ? compatible.reduce((sum, item) => sum + item.cacheRead!, 0)
      : null,
    cacheShare:
      denominator > 0
        ? compatible.reduce((sum, item) => sum + item.cacheRead!, 0) /
          denominator
        : null,
  };
}

export function metricKeys(): (keyof Amounts)[] {
  return keys;
}
