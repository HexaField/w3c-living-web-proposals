import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: [
    {
      command: 'cd ../relay && npx tsx src/index.ts',
      port: 4000,
      reuseExistingServer: true,
      timeout: 10000,
    },
    {
      command: 'pnpm dev:test',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
});
