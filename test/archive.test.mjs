import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { openArchive } from "../src/lib/archive.ts";

const fixture = await readFile(
  new URL("../public/sample/field-notes.zip", import.meta.url),
);

test("reads one remote entry with bounded byte ranges and refuses full responses", async (t) => {
  let transferred = 0;
  let holdPrefix = false;
  const prefixRequest = Promise.withResolvers();
  const server = createServer((request, response) => {
    if (request.url === "/full.zip") {
      response
        .writeHead(200, { "Content-Length": fixture.length })
        .end(fixture);
      return;
    }

    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
    if (!range || request.headers.range === "bytes=0-0") {
      response.writeHead(416).end();
      return;
    }

    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), fixture.length - 1);
    if (holdPrefix && end - start === 6) {
      prefixRequest.resolve();
      return;
    }
    const bytes = fixture.subarray(start, end + 1);
    transferred += bytes.length;
    response
      .writeHead(206, {
        "Content-Length": bytes.length,
        "Content-Range": `bytes ${start}-${end}/${fixture.length}`,
      })
      .end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = new URL(`http://127.0.0.1:${server.address().port}`);
  const signal = new AbortController().signal;
  const archive = await openArchive(
    new URL("/sample.zip", base),
    signal,
    base.origin,
  );
  t.after(() => archive.close());
  const row = archive.entries.find(
    (entry) => entry.name === "survey/waypoints.csv",
  );
  assert.ok(row);
  const blob = await archive.read(row.index, signal, 2048);
  assert.match(await blob.text(), /North lookout,813,Exposed ridge/);
  assert.ok(transferred < fixture.length / 2);
  await assert.rejects(
    openArchive(new URL("/full.zip", base), signal, base.origin),
    /partial downloads/,
  );
  const pack = archive.entries.find(
    (entry) => entry.name === "survey/daypack.zip",
  );
  const controller = new AbortController();
  holdPrefix = true;
  const reading = archive.readPrefix(pack.index, 7, controller.signal);
  await prefixRequest.promise;
  controller.abort();
  try {
    await assert.rejects(
      Promise.race([
        reading,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Range did not abort")),
            500,
          );
          timer.unref();
        }),
      ]),
      { name: "AbortError" },
    );
  } finally {
    server.closeAllConnections();
  }
});

test("opens a stored inner ZIP as a bounded slice of its parent", async (t) => {
  const signal = new AbortController().signal;
  const outer = await openArchive(
    new File([fixture], "field-notes.zip"),
    signal,
  );
  t.after(() => outer.close());
  const pack = outer.entries.find(
    (entry) => entry.name === "survey/daypack.zip",
  );
  const prefix = await outer.readPrefix(pack.index, 4, signal);
  assert.deepEqual(
    new Uint8Array(await prefix.arrayBuffer()),
    Uint8Array.of(80, 75, 3, 4),
  );
  await assert.rejects(outer.readPrefix(pack.index, -1, signal));
  const child = await outer.openNested(pack.index, signal);
  t.after(() => child.close());
  const log = child.entries.find((entry) => entry.name === "logbook.txt");
  assert.match(
    await (await child.read(log.index, signal, 1024)).text(),
    /north transect/,
  );
  const compressed = child.entries.find(
    (entry) => entry.name === "coordinates.zip",
  );
  await assert.rejects(
    child.openNested(compressed.index, signal),
    /One nested ZIP/,
  );
});

test("opens a deflated child once and keeps the child subject to the depth limit", async (t) => {
  const { BlobReader, BlobWriter, ZipWriter } =
    await import("@zip.js/zip.js/lib/zip-native.js");
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("packed.zip", new BlobReader(new Blob([fixture])), {
    level: 6,
  });
  const signal = new AbortController().signal;
  const root = await openArchive(
    new File([await writer.close()], "outer.zip"),
    signal,
  );
  t.after(() => root.close());
  assert.equal(root.entries[0].stored, false);
  const child = await root.openNested(0, signal);
  t.after(() => child.close());
  const pack = child.entries.find(
    (entry) => entry.name === "survey/daypack.zip",
  );
  await assert.rejects(child.openNested(pack.index, signal), /One nested ZIP/);
  const text = child.entries.find((entry) => entry.name === "field-notes.txt");
  assert.ok((await child.read(text.index, signal, 4096)).size > 0);
});
