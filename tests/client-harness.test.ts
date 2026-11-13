// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { createClientHarness } from './client-harness.js';

test('clientHarnessAcceptsBrowserSignalsAndPreservesCancellation', async () => {
  const harness = await createClientHarness();
  try {
    const controller = new AbortController();
    const response = await fetch('/api/sessions', {
      signal: controller.signal,
    });
    expect(response.ok).toBe(true);
    let release!: () => void;
    harness.delay(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = fetch('/api/sessions', { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    release();
    await rejected;
  } finally {
    await harness.close();
  }
});
