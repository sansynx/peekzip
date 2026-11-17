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
      const sampleRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/sample/field-notes.zip")
          sampleRequests.push(request.headers()["range"]);
      });
      await page.goto("/");
      if (source === "hosted") {
        await page.locator("#sample").click();
        const image = page.locator("#ws-body img");
        await expect(image).toBeVisible();
        await image.evaluate((node: HTMLImageElement) => node.decode());
        await pick(page, "field-notes.txt");
        await expect(page.locator("#ws-body pre")).toBeVisible();
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
      let uploaded: Buffer | null = null;
      const id =
        Math.floor(Date.now() / 1000 + 86400).toString(36) +
        "-" +
        "a".repeat(32);
      if (source === "local") {
        await expect(page.locator("#share-url")).toBeHidden();
        await page.route("**/api/share-upload", (route) =>
          route.fulfill({
            json: { id, uploadUrl: "https://vercel.com/api/blob/?test=1" },
          }),
        );
        await page.route("https://vercel.com/api/blob/**", async (route) => {
          uploaded = route.request().postDataBuffer();
          await route.fulfill({
            status: 200,
            body: "{}",
            headers: { "access-control-allow-origin": "*" },
          });
        });
        await page.locator("#share-create").click();
        await expect(page.locator("#share-url")).toBeVisible();
        expect(uploaded!.length).toBeLessThan(1024);
      }
      const link = await page.locator("#share-url").inputValue();
      expect(sampleRequests).toEqual(
        source === "hosted" ? ["bytes=0-262143"] : [],
      );

      const context = await browser.newContext({
        viewport: testInfo.project.use.viewport,
        reducedMotion: "reduce",
      });
      try {
        const recipient = await context.newPage();
        const requests: string[] = [];
        recipient.on("request", (req) => requests.push(req.url()));
        if (source === "local") {
          await recipient.route("**/shared/" + id + ".zip", async (route) => {
            const [, lo, hi] = /^bytes=(\d+)-(\d+)$/.exec(
              route.request().headers().range,
            )!;
            const end = Math.min(Number(hi), uploaded!.length - 1);
            await route.fulfill({
              status: 206,
              headers: {
                "content-range": `bytes ${lo}-${end}/${uploaded!.length}`,
                "content-type": "application/octet-stream",
              },
              body: uploaded!.subarray(Number(lo), end + 1),
            });
          });
        }
        await recipient.goto(link);
        await expect(recipient.locator("#ws-body")).toContainText(
          "Alder Ridge / north transect",
        );
        const downloading = recipient.waitForEvent("download");
        await recipient.locator("#ws-save").click();
        const download = await downloading;
        expect(download.suggestedFilename()).toBe("logbook.txt");
        expect(await readFile((await download.path())!, "utf8")).toBe(logbook);
        if (source === "local") {
          expect(
            requests.some((url) => url.includes("/sample/field-notes.zip")),
          ).toBe(false);
          await expect(recipient.locator(".pz-row")).toHaveCount(1);
        }
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
  await expect(page.locator('label[for="share-url"]')).toBeHidden();
  await expect(page.locator("#share-copy")).toBeHidden();
});

test("keyboard help stays accessible in each archive layout", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.locator("#sample").click();
  await expect(page.locator("#ws-body img")).toBeVisible();
  const shortcut = page.locator("#ws-shortcuts");
  if (testInfo.project.name === "phone") {
    await expect(shortcut).toBeHidden();
    await page.getByRole("button", { name: "Help", exact: true }).tap();
    const help = page.locator("#help-shortcuts");
    await help.tap();
    await expect(page.locator("#keys-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toBeFocused();
    await page.locator("#info-dialog .dismiss").tap();
    await expect(page.locator("#info-dialog")).toBeHidden();
    await pick(page, "daypack.zip");
    await page.locator("#ws-enter").tap();
    const back = page.getByRole("button", {
      name: "Back to main files in field-notes.zip",
    });
    await expect(
      back.getByText("Back to main files", { exact: false }).first(),
    ).toBeVisible();
    await pick(page, "logbook.txt");
    await expect(page.locator("#ws-body pre")).toContainText("north transect");
    await back.tap();
    await expect(page.locator("#ws-index-panel")).toBeVisible();
    await expect(page.locator(".pz-row[aria-current=true]")).toContainText(
      "daypack.zip",
    );
    await expect(page.locator("#ws-title")).toHaveText("field-notes.zip");
  } else {
    await shortcut.click();
    await expect(page.locator("#keys-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcut).toBeFocused();
    await page.keyboard.press("?");
    await expect(page.locator("#keys-dialog")).toBeVisible();
  }
});

test("pasted links, legacy local references, and the logo work from a clean session", async ({
  page,
  baseURL,
}) => {
  const legacy = new URLSearchParams({
    v: "1",
    local: "field-notes.zip",
    size: String((await readFile(sample)).length),
    file: "survey/waypoints.csv",
  });
  await page.goto("/#" + legacy);
  await expect(page.locator("#reference-file")).toHaveText("waypoints.csv");
  await expect(page.locator("#reference-zip")).toHaveText("field-notes.zip");
  await expect(page.locator("#open-form")).toBeHidden();
  await page.locator(".wordmark").click();
  await expect(page.locator("#reference-info")).toBeHidden();
  await expect(page).toHaveURL(baseURL + "/");
  const input = page.locator("#zip-url");
  await input.fill(baseURL + "/#" + legacy);
  await input.press("Enter");
  await expect(page.locator("#reference-info")).toBeVisible();
  await page.locator("#pick-file").setInputFiles(sample);
  await expect(page.locator("#ws-body table")).toBeVisible();
  await page.locator(".wordmark").click();
  await expect(page.locator("#opener, #open-form").first()).toBeVisible();
  await expect(input).toHaveValue("");
  const hosted = new URLSearchParams({
    v: "1",
    src: baseURL + "/sample/field-notes.zip",
    file: "maps/contour-study.png",
  });
  await input.fill(baseURL + "/#" + hosted);
  await input.press("Enter");
  await expect(page.locator("#ws-body img")).toBeVisible();
  await page.locator(".wordmark").click();
  await input.fill("photo.jpg");
  await input.press("Enter");
  await expect(page.locator("#open-status")).toContainText(
    "complete PeekZip link",
  );
});
