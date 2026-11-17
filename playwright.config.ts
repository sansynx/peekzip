import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4497";
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL,
    reducedMotion: "reduce",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    {
      name: "phone",
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "astro preview --ignore-lock --host 127.0.0.1 --port 4497",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
