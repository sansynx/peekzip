import assert from "node:assert/strict";
import { test } from "node:test";
import { csvPreviewRows } from "../src/lib/csv.ts";

test("CSV preview keeps quoted empty records and respects record boundaries", () => {
  assert.deepEqual(csvPreviewRows(""), []);
  assert.deepEqual(csvPreviewRows('""'), [[""]]);
  assert.deepEqual(csvPreviewRows('name\r\n"two\nlines","a ""quote"""\r\n""'), [
    ["name"],
    ["two\nlines", 'a "quote"'],
    [""],
  ]);
  assert.deepEqual(csvPreviewRows("a,b,\n"), [["a", "b", ""]]);
});

test("CSV preview stops at 100 rows and 24 columns", () => {
  const line = Array.from({ length: 25 }, (_, i) => String(i)).join(",");
  const rows = csvPreviewRows(Array(105).fill(line).join("\n"));
  assert.equal(rows.length, 100);
  assert.ok(rows.every((row) => row.length === 24 && row.at(-1) === "23"));
});
