import { test as base, expect, type Page } from '@playwright/test';
import { appendFile } from 'node:fs/promises';
import { startDashboard } from './harness.js';

const prompt =
  '\r\n  caf\u00e9 e\u0301 \ud83d\ude00\r\n' +
  'Long original prompt. '.repeat(100) +
  'findneedle';
const exported = {
  responderUsername: 'GitHub Copilot',
  initialLocation: 'panel',
  requests: [
    {
      requestId: 'request-a',
      message: { text: prompt, parts: [] },
      timestamp: Date.UTC(2026, 10, 12),
      modelId: 'fixture-model-a',
      copilotCredits: 0,
      response: [
        { value: '<img src=x onerror=alert(1)>' + '\ud83d\ude00'.repeat(1200) },
      ],
    },
    {
      requestId: 'request-b',
      message: 'Second prompt',
      modelId: 'fixture-model-b',
      response: [{ value: 'Second answer' }],
    },
  ],
};
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
async function importChat(page: Page) {
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByLabel('VS Code chat export').setInputFiles({
    name: 'synthetic-chat.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByText('Imported chat snapshot.')).toBeVisible();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
}
async function enableTelemetry(page: Page, path: string) {
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByLabel('Source type').selectOption('vscode-telemetry');
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
function span(id: string) {
  return (
    JSON.stringify({
      name: 'execute_tool demo',
      _spanContext: { spanId: id },
      startTime: Date.now() - 10,
      endTime: Date.now(),
      attributes: {
        'gen_ai.conversation.id': 'live-session',
        'gen_ai.operation.name': 'execute_tool',
      },
    }) + '\n'
  );
}
test('importSearchCopyFiltersAndSafePreviews', async ({ page, app }, info) => {
  await page.goto(app.origin);
  await importChat(page);
  const original = page
    .getByRole('article', { name: 'Original prompt 1', exact: true })
    .locator('pre');
  await expect(original).toHaveText(prompt);
  await expect(
    page.getByText('Imported snapshot', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('0 AIC (partial)', { exact: true }),
  ).toBeVisible();
  const preview = page
    .getByRole('article', { name: 'Assistant preview 2', exact: true })
    .locator('pre');
  await expect(preview).toContainText('<img src=x onerror=alert(1)>');
  expect(Array.from((await preview.textContent()) ?? '')).toHaveLength(1000);
  await expect(page.locator('img')).toHaveCount(0);
  await page
    .getByRole('searchbox', { name: 'Search original prompts' })
    .fill('findneedle');
  await expect(original).toHaveText(prompt);
  await page.getByRole('button', { name: 'Copy prompt 1' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    prompt,
  );
  await page
    .getByRole('combobox', { name: 'Source', exact: true })
    .selectOption('vscode-import');
  await page.getByLabel('Model', { exact: true }).fill('fixture-model-a');
  await expect(original).toHaveText(prompt);
  await page
    .getByRole('combobox', { name: 'State', exact: true })
    .selectOption('completed');
  await expect(
    page.getByRole('heading', { name: 'No matching sessions' }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'State', exact: true })
    .selectOption('');
  await expect(original).toHaveText(prompt);
  await page.screenshot({
    path: info.outputPath('desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('button', { name: 'Copy prompt 1' }).click();
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
test('appendedRecordAppearsWithinTwoSeconds', async ({ page, app }) => {
  await page.goto(app.origin);
  await enableTelemetry(page, app.telemetryPath);
  const started = performance.now();
  await appendFile(app.telemetryPath, span('span-live'));
  await expect(
    page.getByRole('cell', {
      name: /^execute_tool demo completed/,
    }),
  ).toBeVisible({ timeout: 2000 });
  expect(performance.now() - started).toBeLessThan(2000);
});
test('reconnectRefreshesAuthoritativeState', async ({ page, app }) => {
  await page.goto(app.origin);
  await enableTelemetry(page, app.telemetryPath);
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
      .getByRole('article', { name: 'Original prompt 1', exact: true })
      .locator('pre'),
  ).toHaveText(prompt);
  await app.restart(context);
  await page.goto(app.origin);
  await expect(
    page
      .getByRole('article', { name: 'Original prompt 1', exact: true })
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
      page.getByRole('heading', { name: 'Sessions', exact: true }),
    ).toBeVisible();
    expect((await fetch(app.origin)).status).toBe(401);
  } finally {
    await app.close();
  }
});
