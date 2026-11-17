import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sample = path.resolve("public/sample/field-notes.zip");
const logbook =
  "Alder Ridge / north transect\n\nThe waypoint export is in coordinates.zip.\n";

async function pick(page: Page, name: string) {
  const files = page.locator("#ws-files-view");
  if (await files.isVisible()) await files.click();
  await page
    .locator(".pz-row")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
}

for (const source of ["hosted", "local"] as const) {
  test(
    source +
      " ZIP opens and shares a selected entry with an independent recipient",
    async ({ page, browser }, testInfo) => {
      await page.goto("/");
      if (source === "hosted") {
        await page.locator("#sample").click();
        await expect(page.locator("#ws-body img")).toBeVisible();
      } else {
        await page.locator("#pick-file").setInputFiles(sample);
      }
      await pick(page, "daypack.zip");
      await page.locator("#ws-enter").click();
      await expect(page.locator("#ws-title")).toHaveText("daypack.zip");
      await pick(page, "coordinates.zip");
      await expect(page.locator("#ws-enter")).toBeDisabled();
      await expect(page.locator("#ws-body")).toContainText("One nested ZIP");
      await pick(page, "logbook.txt");
      await page.locator("#ws-share").click();
      const link = await page.locator("#share-url").inputValue();

      const context = await browser.newContext({
        viewport: testInfo.project.use.viewport,
        reducedMotion: "reduce",
      });
      try {
        const recipient = await context.newPage();
        const requests: string[] = [];
        recipient.on("request", (req) => requests.push(req.url()));
        await recipient.goto(link);
        if (source === "local") {
          await expect(recipient.locator("#open-status")).toContainText(
            "Choose your copy",
          );
          await recipient
            .locator("#pick-file")
            .setInputFiles({
              name: "wrong.zip",
              mimeType: "application/zip",
              buffer: Buffer.from("sample"),
            });
          await expect(recipient.locator("#open-status")).toContainText(
            "Choose field-notes.zip",
          );
          await recipient.locator("#pick-file").setInputFiles(sample);
        }
        await expect(recipient.locator("#ws-body")).toContainText(
          "Alder Ridge / north transect",
        );
        const downloading = recipient.waitForEvent("download");
        await recipient.locator("#ws-save").click();
        const download = await downloading;
        expect(download.suggestedFilename()).toBe("logbook.txt");
        expect(await readFile((await download.path())!, "utf8")).toBe(logbook);
        if (source === "local")
          expect(
            requests.some((url) => new URL(url).pathname.endsWith(".zip")),
          ).toBe(false);
      } finally {
        await context.close();
      }
    },
  );
}

test("pasted and shared sources enforce origin, redirect and depth rules", async ({
  page,
  baseURL,
}) => {
  const external = "https://example.org/sample.zip";
  const contacted: string[] = [];
  await page.route(external, async (route) => {
    contacted.push(route.request().url());
    await route.abort();
  });
  await page.goto("/");
  const urlInput = page.locator("#zip-url");
  await urlInput.fill(external);
  await urlInput.press("Enter");
  await expect(page.locator("#open-status")).toContainText(
    "this site's origin",
  );
  const params = new URLSearchParams({
    v: "1",
    src: external,
    file: "field-notes.txt",
  });
  await page.goto("/#" + params);
  await expect(page.locator("#open-status")).toContainText(
    "this site's origin",
  );
  params.set("src", baseURL + "/sample/field-notes.zip");
  for (const part of ["survey/daypack.zip", "coordinates.zip"])
    params.append("parent", JSON.stringify([part]));
  await page.goto("/#" + params);
  await expect(page.locator("#open-status")).toContainText(
    "one nested ZIP limit",
  );
  await page.route("**/redirect.zip", (route) =>
    route.fulfill({ status: 302, headers: { location: external } }),
  );
  await urlInput.fill(baseURL + "/redirect.zip");
  await urlInput.press("Enter");
  await expect(page.locator("#open-status")).toContainText(
    "Redirects are blocked",
  );
  expect(contacted).toEqual([]);

  await urlInput.fill(baseURL + "/sample/field-notes.zip?edition=1");
  await urlInput.press("Enter");
  await pick(page, "waypoints.csv");
  await expect(page.locator("#ws-body table")).toBeVisible();
  await page.locator("#ws-share").click();
  await expect(page.locator("#share-detail")).toContainText(
    "Sharing is unavailable",
  );
  await expect(page.locator("#share-url")).toBeHidden();
});

test("the Pele diagram fits the landing page", async ({ page }) => {
  await page.goto("/");
  const diagram = page.locator(".archive-diagram");
  await expect(diagram.getByRole("img")).toBeVisible();
  const layout = await diagram.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const svg = el.querySelector("svg")!.getBoundingClientRect();
    return {
      centered:
        Math.abs(
          (rect.left + rect.right) / 2 -
            document.documentElement.clientWidth / 2,
        ) < 2,
      fits:
        rect.width <= 465 &&
        svg.width >= rect.width - 34 &&
        svg.height >= 38 &&
        svg.left >= rect.left &&
        svg.right <= rect.right + 1,
      background: getComputedStyle(el).backgroundColor,
    };
  });
  expect(layout).toEqual({
    centered: true,
    fits: true,
    background: "rgb(0, 0, 0)",
  });
});
