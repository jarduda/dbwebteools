import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  projects: [
    {
      name: "workspace",
      testIgnore: /field-access.spec.ts|session-recovery.spec.ts/,
    },
    {
      name: "field-security",
      testMatch: /field-access.spec.ts/,
      dependencies: ["workspace"],
    },
    {
      name: "session-recovery",
      testMatch: /session-recovery.spec.ts/,
      dependencies: ["field-security"],
    },
  ],
  outputDir: "../../artifacts/playwright-results",
  use: { baseURL: "http://localhost:5173" },
  webServer: [
    {
      command:
        "dotnet run --project ../../backend/DbWeb.Api --no-launch-profile --urls http://localhost:5190",
      url: "http://localhost:5190/health",
      reuseExistingServer: false,
      env: {
        ASPNETCORE_ENVIRONMENT: "Development",
        Bootstrap__Password: "browser-test-only-password",
        DataDirectory: process.env.RUNNER_TEMP
          ? `${process.env.RUNNER_TEMP}/dbweb-browser`
          : "/tmp/dbweb-browser-data",
      },
    },
    {
      command: "npm --prefix ../../frontend run dev",
      env: { API_PROXY_TARGET: "http://localhost:5190" },
      url: "http://localhost:5173",
      reuseExistingServer: false,
    },
  ],
});
