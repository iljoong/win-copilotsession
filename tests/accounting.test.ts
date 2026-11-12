import { expect, test } from 'vitest';
import type { UsageObservation } from '../src/shared/contracts.js';
import { projectUsage } from '../src/server/data/accounting.js';

function usage(overrides: Partial<UsageObservation> = {}): UsageObservation {
  return {
    id: 'call',
    scope: 'call',
    origin: 'cli-history',
    model: 'model-a',
    input: 100,
    output: 20,
    cacheRead: 60,
    cacheWrite: null,
    reasoning: 5,
    aic: null,
    start: null,
    end: null,
    ...overrides,
  };
}
test('parentAndChildrenCountOnce', () => {
  const result = projectUsage([
    usage({ id: 'parent', scope: 'invocation' }),
    usage({ id: 'a', input: 60, parentId: 'parent' }),
    usage({ id: 'b', input: 40, parentId: 'parent' }),
  ]);
  expect(result.input).toBe(100);
});
test('tokenSubsetsAreNotAddedToTotals', () => {
  expect(projectUsage([usage()])).toMatchObject({
    input: 100,
    output: 20,
    cacheRead: 60,
    reasoning: 5,
    aic: null,
    cacheShare: 0.6,
  });
});
test('reportedZeroIsNotUnavailable', () => {
  expect(projectUsage([usage({ aic: 0 })]).aic).toBe(0);
});
test('overlappingInvocationIntervalsAreUnioned', () => {
  const result = projectUsage([
    usage({ id: 'a', scope: 'invocation', start: 0, end: 100 }),
    usage({ id: 'b', scope: 'invocation', start: 50, end: 150 }),
  ]);
  expect(result.agentMs).toBe(150);
});
test('authoritativeSessionTotalsReplaceCalls', () => {
  const result = projectUsage([
    usage(),
    usage({ id: 'total', scope: 'session', authoritative: true, input: 300 }),
  ]);
  expect(result.input).toBe(300);
});
test('duplicateCallIdentityIsNotCountedTwice', () => {
  expect(projectUsage([usage(), usage()]).input).toBe(100);
});
test('missingFieldsRemainPartial', () => {
  const result = projectUsage([usage(), usage({ id: 'b', input: null })]);
  expect(result.input).toBe(100);
  expect(result.coverage.input).toBe('partial');
});
test('cacheShareUsesOnlyCompatibleKnownCounts', () => {
  const result = projectUsage([
    usage(),
    usage({ id: 'b', input: 100, cacheRead: null }),
  ]);
  expect(result.cacheShare).toBe(0.6);
  expect(result.warnings.join(' ')).toMatch(/cache/i);
});
