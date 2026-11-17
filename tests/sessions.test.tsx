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
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let harness: Awaited<ReturnType<typeof createClientHarness>>;
beforeEach(async () => {
  harness = await createClientHarness();
});
afterEach(async () => {
  cleanup();
  await harness.close();
});
test('todoTabReadsOnlyWhileActiveAndRefreshesInertSourceFieldsAndProgress', async () => {
  const user = userEvent.setup();
  await mkdir(join(harness.root, 'history', 'a'));
  harness.store.saveSource({
    id: 'source',
    kind: 'cli-history',
    enabled: true,
    path: join(harness.root, 'history'),
  });
  harness.store.commitBatch({
    records: [harness.entry('a', 'Alpha'), harness.entry('b', 'Beta')],
    warnings: [],
  });
  const db = new DatabaseSync(join(harness.root, 'history', 'a', 'session.db'));
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE todos(id TEXT, created_at TEXT, title TEXT, status TEXT);
      INSERT INTO todos VALUES ('build','2026-11-17 01:00:00','<img src=x onerror=alert(1)>','in_progress');`);
    let reads = 0;
    harness.delay(async (path) => {
      if (path.endsWith('/todos')) reads++;
    });
    render(<SessionsPage />);
    const todoTab = await screen.findByRole('tab', { name: 'Todo status' });
    expect(todoTab).toHaveAttribute('aria-selected', 'false');
    expect(reads).toBe(0);
    await user.click(todoTab);
    await user.click(screen.getByRole('button', { name: 'All tasks' }));
    await screen.findByRole('cell', { name: 'in_progress' });
    const panel = screen.getByRole('tabpanel', { name: 'Todo status' });
    const table = within(panel).getByRole('table');
    expect(
      within(panel).getByRole('progressbar', { name: 'TODO completion' }),
    ).toHaveValue(0);
    expect(within(panel).getByText('0%')).toBeVisible();
    expect(within(table).getByRole('cell', { name: 'build' })).toBeVisible();
    expect(
      within(table).getByRole('cell', { name: '2026-11-17 01:00:00' }),
    ).toBeVisible();
    expect(
      within(table).getByRole('cell', { name: '<img src=x onerror=alert(1)>' }),
    ).toBeVisible();
    expect(table.querySelector('img')).toBeNull();
    db.exec("UPDATE todos SET status='done'");
    await waitFor(
      () =>
        expect(within(table).getByRole('cell', { name: 'done' })).toBeVisible(),
      { timeout: 4000 },
    );
    expect(within(panel).getByText('100%')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Conversation' }));
    const closedReads = reads;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(reads).toBe(closedReads);
    await user.click(todoTab);
    await user.click(screen.getByRole('button', { name: 'Open Beta' }));
    await screen.findByRole('heading', { name: 'Beta' });
    await user.click(screen.getByRole('button', { name: 'All tasks' }));
    const next = screen.getByRole('tabpanel', { name: 'Todo status' });
    await waitFor(() =>
      expect(within(next).getByText(/TODO data unavailable/)).toBeVisible(),
    );
    expect(within(next).queryByRole('cell', { name: 'build' })).toBeNull();
    expect(within(next).getByText('Progress unavailable')).toBeVisible();
    expect(within(next).queryByRole('progressbar')).toBeNull();
  } finally {
    db.close();
  }
});
test('todoPaginationUsesGlobalProgressKeepsPageAcrossTabsAndRecoversAfterDeletion', async () => {
  const user = userEvent.setup();
  await mkdir(join(harness.root, 'history', 'a'));
  harness.store.saveSource({
    id: 'source',
    kind: 'cli-history',
    enabled: true,
    path: join(harness.root, 'history'),
  });
  harness.store.commitBatch({
    records: [harness.entry('a', 'Alpha')],
    warnings: [],
  });
  const db = new DatabaseSync(join(harness.root, 'history', 'a', 'session.db'));
  try {
    db.exec(
      'CREATE TABLE todos(id TEXT, created_at INTEGER, title TEXT, status TEXT)',
    );
    const insert = db.prepare(
      "INSERT INTO todos VALUES (?,?,'Task','pending')",
    );
    for (let n = 0; n < 51; n++) insert.run(`task-${n}`, n);
    db.exec(
      "UPDATE todos SET status='done' WHERE id IN ('task-0','task-1','task-2')",
    );
    render(<SessionsPage />);
    await user.click(await screen.findByRole('tab', { name: 'Todo status' }));
    await user.click(screen.getByRole('button', { name: 'All tasks' }));
    await screen.findByRole('cell', { name: 'task-50' });
    expect(screen.getByText('5.9%')).toBeVisible();
    expect(screen.getByText('3 of 51 tasks done')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next TODOs' }));
    await screen.findByRole('cell', { name: 'task-0' });
    expect(screen.queryByRole('cell', { name: 'task-50' })).toBeNull();
    expect(screen.getByText('5.9%')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Session Info' }));
    await user.click(screen.getByRole('tab', { name: 'Todo status' }));
    expect(screen.getByRole('cell', { name: 'task-0' })).toBeVisible();
    db.exec('DELETE FROM todos');
    await waitFor(
      () =>
        expect(
          screen.getByText('No TODO items in this session.'),
        ).toBeVisible(),
      { timeout: 4000 },
    );
    expect(screen.queryByRole('cell', { name: 'task-0' })).toBeNull();
    expect(screen.getByText('Progress unavailable')).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
  } finally {
    db.close();
  }
});
async function groupFixture() {
  const directory = join(harness.root, 'history', 'a');
  await mkdir(directory);
  harness.store.saveSource({
    id: 'source',
    kind: 'cli-history',
    enabled: true,
    path: join(harness.root, 'history'),
  });
  harness.store.commitBatch({
    records: [harness.entry('a', 'Alpha')],
    warnings: [],
  });
  const db = new DatabaseSync(join(directory, 'session.db'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE todos(id TEXT, created_at TEXT, updated_at TEXT, title TEXT, status TEXT);
    CREATE TABLE todo_deps(todo_id TEXT, depends_on TEXT);`);
  return db;
}
test('todoCardsShowOnlyDependenciesWithIdCreationTimeAndStatus', async () => {
  const user = userEvent.setup();
  const db = await groupFixture();
  try {
    db.exec(`INSERT INTO todos VALUES
      ('job-checks','2026-11-17 04:18:07','2026-11-17 04:18:31','<img src=x onerror=alert(1)>','done'),
      ('job-docs','2026-11-17 04:18:07','2026-11-17 04:20:39','Document','in_progress'),
      ('job-review','2026-11-17 04:18:07','2026-11-17 04:21:15','Review','custom_status'),
      ('single','2026-11-17 04:19:00','2026-11-17 04:19:00','Standalone','done');
      INSERT INTO todo_deps VALUES ('job-docs','job-checks'),('job-review','job-docs');`);
    render(<SessionsPage />);
    await user.click(await screen.findByRole('tab', { name: 'Todo status' }));
    expect(screen.getByRole('button', { name: 'Groups' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const job = await screen.findByRole('group', { name: 'TODO group job' });
    const single = screen.getByRole('group', { name: 'TODO group Standalone' });
    await waitFor(() => expect(job).toHaveAttribute('open'));
    expect(single).not.toHaveAttribute('open');
    expect(
      within(job).getByRole('progressbar', { name: 'job completion' }),
    ).toHaveValue(1);
    expect(within(job).getByText('33.3%')).toBeVisible();
    expect(within(job).getByText('custom_status: 1')).toBeVisible();
    expect(within(job).getByText('3m 8s')).toBeVisible();
    const graph = await within(job).findByRole('img', {
      name: 'Dependency graph for job',
    });
    const metadata = within(graph).getByText('job-checks').parentElement!;
    expect(
      Array.from(metadata.children).map((field) => field.textContent),
    ).toEqual(['job-checks', '2026-11-17 04:18:07', 'done']);
    expect(
      within(job)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Dependencies']);
    expect(
      within(job).queryByRole('region', { name: 'Last modification timeline' }),
    ).toBeNull();
    expect(within(job).queryByRole('table')).toBeNull();
    expect(
      within(graph).getByText('<img src=x onerror=alert(1)>'),
    ).toBeVisible();
    expect(job.querySelector('img')).toBeNull();
    db.exec("UPDATE todos SET status='done' WHERE id LIKE 'job-%'");
    await waitFor(
      () =>
        expect(
          within(job).getByRole('progressbar', { name: 'job completion' }),
        ).toHaveValue(3),
      { timeout: 4000 },
    );
    expect(
      screen.getByRole('group', { name: 'TODO group job' }),
    ).toHaveAttribute('open');
    await user.click(screen.getByRole('tab', { name: 'Session Info' }));
    await user.click(screen.getByRole('tab', { name: 'Todo status' }));
    expect(job).toHaveAttribute('open');
    await user.selectOptions(screen.getByLabelText('Group order'), 'created');
    await waitFor(() =>
      expect(
        screen.getAllByRole('group', { name: /^TODO group / })[0],
      ).toHaveAccessibleName('TODO group Standalone'),
    );
    await user.click(
      within(
        screen.getByRole('group', { name: 'TODO group Standalone' }),
      ).getByText('Standalone', { exact: true }),
    );
    await screen.findByRole('img', { name: 'Dependency graph for Standalone' });
    expect(
      within(
        screen.getByRole('group', { name: 'TODO group Standalone' }),
      ).getByText('Same timestamp recorded'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'All tasks' }));
    await screen.findByRole('table', { name: 'Session TODOs' });
    expect(
      screen.getByRole('columnheader', { name: 'updated_at' }),
    ).toBeVisible();
  } finally {
    db.close();
  }
});
test('todoDependencyCardsRefreshAllNodesAndPreserveExpansionAcrossTabs', async () => {
  const user = userEvent.setup();
  const db = await groupFixture();
  try {
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<50)
      INSERT INTO todos SELECT printf('task-%03d',x),'2026-11-17 01:00:00','2026-11-17 01:01:00','Task','pending' FROM n;
      INSERT INTO todo_deps SELECT id,'task-000' FROM todos WHERE id!='task-000';
      UPDATE todos SET created_at=NULL WHERE id='task-000';
      UPDATE todos SET created_at=0 WHERE id='task-001';`);
    let reads = 0;
    harness.delay(async (path) => {
      if (path.endsWith('/todo-groups')) reads++;
    });
    render(<SessionsPage />);
    await user.click(await screen.findByRole('tab', { name: 'Todo status' }));
    let graph = await screen.findByRole('img', {
      name: 'Dependency graph for task',
    });
    expect(within(graph).getByText('task-050')).toBeVisible();
    const missingTime = within(graph).getByText('task-000').parentElement!;
    expect(within(missingTime).getByText('Unavailable')).toBeVisible();
    const zeroTime = within(graph).getByText('task-001').parentElement!;
    expect(within(zeroTime).getByText('0')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Next group tasks' }),
    ).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Conversation' }));
    const stopped = reads;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(reads).toBe(stopped);
    await user.click(screen.getByRole('tab', { name: 'Todo status' }));
    graph = await screen.findByRole('img', {
      name: 'Dependency graph for task',
    });
    expect(within(graph).getByText('task-000')).toBeVisible();
    db.exec("DELETE FROM todos WHERE id='task-050'");
    await waitFor(
      () => expect(within(graph).queryByText('task-050')).toBeNull(),
      { timeout: 4000 },
    );
    expect(within(graph).getByText('task-049')).toBeVisible();
    db.exec('DROP TABLE todo_deps; ALTER TABLE todos DROP COLUMN updated_at;');
    await waitFor(
      () =>
        expect(screen.getByText(/Dependency data unavailable/)).toBeVisible(),
      { timeout: 4000 },
    );
    expect(
      screen.getAllByText('Time range unavailable').length,
    ).toBeGreaterThan(0);
    db.exec('DELETE FROM todos');
    await waitFor(
      () =>
        expect(
          screen.getByText('No TODO items in this session.'),
        ).toBeVisible(),
      { timeout: 4000 },
    );
    expect(screen.queryByRole('table', { name: 'Group tasks' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  } finally {
    db.close();
  }
});
test('searchExpanderDefaultsCollapsedAndRetainsFilters', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [
      harness.entry('a', 'Alpha one', { timestamp: 2000 }),
      harness.entry('b', 'Alpha two'),
    ],
    warnings: [],
  });
  render(<SessionsPage />);
  const summary = screen.getByText(/^Search and filters/);
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('searchbox')).not.toBeVisible();
  await user.click(summary);
  await user.type(
    screen.getByRole('searchbox', { name: 'Search original prompts' }),
    'Alpha',
  );
  await user.click(screen.getByRole('button', { name: 'Source' }));
  await user.click(summary);
  expect(summary).toHaveTextContent('1 filter');
  expect(screen.getByRole('searchbox')).not.toBeVisible();
  await user.click(
    await screen.findByRole('button', { name: 'Open Alpha two' }),
  );
  await screen.findByRole('heading', { name: 'Alpha two' });
  await user.click(screen.getByRole('button', { name: 'Hide sessions' }));
  await user.click(screen.getByRole('button', { name: /^Show sessions/ }));
  expect(summary.closest('details')).not.toHaveAttribute('open');
  await user.click(summary);
  expect(screen.getByRole('searchbox')).toHaveValue('Alpha');
  expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await user.click(screen.getByRole('button', { name: 'Hide sessions' }));
  await user.click(screen.getByRole('button', { name: /^Show sessions/ }));
  expect(summary.closest('details')).toHaveAttribute('open');
  expect(new URLSearchParams(window.location.search).get('q')).toBe('Alpha');
});
test('sidebarToggleIsAnIconInsideTheDetailPanelWithoutSelection', async () => {
  const user = userEvent.setup();
  render(<SessionsPage />);
  await screen.findByRole('heading', { name: 'No matching sessions' });
  const button = screen.getByRole('button', { name: 'Hide sessions' });
  expect(screen.getByLabelText('Selected session').contains(button)).toBe(true);
  expect(button.textContent).toBe('');
  expect(button.querySelector('svg')).not.toBeNull();
  await user.click(button);
  const restore = screen.getByRole('button', { name: /^Show sessions/ });
  expect(restore).toHaveFocus();
  expect(screen.getByLabelText('Selected session').contains(restore)).toBe(
    true,
  );
});
test('detailTabsDefaultToConversationAndSupportKeyboardAndSessionSwitching', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [
      harness.entry('a', 'Alpha', { model: 'model-a', timestamp: 2000 }),
      harness.entry('b', 'Beta', { model: 'model-b', timestamp: 1000 }),
    ],
    warnings: [],
  });
  render(<SessionsPage />);
  const conversation = await screen.findByRole('tab', { name: 'Conversation' });
  const info = screen.getByRole('tab', { name: 'Session Info' });
  expect(
    within(screen.getByRole('tablist', { name: 'Session details' }))
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['Conversation', 'Session Info', 'Todo status']);
  expect(conversation).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: 'Conversation' })).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: 'Session information' }),
  ).toBeNull();
  await user.click(conversation);
  await user.keyboard('{ArrowRight}');
  expect(info).toHaveFocus();
  expect(info).toHaveAttribute('aria-selected', 'true');
  const overview = screen.getByRole('tabpanel', { name: 'Session Info' });
  expect(info).toHaveAttribute('aria-controls', overview.id);
  expect(overview).toHaveAttribute('aria-labelledby', info.id);
  expect(within(overview).getByText('Session information')).toBeVisible();
  expect(within(overview).getByText('Session usage')).toBeVisible();
  expect(overview.querySelectorAll('.metrics > div')).toHaveLength(8);
  await user.click(screen.getByRole('button', { name: 'Open Beta' }));
  await screen.findByRole('heading', { name: 'Beta' });
  expect(screen.getByRole('tab', { name: 'Session Info' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('heading', { name: 'Session usage' })).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'Session Info' }));
  await user.keyboard('{End}');
  expect(screen.getByRole('tab', { name: 'Todo status' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Todo status' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Todo status' })).toHaveFocus();
  await user.keyboard('{Home}');
  expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveFocus();
});
test('detailTabsKeepObservedStateAndMetricAvailabilityButRemoveCoverageDetails', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [
      harness.entry('a', 'Stale turn'),
      harness.entry('a', '', {
        eventId: 'state',
        kind: 'session',
        state: 'active',
        stateScope: 'turn',
      }),
    ],
    warnings: ['Old detailed coverage warning'],
  });
  render(<SessionsPage />);
  await screen.findByRole('tab', { name: 'Session Info' });
  expect(screen.getByText(/Observation stale/)).toBeVisible();
  expect(screen.getByText(/— turn scope/)).toBeVisible();
  const toolbar = screen.getByRole('button', {
    name: 'Hide sessions',
  }).parentElement!;
  expect(
    within(toolbar).getByText('Active (observed) — turn scope'),
  ).toBeVisible();
  expect(within(toolbar).getByText(/Observation stale/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Hide sessions' }));
  expect(within(toolbar).getByText(/Observation stale/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: /^Show sessions/ }));
  expect(screen.queryByText(/Data coverage and limitations/)).toBeNull();
  expect(screen.queryByText('Old detailed coverage warning')).toBeNull();
  await user.click(screen.getByRole('tab', { name: 'Session Info' }));
  expect(screen.getAllByText('Unavailable')[0]).toBeVisible();
  expect(screen.queryByText('Old detailed coverage warning')).toBeNull();
});
test('sidebarFiltersPreserveQueriesAndClearGroups', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [harness.entry('a', 'Alpha', { model: 'gpt-fixture' })],
    warnings: [],
  });
  render(<SessionsPage />);
  await screen.findByRole('article', { name: /^Original prompt/ });
  const sidebar = screen.getByRole('complementary', { name: 'Session list' });
  await user.click(screen.getByText(/^Search and filters/));
  const search = screen.getByRole('searchbox', {
    name: 'Search original prompts',
  });
  expect(sidebar.contains(search)).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Reported AIC' }));
  await user.click(screen.getByRole('button', { name: 'Model' }));
  await user.type(screen.getByRole('textbox', { name: 'Model' }), 'gpt');
  await user.click(screen.getByRole('button', { name: 'Date range' }));
  await user.type(screen.getByLabelText('From', { exact: true }), '2026-11-01');
  await user.type(screen.getByLabelText('To', { exact: true }), '2026-11-13');
  await user.click(screen.getByRole('button', { name: 'Clear Date range' }));
  expect(new URLSearchParams(window.location.search).has('from')).toBe(false);
  expect(new URLSearchParams(window.location.search).has('to')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  const params = new URLSearchParams(window.location.search);
  expect(params.get('sort')).toBe('credits');
  expect(params.has('model')).toBe(false);
  expect(screen.getByRole('button', { name: 'Reported AIC' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
test('filterEditorsHaveExclusiveKeyboardDisclosure', async () => {
  const user = userEvent.setup();
  render(<SessionsPage />);
  await user.click(screen.getByText(/^Search and filters/));
  const source = screen.getByRole('button', { name: 'Source' });
  await user.click(source);
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  const state = screen.getByRole('button', { name: 'State' });
  await user.click(state);
  expect(source).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getAllByRole('radio')).toHaveLength(7);
  await user.click(screen.getByRole('radio', { name: 'Completed' }));
  expect(new URLSearchParams(window.location.search).get('state')).toBe(
    'completed',
  );
  await user.keyboard('{Escape}');
  expect(state).toHaveFocus();
  expect(state).toHaveAttribute('aria-expanded', 'false');
});
test('hideRestoreRetainsSessionAndControls', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: Array.from({ length: 40 }, (_, n) =>
      harness.entry('one', `Prompt ${n}`, {
        eventId: `p${n}`,
        timestamp: 1000 + n,
      }),
    ),
    warnings: [],
  });
  render(<SessionsPage />);
  await screen.findByRole('article', { name: 'Original prompt 1' });
  await user.click(
    screen.getByRole('button', { name: 'Ascending (oldest first)' }),
  );
  await within(screen.getByRole('region', { name: 'Conversation' })).findByText(
    'Prompt 0',
    { exact: true },
  );
  await user.click(
    within(
      screen.getByRole('navigation', { name: 'Conversation pages' }),
    ).getByRole('button', { name: 'Next' }),
  );
  await screen.findByText('Prompt 25', { exact: true });
  await user.click(screen.getByRole('tab', { name: 'Session Info' }));
  await user.click(screen.getByRole('tab', { name: 'Conversation' }));
  expect(screen.getByText('Prompt 25', { exact: true })).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Ascending (oldest first)' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const selected = new URLSearchParams(window.location.search).get('session');
  await user.click(screen.getByRole('button', { name: 'Hide sessions' }));
  const show = screen.getByRole('button', { name: /^Show sessions/ });
  expect(show).toHaveFocus();
  expect(
    screen.queryByRole('complementary', { name: 'Session list' }),
  ).toBeNull();
  expect(screen.getByText('Prompt 25', { exact: true })).toBeVisible();
  await user.click(show);
  expect(screen.getByRole('button', { name: 'Hide sessions' })).toHaveFocus();
  expect(new URLSearchParams(window.location.search).get('session')).toBe(
    selected,
  );
  expect(
    screen.getByRole('button', { name: 'Ascending (oldest first)' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByRole('navigation', { name: 'Conversation pages' }),
  ).toHaveTextContent('26–40 of 40');
});
test('restoreAvailableWithoutSelectionOrWithEditor', async () => {
  const user = userEvent.setup();
  render(<SessionsPage />);
  await screen.findByRole('heading', { name: 'No matching sessions' });
  await user.click(screen.getByText(/^Search and filters/));
  await user.click(screen.getByRole('button', { name: 'Source' }));
  await user.click(screen.getByRole('radio', { name: 'CLI history' }));
  await user.click(screen.getByRole('button', { name: 'Hide sessions' }));
  const show = screen.getByRole('button', { name: /^Show sessions/ });
  expect(show).toHaveAccessibleName('Show sessions (1 filter)');
  await user.click(show);
  expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(screen.queryByRole('radio')).toBeNull();
  expect(
    screen.getByRole('heading', { name: 'No matching sessions' }),
  ).toBeVisible();
});
test('cappedPromptRetainsExactFullTextAndAccessibleScroll', async () => {
  const user = userEvent.setup();
  const full =
    '\r\n  café e\u0301 😀\r\n' +
    'Line\n'.repeat(12) +
    '<b>last original line</b>';
  harness.store.commitBatch({
    records: [harness.entry('one', full)],
    warnings: [],
  });
  render(<SessionsPage />);
  const article = await screen.findByRole('article', {
    name: 'Original prompt 1',
  });
  const body = within(article).getByRole('region', {
    name: 'Original prompt 1 text',
  });
  expect(body.textContent).toBe(full);
  body.focus();
  expect(body).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Copy prompt 1' }));
  expect(await navigator.clipboard.readText()).toBe(full);
  expect(article.querySelector('b')).toBeNull();
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
  await user.click(screen.getByText(/^Search and filters/));
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
  await user.click(screen.getByText(/^Search and filters/));
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
