import { defineConfig } from '@playwright/test';

// Drives the staged Testing desktop shell over CDP; see tests/desktop/harness.ts.
export default defineConfig({
  testDir: 'tests\\desktop',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  reporter: 'line',
  outputDir: 'test-results\\desktop',
  use: {
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
