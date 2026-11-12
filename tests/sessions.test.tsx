// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsPage } from '../src/client/sessions.js';
import { createClientHarness } from './client-harness.js';

let harness: Awaited<ReturnType<typeof createClientHarness>>;
beforeEach(async () => {
  harness = await createClientHarness();
});
afterEach(async () => {
  cleanup();
  await harness.close();
});
test('selectSessionShowsFullPrompt', async () => {
  const full = 'Original text '.repeat(200) + 'beyond preview boundary';
  harness.store.commitBatch({
    records: [harness.entry('one', full)],
    warnings: [],
  });
  render(<SessionsPage />);
  const entry = await screen.findByRole('article', {
    name: 'Original prompt 1',
  });
  expect(entry.querySelector('pre')?.textContent).toBe(full);
});
test('copyPreservesExactOriginalText', async () => {
  const user = userEvent.setup();
  const full = '\r\n  café e\u0301 😀\r\n';
  harness.store.commitBatch({
    records: [harness.entry('one', full)],
    warnings: [],
  });
  render(<SessionsPage />);
  await user.click(
    await screen.findByRole('button', { name: 'Copy prompt 1' }),
  );
  expect(await navigator.clipboard.readText()).toBe(full);
  expect(
    await screen.findByText('Copied original prompt.'),
  ).toBeInTheDocument();
});
test('assistantPreviewNeverExecutesMarkup', async () => {
  harness.store.commitBatch({
    records: [
      harness.entry('one', 'Prompt'),
      harness.entry('one', '<img src=x onerror=alert(1)>', {
        eventId: 'answer',
        role: 'assistant-preview',
      }),
    ],
    warnings: [],
  });
  render(<SessionsPage />);
  expect(
    await screen.findByText('<img src=x onerror=alert(1)>'),
  ).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});
test('searchOpensMatchingPromptBeyondFirstPage', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: Array.from({ length: 60 }, (_, n) =>
      harness.entry(
        'one',
        n === 59 ? 'needle in a later prompt' : `Prompt number ${n}`,
        { eventId: `p${n}` },
      ),
    ),
    warnings: [],
  });
  render(<SessionsPage />);
  await screen.findByRole('article', { name: 'Original prompt 1' });
  await user.type(
    screen.getByRole('searchbox', { name: 'Search original prompts' }),
    'needle',
  );
  expect(
    await screen.findByText('needle in a later prompt'),
  ).toBeInTheDocument();
});
test('snapshotAndIdleAreNotCompleted', async () => {
  const base = harness.entry('one', 'Idle conversation');
  harness.store.commitBatch({
    records: [
      base,
      { ...base, eventId: 'state', kind: 'session', state: 'idle' },
    ],
    warnings: [],
  });
  render(<SessionsPage />);
  await screen.findByRole('article', { name: 'Original prompt 1' });
  expect(screen.getAllByText('Idle').length).toBeGreaterThan(0);
  expect(
    within(screen.getByLabelText('Selected session')).queryByText('Completed'),
  ).toBeNull();
});
test('multiModelSessionShowsBreakdown', async () => {
  harness.store.commitBatch({
    records: [
      harness.entry('one', 'Multi-model prompt', { model: 'model-a' }),
      harness.entry('one', 'Answer', {
        eventId: 'answer',
        role: 'assistant-preview',
        model: 'model-b',
      }),
    ],
    warnings: [],
  });
  render(<SessionsPage />);
  await screen.findByRole('article', { name: 'Original prompt 1' });
  expect(screen.getAllByText(/model-a/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/model-b/).length).toBeGreaterThan(0);
});
test('activityShowsSourceTimeAndFreshness', async () => {
  const base = harness.entry('one', 'Prompt');
  harness.store.commitBatch({
    records: [
      base,
      {
        ...base,
        kind: 'activity',
        eventId: 'tool',
        operation: 'tool',
        phase: 'end',
        label: 'Tool completed',
      },
      {
        ...base,
        kind: 'session',
        eventId: 'active',
        state: 'active',
        stateScope: 'turn',
      },
    ],
    warnings: [],
  });
  render(<SessionsPage />);
  expect(await screen.findByText('Tool completed')).toBeInTheDocument();
  expect(screen.getByText(/Observation stale/)).toBeInTheDocument();
  expect(screen.getByText(/Source time/)).toBeInTheDocument();
});
test('olderSelectionResponseCannotOverwriteNewSelection', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [
      harness.entry('a', 'Alpha', { timestamp: 2000 }),
      harness.entry('b', 'Beta', { timestamp: 1000 }),
    ],
    warnings: [],
  });
  const first = harness.store.listSessions({
    sort: 'lastActivity',
    offset: 0,
    limit: 50,
  }).items[0];
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  harness.delay(async (path) => {
    if (path === `/api/sessions/${first.id}`) await gate;
  });
  render(<SessionsPage />);
  await user.click(await screen.findByRole('button', { name: 'Open Beta' }));
  expect(
    await screen.findByRole('heading', { name: 'Beta' }),
  ).toBeInTheDocument();
  release();
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument(),
  );
});

test('clipboardUnavailableShowsRecoverableMessage', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [harness.entry('one', 'Prompt')],
    warnings: [],
  });
  render(<SessionsPage />);
  const button = await screen.findByRole('button', { name: 'Copy prompt 1' });
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
  try {
    await user.click(button);
    expect(
      await screen.findByText(
        'Clipboard access failed. Select and copy the prompt text manually.',
      ),
    ).toBeInTheDocument();
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
  }
});
