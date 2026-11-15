import {
  BlobReader,
  Reader,
  HttpReader,
  ZipReader,
  type FileEntry,
  type CreateReadableOptions,
} from "@zip.js/zip.js/lib/zip-native.js";

const maxDirectoryRead = 32 * 1024 * 1024;
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

function remoteReader(source: URL, lifetime: AbortSignal) {
  if (
    !["https:", "http:"].includes(source.protocol) ||
    source.username ||
    source.password
  ) {
    throw new Error("Enter a direct HTTP or HTTPS link to a ZIP file.");
  }
  let version: { size: number; tag: string | null } | undefined;
  return new RemoteReader(source, async (url, init) => {
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
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(
        "The host could not be reached or does not allow cross-origin ZIP reads.",
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

    const tag =
      response.headers.get("etag") ?? response.headers.get("last-modified");
    if (version && (version.size !== total || version.tag !== tag)) {
      void response.body.cancel().catch(() => {});
      throw new Error("The archive changed during reading. Open it again.");
    }
    version ??= { size: total, tag };
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
  });
}

interface Archive {
  entries: { name: string; size: number; index: number; stored: boolean }[];
  read(index: number, signal: AbortSignal, maxBytes: number): Promise<Blob>;
  readPrefix(
    index: number,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Blob>;
  openStored(index: number, signal: AbortSignal): Promise<Archive | undefined>;
  close(): Promise<void>;
}

class EntryReader extends Reader<Reader<unknown>> {
  private parent: Reader<unknown>;
  private start: number;
  constructor(parent: Reader<unknown>, start: number, size: number) {
    super(parent);
    this.parent = parent;
    this.start = start;
    this.size = size;
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
    operation?: AbortSignal,
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
): Promise<Archive> {
  return indexArchive(
    (active) =>
      source instanceof URL
        ? remoteReader(source, active)
        : new LocalReader(source),
    signal,
  );
}

async function indexArchive(
  createReader: (signal: AbortSignal) => Reader<unknown>,
  signal: AbortSignal,
): Promise<Archive> {
  const lifetime = new AbortController();
  const active = AbortSignal.any([signal, lifetime.signal]);
  active.throwIfAborted();
  const input = createReader(active);
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
    return new EntryReader(input, offset, file.compressedSize);
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

  return {
    entries: files.map((file, index) => ({
      name: file.filename,
      size: file.uncompressedSize,
      stored:
        !file.encrypted &&
        file.compressionMethod === 0 &&
        file.compressedSize === file.uncompressedSize,
      index,
    })),
    async openStored(index, signal) {
      const reading = AbortSignal.any([active, signal]);
      reading.throwIfAborted();
      const reader = await storedReader(index, reading);
      return reader ? indexArchive(() => reader, reading) : undefined;
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
    async read(
      index: number,
      signal: AbortSignal,
      maxBytes: number,
    ): Promise<Blob> {
      const reading = AbortSignal.any([active, signal]);
      reading.throwIfAborted();
      const file = files[index];
      if (!file) throw new Error("This file is no longer available.");
      if (file.encrypted) throw new Error("This file is password-protected.");
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 0 ||
        file.uncompressedSize > maxBytes
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
            if (received > maxBytes || received > file.uncompressedSize) {
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
    },
    close,
  };
}
