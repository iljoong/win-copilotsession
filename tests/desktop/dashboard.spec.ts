import { test as base, expect, type Page } from '@playwright/test';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exported, prompt } from '../e2e/fixtures.js';
import {
  launchDesktop,
  makeDesktopFolders,
  readClipboard,
  resetClipboard,
  stagedNodePids,
  type DesktopApp,
} from './harness.js';

type Folders = Awaited<ReturnType<typeof makeDesktopFolders>>;

const test = base.extend<{ folders: Folders; desktop: DesktopApp }>({
  // eslint-disable-next-line no-empty-pattern
  folders: async ({}, use) => {
    const folders = await makeDesktopFolders();
    try {
      await use(folders);
    } finally {
      await folders.remove();
    }
  },
  desktop: async ({ folders }, use) => {
    const desktop = await launchDesktop(folders);
    try {
      await use(desktop);
    } finally {
      await desktop.close();
    }
  },
});

const loopback = /^http:\/\/127\.0\.0\.1:\d+\//;

async function importViaFileChooser(page: Page) {
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByLabel('VS Code chat export').click();
  await (
    await chooser
  ).setFiles({
    name: 'synthetic-chat.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByText('Imported chat snapshot.')).toBeVisible();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
}

function originalPrompt(page: Page) {
  return page
    .getByRole('article', { name: /^Original prompt/ })
    .filter({ hasText: 'findneedle' })
    .locator('pre');
}

function cliEvent(id: string, content: string) {
  return (
    JSON.stringify({
      id,
      type: 'user.message',
      timestamp: Date.now(),
      data: { content },
    }) + '\n'
  );
}

test('loads sessions without token in URL', async ({ desktop }) => {
  const { page } = desktop;
  await expect(
    page.getByRole('button', { name: 'Sessions', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  expect(page.url()).toMatch(loopback);
  expect(page.url()).not.toContain('token=');
  expect(
    await page.evaluate(async () => (await fetch('/api/sessions')).status),
  ).toBe(200);
});

test('search finds fixture prompt', async ({ desktop }) => {
  const { page } = desktop;
  await importViaFileChooser(page);
  await page.locator('details.session-search > summary').click();
  const search = page.getByRole('searchbox', {
    name: 'Search original prompts',
  });
  await search.fill('no-such-fixture-text');
  await expect(
    page.getByRole('heading', { name: 'No matching sessions' }),
  ).toBeVisible();
  await search.fill('findneedle');
  await expect(originalPrompt(page)).toHaveText(prompt);
});

test('copy prompt keeps exact text', async ({ desktop }) => {
  const { page } = desktop;
  await importViaFileChooser(page);
  const original = originalPrompt(page);
  await expect(original).toHaveText(prompt);
  await resetClipboard();
  expect(await readClipboard()).toBe('desktop-e2e-sentinel');
  await original
    .locator('..')
    .getByRole('button', { name: /^Copy prompt/ })
    .click();
  await expect.poll(readClipboard).toBe(prompt);
});
test('conversation focused layout in WebView2', async ({ desktop }) => {
  const { page } = desktop;
  await importViaFileChooser(page);
  const header = page.locator('.app-header');
  await expect(
    header.getByText('Live updates connected', { exact: true }),
  ).toBeVisible();
  await expect(header.locator('.tab-description')).toContainText(
    'Find the prompt',
  );
  await expect(page.locator('main h1')).toHaveCount(0);
  await expect(page.getByText('On this machine')).toHaveCount(0);
  const search = page.locator('details.session-search');
  await expect(search).not.toHaveAttribute('open', '');
  await expect(page.getByRole('searchbox')).not.toBeVisible();
  await search.locator('summary').focus();
  await search.locator('summary').press('Enter');
  const overview = page.locator('details.session-overview');
  await expect(overview).not.toHaveAttribute('open', '');
  await expect(
    overview.getByRole('heading', { name: 'Session information', exact: true }),
  ).not.toBeVisible();
  await overview.locator('summary').click();
  await expect(
    overview.getByRole('heading', { name: 'Session information', exact: true }),
  ).toBeVisible();
  await expect(
    overview.getByRole('heading', { name: 'Session usage', exact: true }),
  ).toBeVisible();
  await expect(overview.locator('details')).toHaveCount(0);
  await overview.locator('summary').click();
  const toggle = page
    .locator('.session-detail')
    .getByRole('button', { name: 'Hide sessions', exact: true });
  await expect(toggle).toHaveText('');
  await expect(toggle.locator('svg')).toHaveCount(1);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page
    .getByRole('radio', { name: 'VS Code import', exact: true })
    .check();
  const original = originalPrompt(page);
  await expect(original).toHaveText(prompt);
  const before = await original.evaluate((el) => el.clientWidth);
  await page
    .getByRole('button', { name: 'Hide sessions', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /^Show sessions/ }),
  ).toBeFocused();
  expect(await original.evaluate((el) => el.clientWidth)).toBeGreaterThan(
    before + 300,
  );
  await page.getByRole('button', { name: /^Show sessions/ }).click();
  await expect(search).toHaveAttribute('open', '');
  await expect(search.locator('summary')).toContainText('1 filter');
  await expect(
    page.getByRole('button', { name: 'Hide sessions', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Source', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  const cap = await original.evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollHeight,
    line: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(cap.scroll).toBeGreaterThan(cap.height);
  expect(Math.abs(cap.height - 10 * cap.line)).toBeLessThanOrEqual(1);
  await original.focus();
  await original.press('Control+End');
  expect(await original.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await resetClipboard();
  await original
    .locator('..')
    .getByRole('button', { name: /^Copy prompt/ })
    .click();
  await expect.poll(readClipboard).toBe(prompt);
  await search.locator('summary').click();
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 600 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() =>
      window.scrollTo(
        0,
        document.querySelector('.session-detail')!.getBoundingClientRect().top +
          scrollY +
          120,
      ),
    );
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(toggle).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
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

test('imports VS Code JSON via file chooser', async ({ desktop }) => {
  const { page } = desktop;
  await importViaFileChooser(page);
  await expect(originalPrompt(page)).toHaveText(prompt);
  expect(
    await page.evaluate(
      async () =>
        ((await (await fetch('/api/sessions')).json()) as { total: number })
          .total,
    ),
  ).toBe(1);
});

test('live refresh shows appended CLI record within 2 seconds', async ({
  desktop,
  folders,
}) => {
  const { page } = desktop;
  const history = join(folders.cliRoot, 'session-state');
  const events = join(history, 'synthetic-session', 'events.jsonl');
  await mkdir(join(history, 'synthetic-session'));
  await writeFile(events, cliEvent('first', 'Desktop CLI first prompt'));

  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByLabel('Source type').selectOption('cli-history');
  await expect(page.getByLabel('Source path')).toHaveValue(history);
  await page
    .getByLabel('I authorize read-only collection from this path.')
    .check();
  await page.getByRole('button', { name: 'Enable source' }).click();
  await expect(
    page.getByText('Source enabled. Review its status below.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(page.getByText('Live updates connected')).toBeVisible();
  const prompts = page.getByRole('article', { name: /^Original prompt/ });
  await expect(prompts.getByText('Desktop CLI first prompt')).toBeVisible();

  const started = performance.now();
  await appendFile(events, cliEvent('second', 'Desktop CLI appended prompt'));
  await expect(prompts.getByText('Desktop CLI appended prompt')).toBeVisible({
    timeout: 2000,
  });
  expect(performance.now() - started).toBeLessThan(2000);
});

test('clear local data empties sessions', async ({ desktop }) => {
  const { page } = desktop;
  await importViaFileChooser(page);
  await expect(originalPrompt(page)).toHaveText(prompt);
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page
    .getByLabel('Clear confirmation')
    .fill('CLEAR LOCAL DASHBOARD DATA');
  await page.getByRole('button', { name: 'Clear local data' }).click();
  await expect(
    page.getByText(
      'Local history cleared. Sources are disabled. Original files are unchanged.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No matching sessions' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      async () =>
        ((await (await fetch('/api/sessions')).json()) as { total: number })
          .total,
    ),
  ).toBe(0);
});

test('blocks navigation to external origin', async ({ desktop }) => {
  const { page } = desktop;
  // The client normalizes the URL (e.g. ?sort=lastActivity) after load; compare origins.
  const before = new URL(page.url()).origin;
  await page.evaluate(() => {
    location.href = 'https://example.com';
  });
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).origin).toBe(before);
  expect(page.url()).toMatch(loopback);
  await expect(
    page.getByRole('button', { name: 'Sessions', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

test('closing window leaves no node.exe under the staged folder within 5 seconds', async ({
  desktop,
}) => {
  expect(await stagedNodePids()).not.toHaveLength(0);
  const started = performance.now();
  await desktop.requestClose();
  await expect
    .poll(stagedNodePids, { timeout: 5000, intervals: [100] })
    .toHaveLength(0);
  expect(performance.now() - started).toBeLessThan(5000);
  expect(await desktop.waitForExit(10000)).toBe(true);
});
