// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SourcesPage } from '../src/client/sources.js';
import { createClientHarness } from './client-harness.js';

let harness: Awaited<ReturnType<typeof createClientHarness>>;
beforeEach(async () => {
  harness = await createClientHarness();
});
afterEach(async () => {
  cleanup();
  await harness.close();
});
test('sourceCollectionRequiresExplicitEnablement', async () => {
  const user = userEvent.setup();
  render(<SourcesPage />);
  const button = await screen.findByRole('button', { name: 'Enable source' });
  expect(button).toBeDisabled();
  await user.click(
    screen.getByRole('checkbox', { name: /authorize read-only collection/i }),
  );
  await user.click(button);
  await waitFor(() =>
    expect(harness.store.listSources()[0]?.enabled).toBe(true),
  );
});
test('manualImportShowsCapabilitiesAndLimitations', async () => {
  const user = userEvent.setup();
  const data = await readFile(
    join(process.cwd(), 'tests', 'fixtures', 'vscode-export.json'),
    'utf8',
  );
  render(<SourcesPage />);
  await user.upload(
    await screen.findByLabelText('VS Code chat export'),
    new File([data], 'chat.json', { type: 'application/json' }),
  );
  expect(
    await screen.findByText('Imported chat snapshot.'),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(
      /native session identity and live status are unavailable/,
    ),
  ).toBeInTheDocument();
  expect(
    harness.store.listSessions({ sort: 'lastActivity', offset: 0, limit: 50 })
      .total,
  ).toBe(1);
});
test('setupInstructionsDoNotEnableTelemetryAutomatically', async () => {
  render(<SourcesPage />);
  expect(
    await screen.findByText(/COPILOT_OTEL_FILE_EXPORTER_PATH/),
  ).toBeInTheDocument();
  expect(harness.store.listSources()).toEqual([]);
});
test('clearingRequiresConfirmationAndOnlyClearsAppHistory', async () => {
  const user = userEvent.setup();
  harness.store.commitBatch({
    records: [harness.entry('one', 'Prompt')],
    warnings: [],
  });
  render(<SourcesPage />);
  const clear = await screen.findByRole('button', { name: 'Clear local data' });
  expect(clear).toBeDisabled();
  await user.type(
    screen.getByLabelText('Clear confirmation'),
    'CLEAR LOCAL DASHBOARD DATA',
  );
  await user.click(clear);
  expect(
    await screen.findByText(
      'Local history cleared. Sources are disabled. Original files are unchanged.',
    ),
  ).toBeInTheDocument();
  expect(
    harness.store.listSessions({ sort: 'lastActivity', offset: 0, limit: 50 })
      .total,
  ).toBe(0);
});
