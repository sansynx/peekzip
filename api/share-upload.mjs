import { randomUUID } from "node:crypto";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { maxSharedZipBytes, shareLifetime } from "../src/lib/share-link.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).end();
  if (
    req.headers.origin !== `https://${req.headers.host}` ||
    req.headers["content-type"]?.split(";")[0] !== "application/json"
  )
    return res.status(403).end();
  const size = req.body?.size;
  if (!Number.isSafeInteger(size) || size < 1 || size > maxSharedZipBytes)
    return res.status(400).end();

  const expires = Date.now() + shareLifetime;
  const id = `${Math.floor(expires / 1000).toString(36)}-${randomUUID().replaceAll("-", "")}`;
  const pathname = `shares/${id}.zip`;
  const limits = {
    pathname,
    allowedContentTypes: ["application/zip"],
    maximumSizeInBytes: size,
  };
  try {
    const token = await issueSignedToken({
      ...limits,
      operations: ["put"],
      validUntil: Date.now() + 15 * 60_000,
    });
    const { presignedUrl } = await presignUrl(token, {
      ...limits,
      operation: "put",
      allowOverwrite: false,
      addRandomSuffix: false,
      ttlDays: 1,
    });
    res.status(200).json({ id, uploadUrl: presignedUrl });
  } catch {
    res.status(503).json({ error: "File sharing is temporarily unavailable." });
  }
}
