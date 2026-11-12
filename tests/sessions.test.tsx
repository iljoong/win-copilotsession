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
test('conversationDefaultsToNewestFirstAndSortChangesResetPagination', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: Array.from({ length: 33 }, (_, n) =>
      harness.entry('one', `Prompt ${n}`, {
        eventId: `p${n}`,
        timestamp: 1000 + n,
      }),
    ),
    warnings: [],
  });
  render(<SessionsPage />);
  const descending = await screen.findByRole('button', {
    name: 'Descending (newest first)',
  });
  const firstText = () =>
    screen.getAllByRole('article')[0].querySelector('pre')?.textContent;
  expect(descending).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(firstText()).toBe('Prompt 32'));
  await user.click(
    within(
      screen.getByRole('navigation', { name: 'Conversation pages' }),
    ).getByRole('button', { name: 'Next' }),
  );
  await waitFor(() => expect(firstText()).toBe('Prompt 7'));
  const ascending = screen.getByRole('button', {
    name: 'Ascending (oldest first)',
  });
  await user.click(ascending);
  expect(ascending).toHaveAttribute('aria-pressed', 'true');
  expect(descending).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(firstText()).toBe('Prompt 0'));
  await user.click(
    within(
      screen.getByRole('navigation', { name: 'Conversation pages' }),
    ).getByRole('button', { name: 'Next' }),
  );
  await waitFor(() => expect(firstText()).toBe('Prompt 25'));
});
test('conversationPageSizeCountsVisibleEntriesAndResetsOnChanges', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: Array.from({ length: 160 }, (_, n) => [
      harness.entry('one', `Prompt ${n}`, { eventId: `p${n}` }),
      harness.entry(
        'one',
        n % 2 ? `Answer ${n}` : n % 4 ? ' \n\t\u00a0 ' : '',
        { eventId: `a${n}`, role: 'assistant-preview' },
      ),
    ]).flat(),
    warnings: [],
  });
  render(<SessionsPage />);
  const size = await screen.findByRole('combobox', {
    name: 'Entries per page',
  });
  const toggle = screen.getByRole('checkbox', {
    name: 'Hide empty assistant previews',
  });
  const pages = () =>
    within(screen.getByRole('navigation', { name: 'Conversation pages' }));
  expect(size).toHaveValue('25');
  expect(toggle).toBeChecked();
  await waitFor(() => {
    expect(pages().getByText('1–25 of 240')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(25);
  });
  for (const preview of document.querySelectorAll('.assistant-entry pre'))
    expect(preview.textContent?.trim()).not.toBe('');
  await user.click(pages().getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(pages().getByText('26–50 of 240')).toBeInTheDocument(),
  );
  for (const count of [50, 100, 150]) {
    await user.selectOptions(size, String(count));
    await waitFor(() => {
      expect(pages().getByText(`1–${count} of 240`)).toBeInTheDocument();
      expect(screen.getAllByRole('article')).toHaveLength(count);
    });
  }
  await user.click(pages().getByRole('button', { name: 'Next' }));
  await waitFor(() => {
    expect(pages().getByText('151–240 of 240')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(90);
  });
  expect(pages().getByRole('button', { name: 'Next' })).toBeDisabled();
  expect(
    within(screen.getByRole('region', { name: 'Conversation' })).getByText(
      'Prompt 0',
      { exact: true },
    ),
  ).toBeInTheDocument();
  await user.click(toggle);
  await waitFor(() => {
    expect(pages().getByText('1–150 of 320')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(150);
  });
});
test('filteredSearchOffsetsFollowTheSelectedConversationPageSize', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [
      ...Array.from({ length: 60 }, (_, n) =>
        harness.entry('one', ' \n ', {
          eventId: `a${n}`,
          role: 'assistant-preview',
        }),
      ),
      ...Array.from({ length: 31 }, (_, n) =>
        harness.entry('one', n === 30 ? 'filtered needle' : `Prompt ${n}`, {
          eventId: `p${n}`,
        }),
      ),
    ],
    warnings: [],
  });
  render(<SessionsPage />);
  await user.click(
    await screen.findByRole('button', {
      name: 'Ascending (oldest first)',
    }),
  );
  await user.type(
    screen.getByRole('searchbox', { name: 'Search original prompts' }),
    'needle',
  );
  const pages = () =>
    screen.getByRole('navigation', { name: 'Conversation pages' });
  await waitFor(() => {
    expect(screen.getByText('filtered needle')).toBeInTheDocument();
    expect(pages()).toHaveTextContent('26–31 of 31');
  });
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Entries per page' }),
    '50',
  );
  await waitFor(() => {
    expect(screen.getByText('filtered needle')).toBeInTheDocument();
    expect(pages()).toHaveTextContent('1–31 of 31');
  });
  await user.click(
    screen.getByRole('checkbox', { name: 'Hide empty assistant previews' }),
  );
  await waitFor(() => {
    expect(screen.getByText('filtered needle')).toBeInTheDocument();
    expect(pages()).toHaveTextContent('51–91 of 91');
  });
});
test('hidingAllBlankPreviewsKeepsDisplayControlsAvailable', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [harness.entry('one', ' \n\t ', { role: 'assistant-preview' })],
    warnings: [],
  });
  render(<SessionsPage />);
  const toggle = await screen.findByRole('checkbox', {
    name: 'Hide empty assistant previews',
  });
  expect(toggle).toBeChecked();
  expect(
    await screen.findByText(
      'No conversation entries match these display settings.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(
    within(
      screen.getByRole('navigation', { name: 'Conversation pages' }),
    ).getByRole('button', { name: 'Next' }),
  ).toBeDisabled();
  await user.click(toggle);
  expect(
    await screen.findByRole('article', { name: 'Assistant preview 1' }),
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
  await screen.findByRole('article', { name: /^Original prompt/ });
  expect(screen.getAllByText(/model-a/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/model-b/).length).toBeGreaterThan(0);
});
test('activityShowsSourceTimeAndFreshness', async () => {
  const user = userEvent.setup();
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
  const event = await screen.findByText('Tool completed');
  expect(event).not.toBeVisible();
  const toggle = screen.getByText('Observed activity');
  await user.click(toggle);
  expect(event).toBeVisible();
  expect(screen.getByText(/Observation stale/)).toBeInTheDocument();
  expect(screen.getByText(/Source time/)).toBeInTheDocument();
  await user.click(toggle);
  expect(event).not.toBeVisible();
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
