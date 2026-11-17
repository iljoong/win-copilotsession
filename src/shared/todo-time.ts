export function todoTime(
  value: string | number | null,
): { value: number; clock: 'source' | 'instant' } | null {
  if (typeof value !== 'string') return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (!match) return null;
  const base = `${match[1]}T${match[2]}`;
  const local = Date.parse(`${base}${match[3] ?? ''}Z`);
  if (
    !Number.isFinite(local) ||
    new Date(local).toISOString().slice(0, 19) !== base
  )
    return null;
  const time = Date.parse(`${base}${match[3] ?? ''}${match[4] ?? 'Z'}`);
  return Number.isFinite(time)
    ? { value: time, clock: match[4] ? 'instant' : 'source' }
    : null;
}

export function todoSpanLabel(spanMs: number | null): string {
  if (spanMs === null) return 'Time range unavailable';
  if (spanMs === 0) return 'Same timestamp recorded';
  if (spanMs < 1000) return `${spanMs}ms`;
  const seconds = Math.floor(spanMs / 1000);
  const parts = [
    seconds >= 86400 ? `${Math.floor(seconds / 86400)}d` : '',
    seconds >= 3600 ? `${Math.floor((seconds % 86400) / 3600)}h` : '',
    seconds >= 60 ? `${Math.floor((seconds % 3600) / 60)}m` : '',
    seconds % 60 ? `${seconds % 60}s` : '',
  ];
  return parts.filter(Boolean).join(' ');
}
