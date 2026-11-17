import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostedArchiveUrl,
  maxNestedBytes,
  nestedLimit,
} from "../src/lib/archive-policy.ts";

test("hosted files require an absolute ZIP URL with the exact viewer origin", () => {
  const origin = "https://peekzip.vercel.app";
  const accepted = origin + "/sample/FIELD.ZIP?edition=1";
  assert.equal(hostedArchiveUrl(accepted, origin).href, accepted);
  for (const url of [
    "/sample/file.zip",
    "http://peekzip.vercel.app/file.zip",
    "https://peekzip.vercel.app:8000/file.zip",
    "https://other.example/file.zip",
    "https://sub.peekzip.vercel.app/file.zip",
    "https://user@peekzip.vercel.app/file.zip",
    origin + "/data?name=file.zip",
    "file:///tmp/file.zip",
    "blob:" + origin + "/file.zip",
  ])
    assert.throws(() => hostedArchiveUrl(url, origin), /direct .zip URL/);
});

test("limits apply to child inflation and entry into a second nested archive", () => {
  assert.equal(nestedLimit(0, { stored: false, size: maxNestedBytes }), "");
  assert.match(
    nestedLimit(0, { stored: false, size: maxNestedBytes + 1 }),
    /64 MiB/,
  );
  for (const stored of [false, true])
    assert.match(nestedLimit(1, { stored, size: 1 }), /One nested ZIP/);
});
