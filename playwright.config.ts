import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests\\e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: 'line',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
