import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BlobError, get } from "@vercel/blob";
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
    const returnedRange = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(contentRange);
    const total = Number(returnedRange?.[3]);
    const last = Math.min(end, total - 1);
    const length = last - start + 1;
    const contentLength = object.headers.get("content-length");
    if (
      !returnedRange ||
      !Number.isSafeInteger(total) ||
      length < 1 ||
      Number(returnedRange[1]) !== start ||
      Number(returnedRange[2]) !== last ||
      (contentLength !== null && Number(contentLength) !== length)
    ) {
      await object.stream.cancel();
      return res.status(502).end();
    }
    res.status(206);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Range", contentRange);
    res.setHeader("Content-Length", String(length));
    const etag = object.headers.get("etag");
    if (etag) res.setHeader("ETag", etag);
    await pipeline(
      Readable.fromWeb(object.stream),
      async function* (chunks) {
        let remaining = length;
        for await (const chunk of chunks) {
          remaining -= chunk.byteLength;
          if (remaining < 0) throw new Error("Unexpected length for Blob range.");
          yield chunk;
        }
        if (remaining !== 0) throw new Error("Unexpected length for Blob range.");
      },
      res,
    );
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    // The Blob SDK reports upstream HTTP failures as BlobError messages.
    const unsatisfiable =
      error instanceof BlobError &&
      error.message.startsWith("Vercel Blob: Failed to fetch blob: 416 ");
    res.status(unsatisfiable ? 416 : 503).end();
  }
}
