import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Writable } from "node:stream";
import { test } from "node:test";
import sharedFile from "../api/shared-file.mjs";
import shareUpload from "../api/share-upload.mjs";

const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } =
  createRequire(import.meta.resolve("@vercel/blob"))("undici");

class FunctionResponse extends Writable {
  statusCode = 200;
  headers = new Headers();
  chunks = [];

  status(code) {
    this.statusCode = code;
    return this;
  }

  setHeader(name, value) {
    this.headers.set(name, value);
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(chunk);
    callback();
  }
}

async function requestRange(t, upstream, range = "bytes=2-5") {
  const dispatcher = getGlobalDispatcher();
  const blob = new MockAgent();
  blob.disableNetConnect();
  blob.get(/^https:\/\/[^/]+\.private\.blob\.vercel-storage\.com$/)
    .intercept({ method: "GET", path: /^\/shares\// })
    .reply(upstream.status, await upstream.text(), {
      headers: Object.fromEntries(upstream.headers),
    });
  setGlobalDispatcher(blob);
  t.after(async () => {
    setGlobalDispatcher(dispatcher);
    await blob.close();
  });
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_fake";
  t.after(() => {
    if (token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = token;
  });
  const id = Math.ceil((Date.now() + 86_400_000) / 1000).toString(36) +
    "-" + "a".repeat(32);
  const response = new FunctionResponse();
  await sharedFile({ method: "GET", query: { id }, headers: { range } }, response);
  return response;
}

test("shared file proxy returns a valid range clipped to the end of the blob", async (t) => {
  const response = await requestRange(t, new Response("cd", {
    status: 206,
    headers: { "Content-Range": "bytes 2-3/4" },
  }));
  assert.equal(response.statusCode, 206);
  assert.equal(response.headers.get("content-length"), "2");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(Buffer.concat(response.chunks).toString(), "cd");
});

test("shared file proxy rejects a response for a different range", async (t) => {
  const response = await requestRange(t, new Response("bcde", {
    status: 206,
    headers: { "Content-Range": "bytes 1-4/6" },
  }));
  assert.equal(response.statusCode, 502);
  assert.equal(response.chunks.length, 0);
});

test("shared file proxy stops a transfer that exceeds its declared range", async (t) => {
  const response = await requestRange(t, new Response("cdefg", {
    status: 206,
    headers: { "Content-Range": "bytes 2-5/7" },
  }));
  assert.match(response.errored?.message ?? "", /unexpected length/i);
  assert.equal(response.chunks.length, 0);
});

test("shared file proxy preserves an unsatisfiable range status", async (t) => {
  const response = await requestRange(t, new Response(null, { status: 416 }));
  assert.equal(response.statusCode, 416);
});

test("upload ticket handler returns 400 when the runtime cannot parse the JSON body", async () => {
  const response = new FunctionResponse();
  await shareUpload({
    method: "POST",
    headers: {
      host: "viewer.example",
      origin: "https://viewer.example",
      "content-type": "application/json",
    },
    get body() {
      throw new SyntaxError("Invalid JSON");
    },
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.writableEnded, true);
});
