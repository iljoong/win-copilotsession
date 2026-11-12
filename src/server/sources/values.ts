import type { Amounts } from '../../shared/contracts.js';

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
export function time(value: unknown): number | null {
  if (typeof value === 'number') return number(value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
export function amounts(value: Partial<Amounts> = {}): Amounts {
  return {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    aic: null,
    ...value,
  };
}
