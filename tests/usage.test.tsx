// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UsageObservation } from '../src/shared/contracts.js';
import { UsagePage } from '../src/client/usage.js';
import { createClientHarness } from './client-harness.js';

let harness: Awaited<ReturnType<typeof createClientHarness>>;
beforeEach(async () => {
  harness = await createClientHarness();
});
afterEach(async () => {
  cleanup();
  await harness.close();
});
function seed(session: string, values: Partial<UsageObservation>) {
  const usage: UsageObservation = {
    id: 'call',
    scope: 'call',
    origin: 'cli-history',
    model: 'model-a',
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    aic: null,
    start: null,
    end: null,
    ...values,
  };
  const base = harness.entry(session, `Prompt ${session}`);
  harness.store.commitBatch({
    records: [
      base,
      { ...base, eventId: usage.id, kind: 'usage', model: usage.model, usage },
    ],
    warnings: [],
  });
}
test('unavailableCreditsAreNotReportedZero', async () => {
  seed('one', { input: 100 });
  render(<UsagePage />);
  expect(await screen.findByLabelText('Reported AIC')).toHaveTextContent(
    'Unavailable',
  );
});
test('reportedZeroCreditsRemainZero', async () => {
  seed('one', { aic: 0 });
  render(<UsagePage />);
  expect(await screen.findByLabelText('Reported AIC')).toHaveTextContent(
    /^0 AIC$/,
  );
});
test('partialCreditsShowCoverageAndMissingSessions', async () => {
  seed('one', { aic: 1.5 });
  seed('two', { aic: null });
  render(<UsagePage />);
  expect(await screen.findByLabelText('Reported AIC')).toHaveTextContent(
    '1.5 AIC (partial)',
  );
  expect(
    screen.getByText(/1 sessions without reported AIC/),
  ).toBeInTheDocument();
});
test('cacheShareDisplaysOnlyCompatibleDenominator', async () => {
  seed('one', { input: 100, cacheRead: 60 });
  seed('two', { input: 900, cacheRead: null });
  render(<UsagePage />);
  expect(await screen.findByLabelText('Cache-read share')).toHaveTextContent(
    '60%',
  );
  expect(
    screen.getByText(/60 cached \/ 100 compatible input tokens/),
  ).toBeInTheDocument();
  expect(screen.queryByText('Recorded agent time')).not.toBeInTheDocument();
});
test('tokenSubsetsAreNotAddedTwice', async () => {
  seed('one', { input: 100, output: 20, cacheRead: 60, reasoning: 5 });
  render(<UsagePage />);
  expect(await screen.findByLabelText('Input tokens')).toHaveTextContent(
    /^100 tokens$/,
  );
  expect(screen.getByLabelText('Output tokens')).toHaveTextContent(
    /^20 tokens$/,
  );
  expect(screen.getByText(/not added to input or output/)).toBeInTheDocument();
});
test('multiModelUsageKeepsSeparateCallRows', async () => {
  seed('one', { id: 'a', model: 'model-a', input: 100 });
  seed('one', { id: 'b', model: 'model-b', input: 200 });
  render(<UsagePage />);
  const table = await screen.findByRole('table', { name: 'Usage by model' });
  expect(
    within(within(table).getByRole('row', { name: /model-a/ })).getByText(
      '100',
    ),
  ).toBeInTheDocument();
  expect(
    within(within(table).getByRole('row', { name: /model-b/ })).getByText(
      '200',
    ),
  ).toBeInTheDocument();
});
test('modelFilteredSessionsExplainWholeSessionTotals', async () => {
  const user = userEvent.setup();
  seed('one', { id: 'a', model: 'model-a', input: 100 });
  seed('one', { id: 'b', model: 'model-b', input: 200 });
  render(<UsagePage />);
  await screen.findByLabelText('Input tokens');
  await user.type(screen.getByRole('textbox', { name: 'Model' }), 'model-a');
  expect(
    await screen.findByText(
      /Model selects matching sessions; totals include every model in those sessions/,
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Input tokens')).toHaveTextContent('300 tokens');
});
test('descriptiveComparisonMakesNoEfficiencyRankingClaim', async () => {
  seed('one', { input: 100 });
  render(<UsagePage />);
  await screen.findByLabelText('Input tokens');
  expect(
    screen.getByText(/not a task-quality or efficiency ranking/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/best model|recommended model|efficiency winner/i),
  ).toBeNull();
});
