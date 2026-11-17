import { test as base, expect, type Page } from '@playwright/test';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exported, prompt, span } from './fixtures.js';
import { startDashboard } from './harness.js';
import { DatabaseSync } from 'node:sqlite';

const test = base.extend<{ app: Awaited<ReturnType<typeof startDashboard>> }>({
  app: async ({ context }, use) => {
    const app = await startDashboard(context);
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});
async function importChat(page: Page, chat = exported) {
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByLabel('VS Code chat export').setInputFiles({
    name: 'synthetic-chat.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(chat)),
  });
  await expect(page.getByText('Imported chat snapshot.')).toBeVisible();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
}
async function enableSource(
  page: Page,
  path: string,
  kind = 'vscode-telemetry',
) {
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByLabel('Source type').selectOption(kind);
  await page.getByLabel('Source path').fill(path);
  await page
    .getByLabel('I authorize read-only collection from this path.')
    .check();
  await page.getByRole('button', { name: 'Enable source' }).click();
  await expect(
    page.getByText('Source enabled. Review its status below.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(page.getByText('Live updates connected')).toBeVisible();
}
test('todoStatusTabShowsCompletionAndNewestRowsAndRefreshesWithoutEvents', async ({
  page,
  app,
}, info) => {
  const history = join(dirname(app.telemetryPath), 'todo-history');
  const directory = join(history, 'synthetic-todo-session');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'events.jsonl'),
    JSON.stringify({
      id: 'todo-prompt',
      type: 'user.message',
      timestamp: '2026-11-17T01:00:00Z',
      data: { content: 'Synthetic TODO session' },
    }) + '\n',
  );
  const db = new DatabaseSync(join(directory, 'session.db'));
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE todos(id TEXT, created_at TEXT, updated_at TEXT, title TEXT, status TEXT);
      CREATE TABLE todo_deps(todo_id TEXT, depends_on TEXT);
      INSERT INTO todos VALUES ('implement','2026-11-17 01:00:00','2026-11-17 01:01:00','Synthetic TODO','in_progress'),
        ('newest','2026-11-17 03:00:00','2026-11-17 03:01:00','Newest task','done'),
        ('middle','2026-11-17 02:00:00','2026-11-17 02:01:00','환경 설정과 실행 가이드의 문서 갱신 검증하기','pending'),
        ('standalone','2026-11-17 02:30:00','2026-11-17 02:30:00','Independent task','done');
      INSERT INTO todo_deps VALUES ('middle','implement'),('newest','middle');`);
    await page.goto(app.origin);
    await enableSource(page, history, 'cli-history');
    const conversation = page.getByRole('tab', {
      name: 'Conversation',
      exact: true,
    });
    const todoTab = page.getByRole('tab', { name: 'Todo status', exact: true });
    await expect(conversation).toHaveAttribute('aria-selected', 'true');
    await expect(todoTab).toHaveAttribute('aria-selected', 'false');
    await conversation.focus();
    await conversation.press('End');
    await expect(todoTab).toBeFocused();
    await expect(todoTab).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel', { name: 'Todo status' });
    const overall = panel.getByRole('progressbar', {
      name: 'TODO completion',
      exact: true,
    });
    await expect(overall).toHaveAttribute('value', '2');
    await expect(
      panel.getByText('2 of 4 tasks done', { exact: true }),
    ).toBeVisible();
    const group = panel.getByRole('group', {
      name: 'TODO group Synthetic TODO',
      exact: true,
    });
    await expect(group).toHaveAttribute('open', '');
    await expect(group.getByText('33.3%', { exact: true })).toBeVisible();
    await expect(group.getByText('2h 1m', { exact: true })).toBeVisible();
    const graph = group.getByRole('img', {
      name: 'Dependency graph for Synthetic TODO',
    });
    await expect(graph).toBeVisible();
    const positions = await graph
      .locator('g')
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => [
            node.querySelector('title')!.textContent!.split('\n')[1],
            (node as SVGGElement).transform.baseVal.consolidate()!.matrix.e,
          ]),
        ),
      );
    expect(positions.implement).toBeLessThan(positions.middle);
    expect(positions.middle).toBeLessThan(positions.newest);
    const labelWidths = await graph
      .locator('.todo-graph-title')
      .evaluateAll((labels) =>
        labels.map((label) => label.getBoundingClientRect().width),
      );
    expect(Math.max(...labelWidths)).toBeLessThanOrEqual(216);
    await expect(
      group.getByRole('heading', { name: 'Dependencies', exact: true }),
    ).toBeVisible();
    await expect(
      group.getByRole('heading', { name: 'Last modification timeline' }),
    ).toHaveCount(0);
    await expect(
      group.getByRole('heading', { name: 'Task details' }),
    ).toHaveCount(0);
    await expect(group.getByRole('table')).toHaveCount(0);
    const nodeMetadata = await graph.locator('g').evaluateAll((nodes) =>
      nodes.map((node) => {
        const fields = [...node.querySelectorAll('foreignObject')[1].children];
        const box = node.querySelector('rect')!.getBoundingClientRect();
        return {
          values: fields.map((field) => field.textContent),
          fits: fields.every(
            (field) => field.getBoundingClientRect().bottom <= box.bottom,
          ),
        };
      }),
    );
    expect(nodeMetadata.map((node) => node.values)).toContainEqual([
      'middle',
      '2026-11-17 02:00:00',
      'pending',
    ]);
    expect(nodeMetadata.every((node) => node.fits)).toBe(true);
    await page.screenshot({
      path: info.outputPath('todo-groups-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('todo-groups-narrow.png'),
      fullPage: true,
    });
    await panel.getByLabel('Group order').selectOption('created');
    await expect(
      panel.getByRole('group', { name: /^TODO group / }).first(),
    ).toHaveAccessibleName('TODO group Independent task');
    const standalone = panel.getByRole('group', {
      name: 'TODO group Independent task',
      exact: true,
    });
    await standalone.locator('summary').click();
    await expect(
      standalone.getByText('Same timestamp recorded', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'All tasks', exact: true }).click();
    await expect(
      panel.getByRole('cell', { name: 'in_progress', exact: true }),
    ).toBeVisible();
    await expect(panel.getByText('50%', { exact: true })).toBeVisible();
    await expect(
      panel.getByText('2 of 4 tasks done', { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('row').nth(1).getByRole('cell').first(),
    ).toHaveText('newest');
    await expect(
      panel.getByRole('row').nth(4).getByRole('cell').first(),
    ).toHaveText('implement');
    await expect(page.getByText(/Data coverage and limitations/)).toHaveCount(
      0,
    );
    await page.screenshot({
      path: info.outputPath('todo-progress-desktop.png'),
    });
    db.exec("UPDATE todos SET status='done'");
    await expect(panel.getByText('100%', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('todo-progress-narrow.png'),
      fullPage: true,
    });
    await todoTab.focus();
    await todoTab.press('Home');
    await expect(conversation).toBeFocused();
    await expect(conversation).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('table', { name: 'Session TODOs' }),
    ).not.toBeVisible();
  } finally {
    db.close();
  }
});
test('compactHeaderSearchExpanderAndStickyPanelIcon', async ({
  page,
  app,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(app.origin);
  await importChat(page, {
    ...exported,
    requests: Array.from({ length: 40 }, (_, n) => ({
      requestId: `compact-${n}`,
      message: `Prompt ${n}`,
      modelId: 'gpt-fixture',
      response: [{ value: 'Assistant preview '.repeat(20) }],
    })),
  });
  const header = page.locator('.app-header');
  await expect(
    header.getByText('Live updates connected', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('main h1')).toHaveCount(0);
  await expect(
    header.getByText('Trace the work. Find the prompt. Understand the usage.'),
  ).toBeVisible();
  await expect(page.getByText('On this machine')).toHaveCount(0);
  const search = page.locator('details.session-search');
  await expect(search).not.toHaveAttribute('open', '');
  await expect(page.getByRole('searchbox')).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath('compact-header-desktop.png'),
  });
  await search.locator('summary').focus();
  await search.locator('summary').press('Enter');
  await page.getByRole('searchbox').fill('Prompt');
  await expect(search.locator('summary')).toContainText('1 filter');
  const detail = page.locator('.session-detail');
  await detail.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const icon = detail.getByRole('button', {
    name: 'Hide sessions',
    exact: true,
  });
  await expect(icon).toHaveText('');
  await expect(icon.locator('svg')).toHaveCount(1);
  const iconBox = await icon.boundingBox();
  const detailBox = await detail.boundingBox();
  expect(iconBox!.y).toBeGreaterThanOrEqual(detailBox!.y);
  expect(iconBox!.y).toBeLessThan(detailBox!.y + 48);
  await icon.click();
  await detail.getByRole('button', { name: /^Show sessions/ }).click();
  await expect(search).toHaveAttribute('open', '');
  await expect(page.getByRole('searchbox')).toHaveValue('Prompt');
  await search.locator('summary').click();
  await expect(page.getByRole('searchbox')).not.toBeVisible();
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      header.getByText('Live updates connected', { exact: true }),
    ).toBeVisible();
    await expect(header.locator('.tab-description')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1000));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await expect(icon).toBeInViewport();
    await icon.click();
    await detail.getByRole('button', { name: /^Show sessions/ }).click();
    await expect(icon).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.screenshot({ path: info.outputPath('compact-header-narrow.png') });
  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(header.locator('.tab-description')).toContainText(
    'Recorded usage',
  );
  await expect(
    page.getByText(/Live updates (connected|disconnected)/),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await expect(header.locator('.tab-description')).toContainText(
    'Nothing is enabled automatically',
  );
  await expect(
    page.getByText(/Live updates (connected|disconnected)/),
  ).toHaveCount(0);
});
test('sessionStatusSharesSidebarToolbarAndWraps', async ({
  page,
  app,
}, info) => {
  const history = join(dirname(app.telemetryPath), 'inline-status-history');
  await mkdir(join(history, 'synthetic-session'), { recursive: true });
  await writeFile(
    join(history, 'synthetic-session', 'events.jsonl'),
    [
      {
        id: 'prompt',
        type: 'user.message',
        timestamp: 1000,
        data: { content: 'Inline status fixture' },
      },
      {
        id: 'turn',
        type: 'assistant.turn_start',
        timestamp: 1001,
        data: { turnId: 'synthetic-turn' },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n') + '\n',
  );
  await page.clock.setFixedTime(new Date(Date.now() + 60000));
  await page.setViewportSize({ width: 1600, height: 800 });
  await page.goto(app.origin);
  await enableSource(page, history, 'cli-history');
  const toolbar = page.locator('.session-detail-toolbar');
  const icon = toolbar.getByRole('button', {
    name: 'Hide sessions',
    exact: true,
  });
  const state = toolbar.getByText('Active (observed) — turn scope', {
    exact: true,
  });
  const warning = toolbar.getByText(
    'Observation stale: no new records for 30s or more. Long operations may be silent.',
    { exact: true },
  );
  await expect(state).toBeVisible();
  await expect(warning).toBeVisible();
  const iconBox = (await icon.boundingBox())!;
  const stateBox = (await state.boundingBox())!;
  const warningBox = (await warning.boundingBox())!;
  expect(stateBox.x).toBeGreaterThan(iconBox.x + iconBox.width);
  expect(warningBox.x).toBeGreaterThan(stateBox.x + stateBox.width);
  expect(
    Math.abs(stateBox.y + stateBox.height / 2 - iconBox.y - iconBox.height / 2),
  ).toBeLessThan(3);
  expect(Math.abs(warningBox.y - stateBox.y)).toBeLessThan(3);
  await page.screenshot({ path: info.outputPath('inline-status-desktop.png') });
  await icon.click();
  await expect(state).toBeVisible();
  await expect(warning).toBeVisible();
  await toolbar.getByRole('button', { name: /^Show sessions/ }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(state).toBeVisible();
  await expect(warning).toBeVisible();
  await expect(
    page.getByText('Active (observed) — turn scope', { exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath('inline-status-narrow.png'),
    fullPage: true,
  });
});
test('conversationPaneVisibilityAndResponsiveLayout', async ({ page, app }) => {
  const history = join(dirname(app.telemetryPath), 'pane-fixture-history');
  await Promise.all(
    Array.from({ length: 55 }, async (_, n) => {
      const directory = join(history, `session-${n}`);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'events.jsonl'),
        JSON.stringify({
          id: 'prompt',
          type: 'user.message',
          timestamp: 1000 + n,
          data: { content: `Session row ${n}` },
        }) + '\n',
      );
    }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(app.origin);
  await enableSource(page, history, 'cli-history');
  const rows = page.locator('.session-list-rows');
  await expect(
    page.getByRole('navigation', { name: 'Session pages' }),
  ).toContainText('1–50 of 55');
  await rows.evaluate((el) => {
    el.scrollTop = 200;
  });
  const before = await page.locator('.session-detail').boundingBox();
  await page
    .getByRole('button', { name: 'Hide sessions', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /^Show sessions/ }),
  ).toBeFocused();
  const after = await page.locator('.session-detail').boundingBox();
  expect(after!.width - before!.width).toBeGreaterThan(300);
  await page.getByRole('button', { name: /^Show sessions/ }).click();
  await expect(
    page.getByRole('button', { name: 'Hide sessions', exact: true }),
  ).toBeFocused();
  expect(await rows.evaluate((el) => el.scrollTop)).toBe(200);
  const pages = page.getByRole('navigation', { name: 'Session pages' });
  const initialSelection = new URL(page.url()).searchParams.get('session');
  await pages.getByRole('button', { name: 'Next' }).click();
  await expect(pages).toContainText('51–55 of 55');
  await expect(rows.getByRole('button')).toHaveCount(5);
  await page.waitForURL(
    (url) => url.searchParams.get('session') !== initialSelection,
  );
  const selection = new URL(page.url()).searchParams.get('session');
  await page
    .getByRole('button', { name: 'Hide sessions', exact: true })
    .click();
  await page.getByRole('button', { name: /^Show sessions/ }).click();
  await expect(pages).toContainText('51–55 of 55');
  expect(new URL(page.url()).searchParams.get('session')).toBe(selection);
  await page.locator('details.session-search > summary').click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('radio', { name: 'CLI history', exact: true }).check();
  await expect(pages).toContainText('1–50 of 55');
  await expect(rows.getByRole('button')).toHaveCount(50);
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Hide sessions', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Conversation' }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Show sessions/ }).click();
  }
});
test('promptViewportWidthHeightAndSearchReveal', async ({ page, app }) => {
  const long = Array.from({ length: 12 }, (_, n) => `Line ${n + 1}`).join('\n');
  await page.goto(app.origin);
  await importChat(page, {
    ...exported,
    requests: [
      {
        requestId: 'long',
        message: { text: long, parts: [] },
        timestamp: Date.UTC(2026, 10, 12),
        modelId: 'gpt-6.1-sol',
        copilotCredits: 0,
        response: [{ value: 'Assistant body '.repeat(30) }],
      },
      {
        requestId: 'short',
        message: 'Short text',
        modelId: 'claude-sonnet-5',
        response: [{ value: 'Short answer' }],
      },
      {
        requestId: 'wrapped',
        message: 'x'.repeat(3000),
        modelId: 'gemini-4',
        response: [{ value: 'Another answer' }],
      },
    ],
  });
  const bodies = page.locator('.conversation-entry pre');
  for (const width of [1280, 1600, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await bodies.evaluateAll((elements) =>
      elements.map((el) => {
        const css = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const parent = el.parentElement!.getBoundingClientRect();
        return {
          width: box.width,
          parent: parent.width,
          height: el.clientHeight,
          scroll: el.scrollHeight,
          line: parseFloat(css.lineHeight),
        };
      }),
    );
    for (const body of geometry)
      expect(Math.abs(body.width - body.parent)).toBeLessThan(2);
    const prompt = page
      .locator('.user-entry')
      .filter({ hasText: 'Line 12' })
      .locator('pre');
    const size = await prompt.evaluate((el) => ({
      height: el.clientHeight,
      scroll: el.scrollHeight,
      line: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(size.scroll).toBeGreaterThan(size.height);
    expect(Math.abs(size.height - 10 * size.line)).toBeLessThanOrEqual(1);
    const short = page
      .locator('.user-entry')
      .filter({ hasText: 'Short text' })
      .locator('pre');
    expect(await short.evaluate((el) => el.clientHeight)).toBeLessThan(
      size.height,
    );
    const wrapped = page
      .locator('.user-entry')
      .filter({ hasText: 'xxx' })
      .locator('pre');
    expect(
      await wrapped.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    await prompt.focus();
    await prompt.press('Control+End');
    expect(await prompt.evaluate((el) => el.scrollTop > 0)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const before = await bodies.first().evaluate((el) => el.clientWidth);
  await page
    .getByRole('button', { name: 'Hide sessions', exact: true })
    .click();
  expect(await bodies.first().evaluate((el) => el.clientWidth)).toBeGreaterThan(
    before + 300,
  );
});
test('searchRevealsLaterMatchWithoutRefreshScrollReset', async ({
  page,
  app,
}) => {
  await page.goto(app.origin);
  await enableSource(page, app.telemetryPath);
  const full =
    '\r\n  e\u0301 😀\r\n' +
    'Context line\r\n'.repeat(14) +
    'Café Needle\r\nFinal line';
  await importChat(page, {
    ...exported,
    requests: Array.from({ length: 31 }, (_, n) => ({
      requestId: `request-${n}`,
      message: { text: n === 0 ? full : `Prompt ${n}`, parts: [] },
      timestamp: Date.UTC(2026, 10, 12) + n,
      modelId: 'gpt-6.1-sol',
      copilotCredits: 0,
      response: [{ value: '' }],
    })),
  });
  await page.getByRole('tab', { name: 'Session Info', exact: true }).click();
  await page.locator('details.session-search > summary').click();
  await page
    .getByRole('searchbox', { name: 'Search original prompts' })
    .fill('cafe needle');
  const promptBody = page.locator('.search-match pre');
  await expect(
    page.getByRole('navigation', { name: 'Conversation pages' }),
  ).toContainText('26–31 of 31');
  await expect(promptBody).toHaveText(full);
  await expect
    .poll(() => promptBody.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  const visible = await promptBody.evaluate((el) => {
    const index = el.textContent!.indexOf('Café Needle');
    const range = document.createRange();
    range.setStart(el.firstChild!, index);
    range.setEnd(el.firstChild!, index + 11);
    const hit = range.getBoundingClientRect();
    const viewport = el.getBoundingClientRect();
    return hit.top >= viewport.top && hit.bottom <= viewport.bottom;
  });
  expect(visible).toBe(true);
  await promptBody
    .locator('..')
    .getByRole('button', { name: /^Copy prompt/ })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(full);
  await promptBody.evaluate((el) => {
    el.scrollTop = 0;
  });
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes('/entries?') && response.status() === 200,
  );
  await appendFile(app.telemetryPath, span('scroll-preservation'));
  await refreshed;
  await expect.poll(() => promptBody.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(
    page.getByRole('tab', { name: 'Conversation', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.session-search')).toHaveAttribute('open', '');
});
test('searchRevealsGreekFinalSigmaMatch', async ({ page, app }) => {
  const full = 'Context\r\n'.repeat(14) + 'ΚΟΣΜΟΣ\r\nFinal line';
  await page.goto(app.origin);
  await importChat(page, {
    ...exported,
    requests: [
      {
        requestId: 'greek',
        message: { text: full, parts: [] },
        timestamp: Date.UTC(2026, 10, 12),
        modelId: 'gpt-6.1-sol',
        copilotCredits: 0,
        response: [{ value: '' }],
      },
    ],
  });
  await page.locator('details.session-search > summary').click();
  await page
    .getByRole('searchbox', { name: 'Search original prompts' })
    .fill('ΚΟΣΜΟΣ');
  const body = page.locator('.search-match pre');
  await expect(body).toHaveText(full);
  await expect
    .poll(() => body.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(
    await body.evaluate((el) => {
      const index = el.textContent!.indexOf('ΚΟΣΜΟΣ');
      const range = document.createRange();
      range.setStart(el.firstChild!, index);
      range.setEnd(el.firstChild!, index + 6);
      const hit = range.getBoundingClientRect();
      const viewport = el.getBoundingClientRect();
      return hit.top >= viewport.top && hit.bottom <= viewport.bottom;
    }),
  ).toBe(true);
  await body
    .locator('..')
    .getByRole('button', { name: /^Copy prompt/ })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(full);
});
test('importSearchCopyFiltersAndSafePreviews', async ({ page, app }, info) => {
  await page.goto(app.origin);
  await importChat(page);
  const original = page
    .getByRole('article', { name: /^Original prompt/ })
    .filter({ hasText: 'findneedle' })
    .locator('pre');
  await expect(original).toHaveText(prompt);
  await expect(original).toHaveCSS('color', 'rgb(244, 213, 122)');
  await page.getByRole('tab', { name: 'Session Info', exact: true }).click();
  const modelColors = await Promise.all(
    ['gpt-6.1-sol', 'claude-sonnet-5', 'gemini-4'].map(async (model) => {
      const badge = page
        .getByLabel('Selected session')
        .getByText(model, { exact: true });
      await expect(badge).toBeVisible();
      return badge.evaluate((element) => getComputedStyle(element).color);
    }),
  );
  expect(new Set(modelColors).size).toBe(3);
  await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
  const activity = page.locator('details.activity');
  await expect(activity.locator('summary')).toBeVisible();
  await expect(activity.locator('table')).not.toBeVisible();
  await activity.locator('summary').focus();
  await activity.locator('summary').press('Enter');
  await expect(activity.locator('table')).toBeVisible();
  await activity.locator('summary').press('Enter');
  await expect(activity.locator('table')).not.toBeVisible();
  await expect(
    page.getByText('Imported snapshot', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('0 AIC (partial)', { exact: true }),
  ).toBeVisible();
  const preview = page
    .getByRole('article', { name: /^Assistant preview/ })
    .filter({ hasText: '<img src=x onerror=alert(1)>' })
    .locator('pre');
  await expect(preview).toContainText('<img src=x onerror=alert(1)>');
  expect(Array.from((await preview.textContent()) ?? '')).toHaveLength(1000);
  await expect(page.locator('img')).toHaveCount(0);
  await page.locator('details.session-search > summary').click();
  await page
    .getByRole('searchbox', { name: 'Search original prompts' })
    .fill('findneedle');
  await expect(original).toHaveText(prompt);
  await original
    .locator('..')
    .getByRole('button', { name: /^Copy prompt/ })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    prompt,
  );
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page
    .getByRole('radio', { name: 'VS Code import', exact: true })
    .check();
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Model', exact: true })
    .fill('gpt-6.1-sol');
  await expect(original).toHaveText(prompt);
  await page.getByRole('button', { name: 'State', exact: true }).click();
  await page.getByRole('radio', { name: 'Completed', exact: true }).check();
  await expect(
    page.getByRole('heading', { name: 'No matching sessions' }),
  ).toBeVisible();
  await page.getByRole('radio', { name: 'All states', exact: true }).check();
  await expect(original).toHaveText(prompt);
  await page.screenshot({
    path: info.outputPath('desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 800 });
  await original
    .locator('..')
    .getByRole('button', { name: /^Copy prompt/ })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(page.getByLabel('Reported AIC', { exact: true })).toHaveText(
    'Unavailable',
  );
  await expect(page.getByText(/1 snapshot sessions excluded/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('mobile.png'),
    fullPage: true,
  });
});
test('conversationControlsPaginateAfterHidingEmptyPreviews', async ({
  page,
  app,
}, info) => {
  await page.goto(app.origin);
  await importChat(page, {
    ...exported,
    requests: Array.from({ length: 80 }, (_, n) => ({
      requestId: `request-${n}`,
      message: `Prompt ${n}`,
      modelId: 'fixture-model-a',
      response: [{ value: n % 2 ? `Answer ${n}` : ' \n\t ' }],
    })),
  });
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const size = conversation.getByRole('combobox', { name: 'Entries per page' });
  const toggle = conversation.getByRole('checkbox', {
    name: 'Hide empty assistant previews',
  });
  const pages = conversation.getByRole('navigation', {
    name: 'Conversation pages',
  });
  const descending = conversation.getByRole('button', {
    name: 'Descending (newest first)',
  });
  const ascending = conversation.getByRole('button', {
    name: 'Ascending (oldest first)',
  });
  await expect(descending).toHaveAttribute('aria-pressed', 'true');
  await expect(ascending).toHaveAttribute('aria-pressed', 'false');
  await expect(
    conversation.getByRole('article').first().locator('pre'),
  ).toHaveText('Answer 79');
  await expect(size).toHaveValue('25');
  await expect(toggle).toBeChecked();
  await expect(pages).toContainText('1–25 of 120');
  await expect(conversation.getByRole('article')).toHaveCount(25);
  expect(
    await conversation
      .locator('.assistant-entry pre')
      .evaluateAll((elements) =>
        elements.every((element) => element.textContent!.trim()),
      ),
  ).toBe(true);
  for (const count of [50, 100, 150]) {
    await size.selectOption(String(count));
    await expect(conversation.getByRole('article')).toHaveCount(
      Math.min(count, 120),
    );
    await expect(pages).toContainText(`1–${Math.min(count, 120)} of 120`);
  }
  await size.selectOption('25');
  await ascending.focus();
  await ascending.press('Enter');
  await expect(ascending).toHaveAttribute('aria-pressed', 'true');
  await expect(descending).toHaveAttribute('aria-pressed', 'false');
  await expect(
    conversation.getByRole('article').first().locator('pre'),
  ).toHaveText('Prompt 0');
  await descending.click();
  await expect(descending).toHaveAttribute('aria-pressed', 'true');
  await expect(
    conversation.getByRole('article').first().locator('pre'),
  ).toHaveText('Answer 79');
  await pages.getByRole('button', { name: 'Next' }).click();
  await expect(pages).toContainText('26–50 of 120');
  await toggle.uncheck();
  await expect(pages).toContainText('1–25 of 160');
  await toggle.check();
  await expect(pages).toContainText('1–25 of 120');
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(toggle).toBeVisible();
  await expect(size).toBeVisible();
  await expect(descending).toBeVisible();
  await expect(ascending).toBeVisible();
  const [sizeBox, downBox, upBox] = await Promise.all([
    size.boundingBox(),
    descending.boundingBox(),
    ascending.boundingBox(),
  ]);
  expect(downBox!.x).toBeGreaterThanOrEqual(sizeBox!.x + sizeBox!.width);
  expect(upBox!.x).toBeGreaterThanOrEqual(downBox!.x + downBox!.width);
  expect(Math.abs(downBox!.y - sizeBox!.y)).toBeLessThan(2);
  expect(Math.abs(upBox!.y - downBox!.y)).toBeLessThan(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator('.conversation-controls').screenshot({
    path: info.outputPath('conversation-controls.png'),
  });
});
test('cliHistoryDisplaysCreditsAndRetainsThemAcrossRestart', async ({
  page,
  context,
  app,
}) => {
  const history = join(dirname(app.telemetryPath), 'history');
  const directory = join(history, 'synthetic-session');
  await mkdir(directory, { recursive: true });
  const usage = {
    apiCallId: 'call-a',
    model: 'gpt-6.1-sol',
    inputTokens: 100,
    outputTokens: 20,
    duration: 100,
    aiCreditsStatus: 'complete',
    copilotUsage: { totalNanoAiu: 2_500_000_000 },
  };
  await writeFile(
    join(directory, 'events.jsonl'),
    [
      {
        id: 'prompt',
        type: 'user.message',
        timestamp: 1000,
        data: { content: 'Credit fixture' },
      },
      {
        id: 'a',
        type: 'session.usage_record',
        timestamp: 2000,
        data: { usage },
      },
      {
        id: 'b',
        type: 'session.usage_record',
        timestamp: 3000,
        data: {
          usage: {
            apiCallId: 'call-b',
            model: 'claude-sonnet-5',
            inputTokens: 100,
          },
        },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join('\n') + '\n',
  );
  await page.goto(app.origin);
  await enableSource(page, history, 'cli-history');
  await page.getByRole('tab', { name: 'Session Info', exact: true }).click();
  const reported = page
    .getByLabel('Selected session')
    .locator('.metrics div')
    .filter({ has: page.getByText('Reported AIC', { exact: true }) });
  await expect(reported).toContainText('2.5 (partial)');
  expect((await app.sessions()).items[0].usage).toMatchObject({
    aic: 2.5,
    input: 200,
    coverage: { aic: 'partial' },
  });
  await app.restart(context);
  await page.goto(app.origin);
  await page.getByRole('tab', { name: 'Session Info', exact: true }).click();
  await expect(reported).toContainText('2.5 (partial)');
  expect((await app.sessions()).items[0].usage.aic).toBe(2.5);
});
test('appendedRecordAppearsWithinTwoSeconds', async ({ page, app }) => {
  await page.goto(app.origin);
  await enableSource(page, app.telemetryPath);
  const started = performance.now();
  await appendFile(app.telemetryPath, span('span-live'));
  await expect(
    page.getByText('0 model calls / 1 tool calls observed'),
  ).toBeVisible({ timeout: 2000 });
  expect(performance.now() - started).toBeLessThan(2000);
  await expect(
    page.getByText('execute_tool demo completed', { exact: true }),
  ).not.toBeVisible();
  await page.getByText('Observed activity', { exact: true }).click();
  await expect(
    page.getByRole('cell', {
      name: /^execute_tool demo completed/,
    }),
  ).toBeVisible({ timeout: 2000 });
  await appendFile(app.telemetryPath, span('span-live-later'));
  await expect(
    page.getByText('0 model calls / 2 tool calls observed'),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: /^execute_tool demo completed/ }),
  ).toHaveCount(2);
  await expect(page.locator('details.activity')).toHaveAttribute('open', '');
});
test('reconnectRefreshesAuthoritativeState', async ({ page, app }) => {
  await page.goto(app.origin);
  await enableSource(page, app.telemetryPath);
  await page.route('**/api/events', (route) => route.abort('connectionreset'));
  await page.reload();
  await expect(page.getByText('Live updates disconnected')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No matching sessions' }),
  ).toBeVisible();
  const record = span('span-reconnect');
  await appendFile(app.telemetryPath, record + record);
  await expect.poll(async () => (await app.sessions()).total).toBe(1);
  await page.unroute('**/api/events');
  await expect(page.getByText('Live updates connected')).toBeVisible({
    timeout: 15000,
  });
  await page.getByText('Observed activity', { exact: true }).click();
  await expect(
    page.getByRole('cell', {
      name: /^execute_tool demo completed/,
    }),
  ).toHaveCount(1);
  expect((await app.sessions()).total).toBe(1);
});
test('restartPreservesImportsAndPrompts', async ({ page, context, app }) => {
  await page.goto(app.origin);
  await importChat(page);
  await expect(
    page
      .getByRole('article', { name: /^Original prompt/ })
      .filter({ hasText: 'findneedle' })
      .locator('pre'),
  ).toHaveText(prompt);
  await app.restart(context);
  await page.goto(app.origin);
  await expect(
    page
      .getByRole('article', { name: /^Original prompt/ })
      .filter({ hasText: 'findneedle' })
      .locator('pre'),
  ).toHaveText(prompt);
  expect((await app.sessions()).total).toBe(1);
});
test('developmentUsesOnlyAuthenticatedLoopbackListener', async ({
  page,
  context,
}) => {
  const app = await startDashboard(context, true);
  try {
    expect(app.bindings).toEqual([
      {
        address: '127.0.0.1',
        family: 'IPv4',
        port: Number(new URL(app.origin).port),
      },
    ]);
    await page.goto(app.origin);
    await expect(
      page.getByRole('button', { name: 'Sessions', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect((await fetch(app.origin)).status).toBe(401);
  } finally {
    await app.close();
  }
});
