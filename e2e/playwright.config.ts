import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'

// The remote dev container pre-installs Chromium outside the default cache;
// use it when present so `playwright install` is never needed there.
const containerChromium = '/opt/pw-browsers/chromium'
const launchOptions = fs.existsSync(containerChromium)
  ? { executablePath: containerChromium }
  : {}

// The full suite exercises pages that land at integration time; until
// then only the smoke spec runs unless E2E_FULL=1 is set.
const fullSuite = !!process.env.E2E_FULL

export default defineConfig({
  testDir: './tests',
  testIgnore: fullSuite
    ? []
    : [
        '**/draftroom.spec.ts',
        '**/persistence.spec.ts',
        '**/rankings.spec.ts',
        '**/research.spec.ts',
        '**/settings.spec.ts',
        '**/voice.spec.ts',
      ],
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'cd ../backend && uv run uvicorn draftengine.main:app --port 8000',
      url: 'http://localhost:8000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'cd ../frontend && npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
