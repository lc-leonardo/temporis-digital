import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1600, height: 950 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm.cmd run lan:server',
      url: 'http://localhost:8787/api/player-stats',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm.cmd run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
