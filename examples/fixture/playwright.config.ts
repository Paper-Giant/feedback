import { defineConfig, devices } from '@playwright/test';
import { HOST_PORT, STUB_PORT } from './constants.ts';

export default defineConfig({
  testDir: './tests',
  // The stub GitHub's `/__control` behaviour is a single global, single-shot
  // slot ("the next issue-creation call gets this behaviour"). Any test that
  // sets a behaviour and then triggers the request it's meant for must not
  // race another test's request for the same slot, so this whole suite runs
  // on one worker rather than fanning out across projects or files. The
  // three engines still each run the full suite — just one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${HOST_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: [
    {
      command: 'npm run start:stub',
      url: `http://localhost:${STUB_PORT}/__issues`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run build:pages && npm run start:host',
      url: `http://localhost:${HOST_PORT}/vanilla.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
