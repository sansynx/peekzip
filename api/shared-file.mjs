import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { get } from "@vercel/blob";
import { shareIdPattern } from "../src/lib/share-link.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("Content-Disposition", 'attachment; filename="shared.zip"');
  if (req.method !== "GET") return res.status(405).end();
  const id = req.query.id;
  if (typeof id !== "string" || !shareIdPattern.test(id))
    return res.status(404).end();
  if (parseInt(id.split("-")[0], 36) * 1000 <= Date.now())
    return res.status(410).end();

  const range = /^bytes=(\d{1,12})-(\d{1,12})$/.exec(req.headers.range ?? "");
  if (!range) return res.status(416).end();
  const start = Number(range[1]),
    end = Number(range[2]);
  if (end < start || end - start >= 32 * 1024 ** 2)
    return res.status(416).end();
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const object = await get(`shares/${id}.zip`, {
      access: "private",
      headers: { Range: range[0] },
      abortSignal: controller.signal,
    });
    if (!object) return res.status(404).end();
    const contentRange = object.headers.get("content-range");
    if (!object.stream || !contentRange) {
      await object.stream?.cancel();
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Range", contentRange);
    for (const name of ["content-length", "etag"]) {
      const value = object.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    await pipeline(Readable.fromWeb(object.stream), res);
  } catch {
    if (!res.headersSent && !res.destroyed) res.status(503).end();
  }
}
