import {
  hostedArchiveUrl,
  maxNestedBytes,
  maxSaveBytes,
  nestedLimit,
  samplePath,
} from "./archive-policy.ts";
import {
  BlobReader,
  Reader,
  HttpReader,
  ZipReader,
  type FileEntry,
  type CreateReadableOptions,
} from "@zip.js/zip.js/lib/zip-native.js";

const maxDirectoryRead = 32 * 1024 * 1024;
const remoteStreamWindow = 16 * 1024 * 1024;
const maxEntries = 100_000;

function checkReadLength(length: number) {
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maxDirectoryRead
  ) {
    throw new Error(
      "This archive's file index is too large to open in the browser.",
    );
  }
}

class LocalReader extends BlobReader {
  override readUint8Array(offset: number, length: number) {
    checkReadLength(length);
    return super.readUint8Array(offset, length);
  }
}

class RemoteReader extends HttpReader {
  private fetchRange: (url: string, init?: RequestInit) => Promise<Response>;
  private source: URL;

  constructor(
    source: URL,
    fetchRange: (url: string, init?: RequestInit) => Promise<Response>,
  ) {
    super(source, {
      useRangeHeader: true,
      forceRangeRequests: true,
      combineSizeEocd: false,
      fetch: fetchRange,
    });
    this.source = source;
    this.fetchRange = fetchRange;
  }

  override createReadable({
    offset = 0,
    size = this.size - offset,
  }: CreateReadableOptions = {}) {
    // Own the fetch signal so cancellation can interrupt the request before
    // response headers arrive, including between windows of a large member.
    const abort = new AbortController();
    const end = Math.min(offset + size, this.size);
    let next = offset;
    let body: ReadableStreamDefaultReader<Uint8Array> | undefined;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (!abort.signal.aborted) {
          if (!body) {
            if (next >= end) {
              controller.close();
              return;
            }
            const stop = Math.min(next + remoteStreamWindow, end);
            const response = await this.fetchRange(this.source.href, {
              headers: { Range: `bytes=${next}-${stop - 1}` },
              signal: abort.signal,
            });
            body = response.body!.getReader();
            next = stop;
          }
          const { value, done } = await body.read();
          if (!done) {
            if (!abort.signal.aborted) controller.enqueue(value);
            return;
          }
          body.releaseLock();
          body = undefined;
        }
      },
      cancel: (reason) => abort.abort(reason),
    });
  }

  override async readUint8Array(
    offset: number,
    length: number,
    operation?: AbortSignal,
  ) {
    if (!operation) return super.readUint8Array(offset, length);
    const response = await this.fetchRange(this.source.href, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      signal: operation,
    });
    return new Uint8Array(await response.arrayBuffer());
  }
}

async function remoteReader(source: URL, lifetime: AbortSignal) {
  let version:
    | { size: number; tag: string | null; lastModified: string | null }
    | undefined;
  async function fetchRange(url: string, init?: RequestInit) {
    const signal = init?.signal
      ? AbortSignal.any([lifetime, init.signal])
      : lifetime;
    const headers = new Headers(init?.headers);
    const range = headers.get("range")?.match(/^bytes=(\d+)-(\d+)$/i);
    if (!range) throw new Error("This host requires a full ZIP download.");
    const start = Number(range[1]);
    const requestedEnd = Number(range[2]);
    // Some static servers treat a zero end offset as an open-ended range.
    const sizeProbe = start === 0 && requestedEnd === 0;
    const end = sizeProbe ? 1 : requestedEnd;
    if (sizeProbe) headers.set("Range", "bytes=0-1");
    checkReadLength(end - start + 1);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        signal,
        mode: "same-origin",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(
        "This ZIP could not be reached directly on this site. Redirects are blocked.",
        { cause: error },
      );
    }

    const header = response.headers
      .get("content-range")
      ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
    const total = Number(header?.[3]);
    const finalByte = Math.min(end, total - 1);
    if (
      response.status !== 206 ||
      !header ||
      !response.body ||
      !Number.isSafeInteger(total) ||
      start > finalByte ||
      Number(header[1]) !== start ||
      Number(header[2]) !== finalByte
    ) {
      void response.body?.cancel().catch(() => {});
      if (response.status >= 400)
        throw new Error(`The archive host returned HTTP ${response.status}.`);
      throw new Error(
        "This host must support partial downloads and expose the Content-Range header.",
      );
    }

    const lastModified = response.headers.get("last-modified");
    const tag = response.headers.get("etag") ?? lastModified;
    if (
      version &&
      (version.size !== total ||
        version.tag !== tag ||
        (version.lastModified !== null &&
          lastModified !== null &&
          version.lastModified !== lastModified))
    ) {
      void response.body.cancel().catch(() => {});
      throw new Error("The archive changed during reading. Open it again.");
    }
    version ??= { size: total, tag, lastModified };
    // Do not buffer a server's unbounded body just because it claims a short range.
    let remaining = finalByte - start + 1;
    const bounded = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          remaining -= chunk.byteLength;
          if (remaining < 0)
            throw new Error("The ZIP host sent an invalid byte range.");
          controller.enqueue(chunk);
        },
        flush() {
          if (remaining !== 0)
            throw new Error("The archive transfer was interrupted.");
        },
      }),
    );
    if (sizeProbe) {
      const bytes = new Uint8Array(await new Response(bounded).arrayBuffer());
      const singleByteHeaders = new Headers(response.headers);
      singleByteHeaders.set("Content-Range", `bytes 0-0/${total}`);
      singleByteHeaders.set("Content-Length", "1");
      return new Response(bytes.slice(0, 1), {
        status: 206,
        headers: singleByteHeaders,
      });
    }
    return new Response(bounded, { status: 206, headers: response.headers });
  }

  // Small single-file shares and the demo can be opened in one round trip.
  if (
    (source.pathname === samplePath || source.pathname.startsWith("/shared/")) &&
    !source.search &&
    !source.hash
  ) {
    const firstRangeLimit = 256 * 1024;
    const response = await fetchRange(source.href, {
      headers: { Range: `bytes=0-${firstRangeLimit - 1}` },
    });
    if (version && version.size <= firstRangeLimit)
      return new LocalReader(await response.blob());
    // Read larger archives on demand.
    await response.body?.cancel();
  }
  return new RemoteReader(source, fetchRange);
}

interface Archive {
  entries: { name: string; size: number; index: number; stored: boolean }[];
  read(index: number, signal: AbortSignal, maxBytes: number): Promise<Blob>;
  readPrefix(
    index: number,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Blob>;
  openNested(index: number, signal: AbortSignal): Promise<Archive>;
  close(): Promise<void>;
}

class EntryReader extends Reader<Reader<unknown>> {
  private parent: Reader<unknown>;
  private start: number;
  private signal: AbortSignal;
  constructor(
    parent: Reader<unknown>,
    start: number,
    size: number,
    signal: AbortSignal,
  ) {
    super(parent);
    this.parent = parent;
    this.start = start;
    this.size = size;
    this.signal = signal;
  }

  override createReadable({
    offset = 0,
    size = this.size - offset,
    chunkSize,
  }: CreateReadableOptions = {}) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      offset > this.size ||
      size < 0
    ) {
      throw new Error("Invalid nested ZIP range.");
    }
    return this.parent.createReadable({
      offset: this.start + offset,
      size: Math.min(size, this.size - offset),
      chunkSize,
    });
  }

  override readUint8Array(
    offset: number,
    length: number,
    operation = this.signal,
  ): Uint8Array | Promise<Uint8Array> {
    checkReadLength(length);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("Invalid entry offset.");
    const available = Math.min(length, this.size - offset);
    if (available <= 0) return new Uint8Array();
    const absolute = this.start + offset;
    if (
      this.parent instanceof RemoteReader ||
      this.parent instanceof EntryReader
    ) {
      return this.parent.readUint8Array(absolute, available, operation);
    }
    return this.parent.readUint8Array(absolute, available);
  }
}

export function openArchive(
  source: File | URL,
  signal: AbortSignal,
  viewerOrigin = globalThis.location?.origin,
): Promise<Archive> {
  return indexArchive(
    (active) =>
      source instanceof URL
        ? remoteReader(hostedArchiveUrl(source.href, viewerOrigin), active)
        : new LocalReader(source),
    signal,
  );
}

async function indexArchive(
  createReader: (
    signal: AbortSignal,
  ) => Reader<unknown> | Promise<Reader<unknown>>,
  signal: AbortSignal,
  depth = 0,
): Promise<Archive> {
  const lifetime = new AbortController();
  const active = AbortSignal.any([signal, lifetime.signal]);
  active.throwIfAborted();
  const input = await createReader(active);
  active.throwIfAborted();
  const zip = new ZipReader(input);
  const files: FileEntry[] = [];

  async function close() {
    lifetime.abort();
    files.length = 0;
    await zip.close();
  }

  async function storedReader(index: number, signal: AbortSignal) {
    const file = files[index];
    if (
      !file ||
      file.encrypted ||
      file.compressionMethod !== 0 ||
      file.compressedSize !== file.uncompressedSize
    )
      return undefined;

    // zip.js resolves and validates the local header without inflating the member.
    await file.getData(new WritableStream(), {
      signal,
      checkOverlappingEntryOnly: true,
      checkLocalDirectory: true,
    });
    const offset = file.localDirectory?.dataOffset;
    const end = (offset ?? NaN) + file.compressedSize;
    if (
      offset === undefined ||
      offset < 0 ||
      !Number.isSafeInteger(end) ||
      end > input.size
    )
      throw new Error("Invalid stored entry range.");
    return new EntryReader(input, offset, file.compressedSize, signal);
  }

  try {
    let count = 0;
    for await (const file of zip.getEntriesGenerator()) {
      active.throwIfAborted();
      if (++count > maxEntries)
        throw new Error("This archive exceeds the 100,000 entry limit.");
      if (!file.directory) files.push(file);
    }
    active.throwIfAborted();
  } catch (error) {
    await close();
    throw error;
  }

  async function read(
    index: number,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<Blob> {
    const reading = AbortSignal.any([active, signal]);
    reading.throwIfAborted();
    const file = files[index];
    if (!file) throw new Error("This file is no longer available.");
    if (file.encrypted) throw new Error("This file is password-protected.");
    const limit = Math.min(maxSaveBytes, maxBytes);
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 0 ||
      file.uncompressedSize > limit ||
      file.compressedSize > limit + Math.ceil(limit / 100) + 65536
    ) {
      throw new Error("This file exceeds the size limit for this action.");
    }
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    await file.getData(
      new WritableStream<Uint8Array>({
        write(chunk) {
          reading.throwIfAborted();
          received += chunk.byteLength;
          if (received > limit || received > file.uncompressedSize) {
            throw new Error("The extracted file exceeds its allowed size.");
          }
          parts.push(new Uint8Array(chunk));
        },
      }),
      { signal: reading, checkCrc32: true },
    );
    reading.throwIfAborted();
    if (received !== file.uncompressedSize)
      throw new Error("The extracted file is incomplete.");
    return new Blob(parts);
  }

  const entries = files.map((file, index) => ({
    name: file.filename,
    size: file.uncompressedSize,
    stored:
      !file.encrypted &&
      file.compressionMethod === 0 &&
      file.compressedSize === file.uncompressedSize,
    index,
  }));
  return {
    entries,
    async openNested(index, signal) {
      const reading = AbortSignal.any([active, signal]);
      reading.throwIfAborted();
      const entry = entries[index];
      if (!entry || !/\.zip$/i.test(entry.name))
        throw new Error("Select a ZIP entry to open.");
      const limit = nestedLimit(depth, entry);
      if (limit) throw new Error(limit);
      const reader = entry.stored
        ? await storedReader(index, reading)
        : new LocalReader(await read(index, reading, maxNestedBytes));
      if (!reader) throw new Error("This nested ZIP cannot be read.");
      return indexArchive(() => reader, reading, depth + 1);
    },
    async readPrefix(index, maxBytes, signal) {
      checkReadLength(maxBytes);
      const reading = AbortSignal.any([active, signal]);
      reading.throwIfAborted();
      const reader = await storedReader(index, reading);
      if (!reader)
        throw new Error("Partial previews require an uncompressed entry.");
      const bytes = await reader.readUint8Array(
        0,
        Math.min(reader.size, maxBytes),
        reading,
      );
      reading.throwIfAborted();
      return new Blob([new Uint8Array(bytes)]);
    },
    read,
    close,
  };
}
