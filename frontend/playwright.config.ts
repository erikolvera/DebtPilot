import { defineConfig, devices } from "@playwright/test";

// Dedicated ports so a UI run never reuses `npm run dev` (3000/8000) or a
// deployed API: the browser talks only to the servers started below.
const WEB = "http://127.0.0.1:3100";
const API = "http://127.0.0.1:8100";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // SLOWMO=400 slows each action for a watchable headed demo.
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: ".venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8100",
      cwd: "../backend",
      url: `${API}/health`,
      env: { ALLOWED_ORIGINS: WEB },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx next dev --hostname 127.0.0.1 --port 3100",
      url: WEB,
      // Shell env wins over .env.local, so this pins the API and keeps the
      // run in anonymous guest mode regardless of local account settings.
      env: { NEXT_PUBLIC_API_BASE_URL: API, NEXT_PUBLIC_CLOUD_ACCOUNTS: "false" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
