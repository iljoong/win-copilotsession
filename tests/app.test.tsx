// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/client/App.js';
import { createClientHarness } from './client-harness.js';

class BrowserStream {
  static instances: BrowserStream[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() {
    BrowserStream.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
}
let harness: Awaited<ReturnType<typeof createClientHarness>>;
beforeEach(async () => {
  harness = await createClientHarness();
  BrowserStream.instances = [];
  vi.stubGlobal('EventSource', BrowserStream);
});
afterEach(async () => {
  cleanup();
  await harness.close();
});

test('tabDescriptionsReplaceDuplicatePageTitles', async () => {
  const user = userEvent.setup();
  render(<App />);
  const header = document.querySelector('.app-header') as HTMLElement;
  expect(
    within(header).getByText(
      'Trace the work. Find the prompt. Understand the usage.',
    ),
  ).toBeVisible();
  expect(screen.queryByText('On this machine')).toBeNull();
  expect(document.querySelector('main h1')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Usage' }));
  expect(
    within(header).getByText(/Recorded usage across matching sessions/),
  ).toBeVisible();
  expect(document.querySelector('main h1')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Sources' }));
  expect(
    within(header).getByText(
      'Choose what this machine reads. Nothing is enabled automatically.',
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('heading', { name: 'Add a read-only source' }),
  ).toBeVisible();
  expect(document.querySelector('main h1')).toBeNull();
});

test('sessionsOnlyHeaderStatusUsesExistingStreamAndIgnoresOldCallbacks', async () => {
  const user = userEvent.setup();
  render(<App />);
  const header = document.querySelector('.app-header') as HTMLElement;
  expect(within(header).getByText('Live updates disconnected')).toBeVisible();
  expect(BrowserStream.instances).toHaveLength(1);
  const first = BrowserStream.instances[0];
  act(() => first.onopen?.());
  expect(within(header).getByText('Live updates connected')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Sessions' }));
  expect(within(header).getByText('Live updates connected')).toBeVisible();
  expect(BrowserStream.instances).toHaveLength(1);
  act(() => first.onerror?.());
  expect(within(header).getByText('Live updates disconnected')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Usage' }));
  expect(
    screen.queryByText(/Live updates (connected|disconnected)/),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Sources' }));
  expect(
    screen.queryByText(/Live updates (connected|disconnected)/),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Sessions' }));
  act(() => first.onopen?.());
  expect(within(header).getByText('Live updates disconnected')).toBeVisible();
  act(() => BrowserStream.instances.at(-1)?.onopen?.());
  expect(within(header).getByText('Live updates connected')).toBeVisible();
});
