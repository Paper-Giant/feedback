import { defineConfig, devices } from '@playwright/test';
import { HOST_PORT } from './constants.ts';

export default defineConfig({
  testDir: './tests',
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
  webServer: {
    command: 'npm run build:pages && npm run start:host',
    url: `http://localhost:${HOST_PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
