import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const [appURL, directory, resultPath, n = "5"] = process.argv.slice(2);
if (!appURL || !directory || !resultPath)
  throw Error(
    "usage: node bench.mjs <app URL> <fixture directory> <results.json> [rounds]",
  );
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const meta = JSON.parse(
  await readFile(path.join(directory, "metadata.json"), "utf8"),
);
const filePath = path.resolve(directory, "archive.zip");
const appOrigin = new URL(appURL).origin;
const traffic = [];
const appAssets = new Set();
const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", appOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges,Content-Length,Content-Range",
  );
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const parsed = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
  if (!parsed) {
    traffic.push({ full: true, url: req.url });
    res.writeHead(400);
    res.end("range required");
    return;
  }
  const start = Number(parsed[1]),
    end = Math.min(Number(parsed[2]), meta.archiveBytes - 1);
  if (start > end) {
    res.writeHead(416);
    res.end();
    return;
  }
  const request = { url: req.url, start, end, bytes: 0 };
  traffic.push(request);
  res.writeHead(206, {
    "content-range": `bytes ${start}-${end}/${meta.archiveBytes}`,
    "content-length": end - start + 1,
  });
  const stream = createReadStream(filePath, { start, end });
  stream.on("data", (chunk) => {
    request.bytes += chunk.length;
  });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  headless: true,
});
const result = {
  url: appURL,
  archive: meta,
  chromium: browser.version(),
  node: process.version,
  kernel: os.release(),
  processor: os.cpus()[0]?.model,
  availableCpus: os.availableParallelism(),
  ramGiB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
  rounds: Number(n),
  counts: {},
  runs: [],
};

async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function run(mode, branch, round) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await context.newPage();
    const unexpected = [];
    const errors = [];
    page.setDefaultTimeout(25_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      const u = new URL(req.url());
      if (!["http:", "https:"].includes(u.protocol)) return;
      if (u.origin === appOrigin && req.method() === "GET")
        appAssets.add(u.pathname + u.search);
      else if (
        u.origin !== fixtureOrigin ||
        mode === "local" ||
        req.method() !== "GET"
      )
        unexpected.push(req.url());
    });
    const series = { mode, branch, round, steps: {} };
    await page.goto(appURL, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.benchStarts = {};
      const mark = (k) => {
        window.benchStarts[k] = performance.now();
      };
      document.addEventListener(
        "change",
        (e) => {
          if (e.target.id === "pick-file") mark("index");
        },
        true,
      );
      document.addEventListener(
        "submit",
        (e) => {
          if (e.target.id === "open-form") mark("index");
        },
        true,
      );
      document.addEventListener(
        "click",
        (e) => {
          if (e.target.closest("#ws-enter")) mark("enter");
          if (e.target.closest(".pz-row")) mark("select");
        },
        true,
      );
    });
    const row = (name) =>
      page
        .locator(".pz-row")
        .filter({ has: page.locator(".pz-row-name", { hasText: name }) });
    const remote = fixtureOrigin + `/${mode}-${branch}-${round}.zip`;
    const start = traffic.length;
    let last = start;
    function record(name, ms) {
      const requests = traffic.slice(last);
      assert.ok(!requests.some((x) => x.full), "unexpected full GET");
      series.steps[name] = {
        ms: Math.round(ms * 10) / 10,
        requests: requests.length,
        bytes: requests.reduce((s, r) => s + r.bytes, 0),
      };
      last = traffic.length;
    }
    async function visible(
      name,
      event,
      selector,
      text,
      action,
      prefix = false,
    ) {
      await page.evaluate(
        ({ event, selector, text, prefix }) => {
          window.benchStarts[event] = undefined;
          window.benchDone = new Promise((resolve) => {
            function poll() {
              const nodes = [...document.querySelectorAll(selector)];
              if (
                window.benchStarts[event] !== undefined &&
                nodes.some(
                  (el) =>
                    el.getClientRects().length &&
                    (prefix
                      ? el.textContent.startsWith(text)
                      : el.textContent.trim() === text),
                )
              ) {
                resolve(performance.now() - window.benchStarts[event]);
                return;
              }
              requestAnimationFrame(poll);
            }
            requestAnimationFrame(poll);
          });
        },
        { event, selector, text, prefix },
      );
      await action();
      await page
        .locator(selector)
        .filter({ hasText: text })
        .first()
        .waitFor({ timeout: 25000 });
      const ms = await page.evaluate(() => window.benchDone);
      record(name, ms);
    }
    await visible(
      "index",
      "index",
      ".pz-row-name",
      branch + ".zip",
      async () => {
        if (mode === "local") {
          const chooserPromise = page.waitForEvent("filechooser");
          await page
            .locator("label")
            .filter({ has: page.locator("#pick-file") })
            .click();
          await (await chooserPromise).setFiles(filePath);
        } else {
          await page.locator("#zip-url").fill(remote);
          await page.locator("#open-form button").click();
        }
      },
    );
    await visible(
      "hugeLogPreview",
      "select",
      "#ws-body pre",
      meta.telemetryHeader,
      () => row("telemetry.log").click(),
      true,
    );
    const rendered = await page.locator("#ws-body pre").textContent();
    assert.equal(
      Buffer.byteLength(rendered),
      192 * 1024,
      "exact 192 KiB text prefix displayed",
    );
    assert.equal(
      createHash("sha256").update(rendered).digest("hex"),
      meta.telemetryPrefixSha256,
    );
    assert.ok(
      (await page.locator("#ws-save").isHidden()) ||
        (await page.locator("#ws-save").isDisabled()),
      "oversized entry save is unavailable",
    );
    assert.match(
      await page.locator("#workspace").innerText(),
      /256\s*MiB/i,
      "per-entry export limit explained",
    );
    assert.ok(
      series.steps.hugeLogPreview.bytes <= 192 * 1024 + 1024,
      "huge preview respects requested window",
    );
    const fileOffset = meta.entries[branch + ".zip"].offset;
    const branchSegmentStart = traffic.length;
    async function enter(from, to, name) {
      await row(from).click();
      await visible(name, "enter", ".pz-row-name", to, () =>
        page.locator("#ws-enter").click(),
      );
    }
    await enter(branch + ".zip", "level-2.zip", "level1");
    await enter("level-2.zip", "receipt.txt", "level2");
    await visible(
      "preview",
      "select",
      "#ws-body pre",
      meta.receipt.trim(),
      () => row("receipt.txt").click(),
    );
    async function save(name, expected) {
      const downloadPromise = page.waitForEvent("download");
      const begin = performance.now();
      // The control is enabled and ready. Avoid adding Playwright actionability polling to this disk timing.
      await page.locator("#ws-save").evaluate((el) => el.click());
      const download = await downloadPromise;
      const file = await download.path();
      record(name, performance.now() - begin);
      assert.equal(await checksum(file), expected);
      await download.delete();
    }
    await save("savePreview", meta.receiptSha256);
    assert.equal(
      series.steps.savePreview.requests,
      0,
      "saving preview must reuse its bytes",
    );
    await row("payload.bin").click();
    await save("save32MiB", meta.payloadSha256);
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
    series.ranges = traffic
      .slice(start)
      .map(({ start, end, bytes }) => ({ start, end, bytes }));
    assert.ok(series.ranges.every((r) => r.end - r.start + 1 === r.bytes));
    if (mode === "remote") {
      assert.ok(
        traffic.slice(branchSegmentStart).some((r) => r.start >= fileOffset),
        "nested extraction must access a high 64-bit archive offset",
      );
      assert.ok(
        traffic.slice(branchSegmentStart).every((r) => r.start >= fileOffset),
        "nested operations must stay inside the selected branch",
      );
      assert.ok(fileOffset >= meta.archiveBytes * 0.99);
    }
    const sourceBytes = series.ranges.reduce((s, r) => s + r.bytes, 0);
    assert.equal(sourceBytes === 0, mode === "local");
    assert.ok(sourceBytes < meta.archiveBytes / 40);
    if (mode === "remote" && branch === "stored") {
      assert.ok(
        series.steps.level1.bytes + series.steps.level2.bytes < 1024 ** 2,
        "stored parent fetched too much",
      );
      assert.ok(series.steps.save32MiB.bytes >= meta.payloadBytes);
    }
    result.runs.push(series);
    await writeFile(resultPath, JSON.stringify(result, null, 2));
    console.log(
      mode,
      branch,
      round,
      Object.fromEntries(
        Object.entries(series.steps).map(([k, v]) => [k, v.ms]),
      ),
      sourceBytes,
      "B",
    );
  } finally {
    await context.close();
  }
}
try {
  for (let round = 1; round <= Number(n); round++) {
    for (const mode of round % 2 ? ["local", "remote"] : ["remote", "local"]) {
      for (const branch of round % 2
        ? ["stored", "deflated"]
        : ["deflated", "stored"])
        await run(mode, branch, round);
    }
  }
  result.assets = [...appAssets];
  const median = (x) => {
    x.sort((a, b) => a - b);
    const m = x.length >> 1;
    return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
  };
  for (const mode of ["local", "remote"])
    for (const branch of ["stored", "deflated"]) {
      const group = result.runs.filter(
        (r) => r.mode === mode && r.branch === branch,
      );
      result.counts[mode + "-" + branch] = Object.fromEntries(
        Object.keys(group[0].steps).map((k) => [
          k,
          Object.fromEntries(
            ["ms", "requests", "bytes"].map((v) => [
              v,
              median(group.map((r) => r.steps[k][v])),
            ]),
          ),
        ]),
      );
    }
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.counts, null, 2));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
