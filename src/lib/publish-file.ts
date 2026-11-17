import {
  BlobReader,
  BlobWriter,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-native.js";
import { maxSharedZipBytes, shareIdPattern } from "./share-link.mjs";

export async function publishFile(
  name: string,
  file: Blob,
  signal: AbortSignal,
): Promise<string> {
  // The recipient can use the existing ZIP reader. Include just the chosen entry.
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add(name, new BlobReader(file), { level: 0, signal });
  const zip = await writer.close();
  signal.throwIfAborted();
  if (zip.size > maxSharedZipBytes)
    throw new Error("This file is too large to share.");
  const ticket = await fetch("/api/share-upload", {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: zip.size }),
  });
  if (ticket.status === 429)
    throw new Error("Too many links created. Try again later.");
  if (!ticket.ok) throw new Error("Couldn’t create the link. Try again.");
  const { id, uploadUrl } = await ticket.json();
  if (
    typeof id !== "string" ||
    !shareIdPattern.test(id) ||
    typeof uploadUrl !== "string" ||
    !uploadUrl.startsWith("https://vercel.com/api/blob/")
  )
    throw new Error("Couldn’t verify the upload destination.");
  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    body: zip,
    signal,
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: {
      "Content-Type": "application/zip",
      "x-content-type": "application/zip",
      "x-vercel-blob-access": "private",
      "x-api-version": "13",
    },
  });
  if (!uploaded.ok) throw new Error("The upload didn’t finish. Try again.");
  return new URL("/#s=" + id, location.origin).href;
}
