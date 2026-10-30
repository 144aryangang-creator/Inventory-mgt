import { defineConfig, devices } from '@playwright/test'

const ci = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  workers: ci ? 1 : undefined,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: ci ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm --workspace @inventory/api run dev -- --port 8787',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !ci,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm --workspace @inventory/web run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173/login',
      reuseExistingServer: !ci,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
