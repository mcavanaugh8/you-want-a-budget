import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3101',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1100 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'npm run build && BUDGET_DATA_DIR=$(mktemp -d /tmp/ywab-e2e.XXXXXX) PORT=3101 npm start',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
