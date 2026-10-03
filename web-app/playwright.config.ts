import { defineConfig, devices } from '@playwright/test'

// Every agent/CI run picks its own port: PW_PORT=5201 npm run test:browser.
const port = Number(process.env.PW_PORT ?? 5199)
const host = '127.0.0.1'

export default defineConfig({
  testDir: './tests/browser',
  // Per-port, so parallel local runs don't clear each other's artefacts.
  outputDir: process.env.PW_PORT ? `./test-results/port-${port}` : './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: `http://${host}:${port}`,
    // The page's hostname must stay 127.0.0.1: API_BASE derives from it and the
    // harness only fulfils http://127.0.0.1:9090.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Dev server only (no build). reuseExistingServer is off so a stale server on
    // this port, possibly pointing at someone else's tree, fails loudly.
    command: `npx vite --config tests/browser/support/vite.config.ts --host ${host} --port ${port} --strictPort`,
    url: `http://${host}:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
