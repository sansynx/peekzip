import { shareIdPattern, sharedArchivePath } from "./share-link.mjs";
import type { openArchive } from "./archive";
import {
  hostedArchiveUrl,
  maxNestedDepth,
  maxSaveBytes,
  nestedLimit,
  samplePath,
} from "./archive-policy";
import { csvPreviewRows } from "./csv";

type Archive = Awaited<ReturnType<typeof openArchive>>;
type Entry = Archive["entries"][number];
type PreviewKind = "image" | "text" | "csv" | "binary";
type Target = { name: string; index?: number };
type Parent = {
  archive: Archive;
  entry: Entry;
  target: Target;
  query: string;
  pageOffset: number;
};
const get = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const landing = get("landing");
const workspace = get("workspace");
const urlInput = get<HTMLInputElement>("zip-url");
const fileInput = get<HTMLInputElement>("pick-file");
const status = get("open-status");
const fileList = get("ws-list");
const search = get<HTMLInputElement>("ws-search");
const stage = get("ws-body");
const notice = get("ws-notice");
const enter = get<HTMLButtonElement>("ws-enter");
const parentButton = get<HTMLButtonElement>("ws-parent");
const share = get<HTMLButtonElement>("ws-share");
const save = get<HTMLButtonElement>("ws-save");
const previous = get<HTMLButtonElement>("ws-prev");
const cancelRead = get<HTMLButtonElement>("ws-cancel");
const cancelOpen = document.querySelector<HTMLButtonElement>("#open-cancel");
const backToFiles = get<HTMLButtonElement>("ws-back-list");
const filesView = get<HTMLButtonElement>("ws-files-view");
const previewView = get<HTMLButtonElement>("ws-preview-view");
const singlePanel = matchMedia(
  "(max-width: 720px), (pointer: coarse) and (max-width: 960px) and (max-height: 540px)",
);
function setPanel(panel: "files" | "preview") {
  workspace.dataset.panel = panel;
  filesView.setAttribute("aria-pressed", String(panel === "files"));
  previewView.setAttribute("aria-pressed", String(panel === "preview"));
}
filesView.addEventListener("click", () => setPanel("files"));
previewView.addEventListener("click", () => setPanel("preview"));

const PAGE_SIZE = 120;
const more = get<HTMLButtonElement>("ws-more");
const textExtensions = new Set(
  "txt md markdown json jsonl log yaml yml ini toml xml html htm js mjs cjs jsx ts tsx css scss py rb sh go rs sql c cpp h hpp java swift kt conf cfg env properties gradle vue astro csv tsv".split(
    " ",
  ),
);
const images: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};
const PREVIEW_LIMIT = 16 * 1024 ** 2;
const TEXT_LIMIT = 192 * 1024;
const parents: Parent[] = [];

let archive: Archive | undefined;
let source: File | URL | undefined;
let publishedId: string | undefined;
let session = new AbortController();
let reading = new AbortController();
let selected: Entry | undefined;
let readyBlob: Blob | undefined;
let imageUrl = "";
let pageOffset = 0;
let matches: Entry[] = [];
let duplicateNames = new Set<string>();
let focusIndex = -1;

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong opening this file.";
}

function displaySize(size: number) {
  if (size < 1024) return `${size} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const power = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length,
  );
  return `${Number((size / 1024 ** power).toFixed(1))} ${units[power - 1]}`;
}

function basename(name: string) {
  const leaf = name.split(/[\\/]/).pop();
  return leaf && leaf !== "." && leaf !== ".." ? leaf : "file";
}

function extension(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(basename(name));
  return match?.[1].toLowerCase() || "";
}

function previewKind(name: string): PreviewKind {
  const ext = extension(name);
  if (Object.hasOwn(images, ext)) return "image";
  if (ext === "csv") return "csv";
  if (
    textExtensions.has(ext) ||
    /^(readme|license|makefile|dockerfile|changelog)$/i.test(basename(name))
  )
    return "text";
  return "binary";
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content = "",
) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

function showStage(text: string, state: "info" | "loading" | "error" = "info") {
  const line = element("p", "pz-message", text);
  line.setAttribute("role", state === "error" ? "alert" : "status");
  line.dataset.state = state;
  if (state === "loading") {
    const spinner = element("span", "cli-spinner");
    spinner.setAttribute("aria-hidden", "true");
    line.prepend(spinner);
  }
  if (state === "error") {
    previewView.disabled = false;
    setPanel("preview");
  }
  stage.replaceChildren(line);
}

function busy(active: boolean) {
  cancelRead.hidden = !active;
  stage.setAttribute("aria-busy", String(active));
}

function releasePreview() {
  busy(false);
  reading.abort();
  reading = new AbortController();
  readyBlob = undefined;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = "";
  save.disabled = false;
  save.removeAttribute("aria-busy");
  get("ws-save-label").textContent = "Save file";
}

function clearSession() {
  session.abort();
  session = new AbortController();
  releasePreview();
  for (const parent of parents.splice(0))
    void parent.archive.close().catch(() => {});
  void archive?.close().catch(() => {});
  archive = undefined;
  source = undefined;
  publishedId = undefined;
  selected = undefined;
  matches = [];
  duplicateNames.clear();
  if (cancelOpen) cancelOpen.hidden = true;
  stage.replaceChildren();
}

let localLink:
  | { name: string; size: number; target: Target; ancestry: Target[] }
  | undefined;

function chooseArchive(file: File) {
  const link = localLink;
  if (link && (link.size !== file.size || link.name !== file.name)) {
    status.textContent =
      "That ZIP doesn’t match this reference. Choose the original ZIP.";
    return;
  }
  cleanAddress();
  void open(file, link?.target, false, link?.ancestry);
}

function resetReference() {
  localLink = undefined;
  get("reference-info").hidden = true;
  get("open-title").textContent = "Open an archive";
  get("reference-zip").textContent = get("reference-file").textContent = "";
  delete status.dataset.awaitingFile;
}

function cleanAddress() {
  resetReference();
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
}

function home() {
  clearSession();
  cleanAddress();
  urlInput.value = "";
  fileInput.value = "";
  workspace.hidden = true;
  landing.hidden = false;
  status.textContent = "";
  fileInput.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

const homeLink = document.querySelector<HTMLAnchorElement>(".wordmark")!;
homeLink.addEventListener("click", (event) => {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey
  )
    return;
  event.preventDefault();
  history.replaceState(null, "", homeLink.pathname);
  home();
});

function canShare(value: File | URL | undefined): value is URL {
  return value instanceof URL && !value.search && !value.hash;
}

function filterFiles() {
  const term = search.value.trim().toLocaleLowerCase();
  const entries = archive?.entries || [];
  matches = term
    ? entries.filter((item) => item.name.toLocaleLowerCase().includes(term))
    : entries;
  pageOffset = Math.min(
    pageOffset,
    Math.floor(Math.max(0, matches.length - 1) / PAGE_SIZE) * PAGE_SIZE,
  );
  showFiles();
}

function showFiles() {
  const page = matches.slice(pageOffset, pageOffset + PAGE_SIZE);
  if (!page.some((item) => item.index === focusIndex))
    focusIndex =
      page.find((item) => item.index === selected?.index)?.index ??
      page[0]?.index ??
      -1;
  const fragment = document.createDocumentFragment();
  for (const item of page) {
    const row = element("button", "pz-row");
    row.type = "button";
    row.dataset.index = String(item.index);
    row.title = item.name;
    row.tabIndex = item.index === focusIndex ? 0 : -1;
    row.setAttribute("aria-current", String(item.index === selected?.index));
    row.setAttribute("aria-controls", "ws-body");
    const text = element("span", "");
    text.append(element("span", "pz-row-name", basename(item.name)));
    const directory = item.name.slice(
      0,
      Math.max(0, item.name.lastIndexOf("/")),
    );
    const context = [
      directory,
      duplicateNames.has(item.name) ? `Entry ${item.index + 1}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (context) text.append(element("span", "pz-row-path", context));
    const kind = element(
      "span",
      "pz-kind",
      extension(item.name).slice(0, 4) || "file",
    );
    kind.dataset.kind =
      extension(item.name) === "zip" ? "archive" : previewKind(item.name);
    row.append(
      kind,
      text,
      element("span", "pz-row-size", displaySize(item.size)),
    );
    fragment.append(row);
  }
  if (!page.length)
    fragment.append(
      element(
        "p",
        "pz-message",
        search.value.trim()
          ? "No matching filenames."
          : "This archive contains no files.",
      ),
    );
  fileList.replaceChildren(fragment);
  get("ws-pager").hidden = matches.length <= PAGE_SIZE;
  previous.disabled = !pageOffset;
  more.disabled = pageOffset + PAGE_SIZE >= matches.length;
  get("ws-page").textContent =
    `${Math.floor(pageOffset / PAGE_SIZE) + 1} / ${Math.max(1, Math.ceil(matches.length / PAGE_SIZE))}`;
  get("ws-count").textContent =
    `${matches.length.toLocaleString()} ${matches.length === 1 ? "file" : "files"}`;
}

function fileRow(item: Entry, position?: number) {
  if (position !== undefined && position >= 0) {
    const offset = Math.floor(position / PAGE_SIZE) * PAGE_SIZE;
    if (offset !== pageOffset) {
      pageOffset = offset;
      showFiles();
    }
  }
  return fileList.querySelector<HTMLButtonElement>(
    `[data-index="${item.index}"]`,
  );
}

function focusFile(position: number) {
  const bounded = Math.min(Math.max(0, position), matches.length - 1);
  const item = matches[bounded];
  if (!item) {
    search.focus();
    return;
  }
  focusIndex = item.index;
  fileRow(item, bounded)?.focus();
}
function refocusList() {
  setPanel("files");
  const position = matches.findIndex(
    (entry) => entry.index === selected?.index,
  );
  if (position < 0) search.focus();
  else focusFile(position);
}

function locateSelected() {
  if (selected && search.value && !matches.includes(selected)) {
    search.value = "";
    filterFiles();
  }
  refocusList();
}

function csvTable(text: string) {
  const table = document.createElement("table");
  for (const values of csvPreviewRows(text)) {
    const tr = table.insertRow();
    for (const value of values) {
      tr.append(element(table.rows.length === 1 ? "th" : "td", "", value));
    }
  }
  return table;
}

async function preview(blob: Blob, item: Entry, signal: AbortSignal) {
  const kind = previewKind(item.name);
  if (kind === "image") {
    imageUrl = URL.createObjectURL(
      blob.slice(0, blob.size, images[extension(item.name)]),
    );
    const image = new Image();
    image.draggable = false;
    image.alt = basename(item.name);
    image.onerror = () => {
      if (!signal.aborted)
        showStage(
          "This image could not be displayed. You can still save the file.",
        );
    };
    image.src = imageUrl;
    stage.replaceChildren(image);
    return;
  }
  const text = await blob.slice(0, TEXT_LIMIT).text();
  if (signal.aborted) return;
  if (text.includes("\0")) {
    showStage(
      "This file contains binary data. Save it to open it on your device.",
    );
    return;
  }
  stage.replaceChildren(
    kind === "csv"
      ? csvTable(text)
      : element("pre", "", text || "(empty file)"),
  );
  if (kind === "csv")
    notice.textContent = "Preview shows up to 100 rows and 24 columns.";
  else if (blob.size > TEXT_LIMIT)
    notice.textContent = `Preview shows the first ${displaySize(TEXT_LIMIT)}.`;
}

function targetFor(item: Entry, active: Archive): Target {
  const duplicate = active.entries.some(
    (entry) => entry.name === item.name && entry.index !== item.index,
  );
  return duplicate
    ? { name: item.name, index: item.index }
    : { name: item.name };
}

function resolveTarget(active: Archive, target: Target) {
  const candidates = active.entries.filter((item) => item.name === target.name);
  if (candidates.length === 1) return candidates[0];
  const match = candidates.find((item) => item.index === target.index);
  if (!match)
    throw new Error(
      candidates.length
        ? "Several files share this path. Select the intended entry from the file index."
        : "The linked file is no longer at this path in the archive.",
    );
  return match;
}

async function pick(item: Entry, reveal = false) {
  if (!archive) return;
  releasePreview();
  const signal = reading.signal;
  selected = item;
  backToFiles.hidden = false;
  previewView.disabled = false;
  if (reveal) setPanel("preview");
  fileList
    .querySelector('[aria-current="true"]')
    ?.setAttribute("aria-current", "false");
  const row =
    fileRow(item) ?? (reveal ? fileRow(item, matches.indexOf(item)) : null);
  row?.setAttribute("aria-current", "true");
  get("ws-filename").textContent = basename(item.name);
  if (reveal) {
    if (singlePanel.matches) {
      previewView.focus({ preventScroll: true });
      if (get("ws-filename").getBoundingClientRect().top < 64)
        get("ws-preview-panel").scrollIntoView({ block: "start" });
    } else {
      row?.focus({ preventScroll: true });
    }
  }

  get("ws-filemeta").textContent = [
    item.name.includes("/") ? item.name : "",
    duplicateNames.has(item.name)
      ? `Entry ${item.index + 1} · duplicate path`
      : "",
    displaySize(item.size),
  ]
    .filter(Boolean)
    .join(" · ");
  share.hidden = false;
  save.hidden = item.size > maxSaveBytes;
  enter.hidden = extension(item.name) !== "zip";
  enter.disabled = false;
  notice.textContent = "";
  if (!enter.hidden) {
    const limit = nestedLimit(parents.length, item);
    enter.disabled = Boolean(limit);
    showStage(
      limit ||
        (item.stored
          ? "Browse this nested archive directly. Only the index and entries you choose are read."
          : `Opening this nested ZIP unpacks ${displaySize(item.size)} into memory on your device.`),
    );
    return;
  }
  const kind = previewKind(item.name);
  const partial =
    item.stored &&
    item.size > PREVIEW_LIMIT &&
    (kind === "text" || kind === "csv");
  if (!partial && item.size > maxSaveBytes) {
    showStage(
      `This entry exceeds the ${displaySize(maxSaveBytes)} per-file limit.`,
    );
    return;
  }
  if (!partial && (kind === "binary" || item.size > PREVIEW_LIMIT)) {
    showStage(
      item.size > PREVIEW_LIMIT
        ? "This file is too large for a preview. Save it to open on your device."
        : "No preview for this file type. Save it to open on your device.",
    );
    return;
  }
  save.disabled = true;
  busy(true);
  showStage("Opening preview…", "loading");
  try {
    const blob = partial
      ? await archive.readPrefix(item.index, TEXT_LIMIT, signal)
      : await archive.read(item.index, signal, PREVIEW_LIMIT);
    if (signal.aborted) return;
    if (!partial) readyBlob = blob;
    await preview(blob, item, signal);
    if (partial && !signal.aborted) {
      const limits = [
        `Partial preview · first ${displaySize(blob.size)} of ${displaySize(item.size)}. Whole-file checksum unverified.`,
      ];
      if (kind === "csv") limits.push("Showing up to 100 rows and 24 columns.");
      if (item.size > maxSaveBytes)
        limits.push("Saving is limited to 256 MiB per file.");
      notice.textContent = limits.join(" ");
    }
  } catch (err) {
    if (!signal.aborted) showStage(message(err), "error");
  } finally {
    if (!signal.aborted) {
      busy(false);
      save.disabled = false;
    }
  }
}

function displayArchive() {
  if (!source) return;
  releasePreview();
  selected = undefined;
  const rootName =
    (source instanceof URL ? basename(source.pathname) : source.name) ||
    "Archive";
  const current = parents.at(-1);
  get("ws-title").textContent = current
    ? basename(current.entry.name)
    : publishedId
      ? "Shared file"
      : rootName;
  get("ws-meta").textContent = publishedId
    ? "Anyone with the link can save this file."
    : source instanceof URL
      ? `Hosted on ${source.host}${canShare(source) ? "" : " · Sharing disabled for this URL"}`
      : "Local ZIP · On this device";
  const crumb = get("ws-breadcrumb");
  crumb.textContent = [
    rootName,
    ...parents.map((parent) => parent.entry.name),
  ].join("  ›  ");
  crumb.hidden = !current;
  parentButton.hidden = !current;
  if (current) {
    const parentName = parents.at(-2)?.entry.name ?? rootName;
    get("ws-parent-name").textContent = basename(parentName);
  }
  get("ws-filename").textContent = "Choose a file";
  get("ws-filemeta").textContent = "";
  notice.textContent = "";
  save.hidden = share.hidden = enter.hidden = true;
  pageOffset = 0;
  focusIndex = -1;
  duplicateNames.clear();
  const seen = new Set<string>();
  for (const entry of archive?.entries || []) {
    if (seen.has(entry.name)) duplicateNames.add(entry.name);
    else seen.add(entry.name);
  }
  backToFiles.hidden = true;
  previewView.disabled = true;
  setPanel("files");
  search.value = "";
  filterFiles();
  showStage("Select a file from the index to preview it here.");
  status.textContent = "";
  if (cancelOpen) cancelOpen.hidden = true;
  landing.hidden = true;
  workspace.hidden = false;
  get("ws-title").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function descend(item: Entry) {
  if (!archive) return false;
  const parent = archive;
  const pending = reading.signal;
  const limit = nestedLimit(parents.length, item);
  if (extension(item.name) !== "zip" || limit) {
    showStage(limit || "The linked path is not a ZIP archive.");
    return false;
  }
  enter.disabled = save.disabled = true;
  busy(true);
  showStage("Opening nested ZIP…", "loading");
  const opening = new AbortController();
  const cancel = () => opening.abort();
  pending.addEventListener("abort", cancel, { once: true });
  try {
    const lifetime = AbortSignal.any([session.signal, opening.signal]);
    const child = await parent.openNested(item.index, lifetime);
    if (pending.aborted) {
      await child.close();
      return false;
    }
    pending.removeEventListener("abort", cancel);
    parents.push({
      archive: parent,
      entry: item,
      target: targetFor(item, parent),
      query: search.value,
      pageOffset,
    });
    archive = child;
    displayArchive();
    return true;
  } catch (err) {
    if (!pending.aborted) showStage(message(err), "error");
    return false;
  } finally {
    pending.removeEventListener("abort", cancel);
    if (!pending.aborted) {
      busy(false);
      enter.disabled = save.disabled = false;
    }
  }
}

function ascend() {
  const parent = parents.pop();
  if (!parent) return;
  void archive?.close().catch(() => {});
  archive = parent.archive;
  displayArchive();
  search.value = parent.query;
  pageOffset = parent.pageOffset;
  filterFiles();
  void pick(parent.entry);
  const row = fileList.querySelector<HTMLButtonElement>(
    `[data-index="${parent.entry.index}"]`,
  );
  if (row) {
    row.focus({ preventScroll: true });
    const listBounds = fileList.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    if (rowBounds.bottom > listBounds.bottom)
      fileList.scrollTop += rowBounds.bottom - listBounds.bottom;
    else if (rowBounds.top < listBounds.top)
      fileList.scrollTop -= listBounds.top - rowBounds.top;
  }
}

async function open(
  sourceToOpen: File | URL,
  target?: Target,
  sample = false,
  ancestry: Target[] = [],
  fileShareId?: string,
) {
  clearSession();
  publishedId = fileShareId;
  const signal = session.signal;
  source = sourceToOpen;
  workspace.hidden = true;
  landing.hidden = false;
  status.textContent = "Reading archive index…";
  if (cancelOpen) cancelOpen.hidden = false;
  try {
    const { openArchive } = await import("./archive");
    if (signal.aborted) return;
    const result = await openArchive(sourceToOpen, signal);
    if (signal.aborted) {
      await result.close();
      return;
    }
    if (fileShareId && result.entries.length !== 1) {
      await result.close();
      throw new Error("This file link is invalid.");
    }
    archive = result;
    const reveal = () => {
      if (!signal.aborted) displayArchive();
    };
    const motion = matchMedia(
      "(prefers-reduced-motion: no-preference)",
    ).matches;
    if (motion && document.startViewTransition) {
      // Switch scroll position and keyboard focus between the two snapshots.
      await document.startViewTransition(reveal).updateCallbackDone;
    } else {
      reveal();
      if (motion && !signal.aborted)
        workspace.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    }
    if (signal.aborted) return;
    let match: Entry | undefined;
    try {
      for (const part of ancestry) {
        const item = resolveTarget(archive, part);
        await pick(item);
        if (signal.aborted || selected !== item || !(await descend(item)))
          return;
      }
      if (target) match = resolveTarget(archive, target);
    } catch (err) {
      if (!signal.aborted) showStage(message(err), "error");
      return;
    }
    const first = sample
      ? (result.entries.find(
          (item) =>
            previewKind(item.name) === "image" && item.size <= PREVIEW_LIMIT,
        ) ?? result.entries[0])
      : undefined;
    if (match || first) await pick((match ?? first)!, true);
  } catch (err) {
    if (!signal.aborted) {
      status.textContent =
        fileShareId && /HTTP (404|410)/.test(message(err))
          ? "This file link has expired or is unavailable. Ask the sender for a new link."
          : message(err);
      if (cancelOpen) cancelOpen.hidden = true;
    }
  }
}

async function download() {
  if (!selected || !archive) return;
  const item = selected;
  const signal = reading.signal;
  save.disabled = true;
  save.setAttribute("aria-busy", "true");
  get("ws-save-label").textContent = "Preparing…";
  busy(true);
  enter.disabled = true;
  try {
    const blob =
      readyBlob ?? (await archive.read(item.index, signal, maxSaveBytes));
    if (signal.aborted) return;
    readyBlob = blob;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = basename(item.name);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (err) {
    if (!signal.aborted) notice.textContent = message(err);
  } finally {
    if (!signal.aborted) {
      busy(false);
      enter.disabled = Boolean(nestedLimit(parents.length, item));
      save.disabled = false;
      save.removeAttribute("aria-busy");
      get("ws-save-label").textContent = "Save file";
    }
  }
}

const shareDialog = get<HTMLDialogElement>("share-dialog");
const shareUrl = get<HTMLInputElement>("share-url");
shareDialog
  .querySelector(".dismiss")!
  .addEventListener("click", () => shareDialog.close());
get("share-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    get("share-status").textContent = "Link copied";
  } catch {
    shareUrl.focus();
    shareUrl.select();
    get("share-status").textContent =
      "The link is selected — use your device’s copy command";
  }
});
const createShare = get<HTMLButtonElement>("share-create");
let publishing: AbortController | undefined;
shareDialog.addEventListener("close", () => publishing?.abort());
function showLink(value: string) {
  shareUrl.value = value;
  shareUrl.hidden =
    shareDialog.querySelector("label")!.hidden =
    get("share-copy").hidden =
      !value;
}

createShare.addEventListener("click", async () => {
  if (
    !selected ||
    !archive ||
    !(source instanceof File) ||
    createShare.disabled
  )
    return;
  const item = selected;
  publishing = new AbortController();
  const signal = AbortSignal.any([publishing.signal, reading.signal]);
  createShare.disabled = true;
  get("share-status").textContent = "Preparing file…";
  try {
    const file =
      readyBlob ?? (await archive.read(item.index, signal, maxSaveBytes));
    signal.throwIfAborted();
    const { publishFile } = await import("./publish-file");
    get("share-status").textContent = "Uploading selected file…";
    const link = await publishFile(basename(item.name), file, signal);
    signal.throwIfAborted();
    showLink(link);
    createShare.hidden = true;
    get("share-detail").textContent =
      "Anyone with this link can preview or download the file for 24 hours.";
    get("share-status").textContent = "Link ready";
    get("share-copy").focus();
  } catch (error) {
    if (!signal.aborted) get("share-status").textContent = message(error);
  } finally {
    if (!signal.aborted) createShare.disabled = false;
  }
});

function showShareDialog() {
  if (!selected || !source || !archive) return;
  const local = source instanceof File;
  const restricted = source instanceof URL && !canShare(source);
  const tooLarge = selected.size > maxSaveBytes;
  get("share-detail").textContent = local
    ? tooLarge
      ? "Files over 256 MiB cannot be shared."
      : `Upload only ${basename(selected.name)} (${displaySize(selected.size)})? Anyone with the link can preview or download it for 24 hours. Your original ZIP stays on this device.`
    : restricted
      ? "Sharing is unavailable for a source URL containing a query or fragment."
      : publishedId
        ? "Anyone with the link can save this shared file until it expires."
        : "This link opens the selected file. Anyone with access to the ZIP can also browse its other files.";
  createShare.hidden = !local || tooLarge;
  createShare.disabled = false;
  get("share-status").textContent = "";
  showLink("");
  shareDialog.showModal();
  if (local || restricted) return;
  if (publishedId && !parents.length) {
    showLink(new URL("/#s=" + publishedId, location.origin).href);
    return;
  }
  const url = new URL(location.pathname, location.origin);
  const item = targetFor(selected, archive);
  const params = new URLSearchParams({
    v: "1",
    src: (source as URL).href,
    file: item.name,
  });
  if (item.index !== undefined) params.set("index", String(item.index));
  for (const { target } of parents) {
    params.append(
      "parent",
      JSON.stringify(
        target.index === undefined
          ? [target.name]
          : [target.name, target.index],
      ),
    );
  }
  url.hash = params.toString();
  showLink(url.href);
}

get("open-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const value = urlInput.value.trim();
    let address: URL;
    try {
      address = new URL(value);
    } catch {
      throw new Error(
        "Paste the complete PeekZip link or a ZIP URL from this site.",
      );
    }
    if (
      address.origin === location.origin &&
      !address.username &&
      !address.password &&
      address.pathname === "/" &&
      address.hash &&
      !address.search
    ) {
      history.replaceState(null, "", address.pathname + address.hash);
      urlInput.value = "";
      followLink();
      return;
    }
    const url = hostedArchiveUrl(value, location.origin);
    cleanAddress();
    void open(url);
  } catch (error) {
    status.textContent = message(error);
  }
});
get("sample").addEventListener("click", () => {
  cleanAddress();
  void open(new URL(samplePath, location.origin), undefined, true);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    chooseArchive(file);
  }
  fileInput.value = "";
});
let dragDepth = 0;
function highlightDrop(active: boolean) {
  landing.classList.toggle("pz-dragging", active);
  document.getElementById("dropzone")?.classList.toggle("dragging", active);
  workspace.classList.toggle("pz-dragging", active);
}
document.addEventListener("dragenter", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    dragDepth++;
    highlightDrop(true);
  }
});
document.addEventListener("dragleave", (event) => {
  if (event.dataTransfer?.types.includes("Files") && --dragDepth <= 0) {
    dragDepth = 0;
    highlightDrop(false);
  }
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});
document.addEventListener("drop", (event) => {
  dragDepth = 0;
  highlightDrop(false);
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  if (event.dataTransfer.files.length !== 1) {
    (workspace.hidden ? status : notice).textContent =
      "Drop one archive at a time.";
    return;
  }
  const file = event.dataTransfer.files[0];
  if (file) {
    chooseArchive(file);
  }
});
cancelOpen?.addEventListener("click", () => {
  home();
  status.textContent = "Opening cancelled.";
});
cancelRead.addEventListener("click", () => {
  releasePreview();
  if (selected) enter.disabled = Boolean(nestedLimit(parents.length, selected));
  notice.textContent = "Operation cancelled.";
  if (!stage.querySelector("img,table,pre"))
    showStage("Select the file again to retry.");
  refocusList();
});
backToFiles.addEventListener("click", locateSelected);
fileList.addEventListener("focusin", (event) => {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement) || !button.dataset.index) return;
  focusIndex = Number(button.dataset.index);
  const previous = fileList.querySelector<HTMLButtonElement>(
    'button[tabindex="0"]',
  );
  if (previous !== button) {
    if (previous) previous.tabIndex = -1;
    button.tabIndex = 0;
  }
});
const keysDialog = get<HTMLDialogElement>("keys-dialog");
function showKeys() {
  keysDialog.showModal();
}
get("ws-shortcuts").addEventListener("click", showKeys);
get("help-shortcuts").addEventListener("click", showKeys);
keysDialog
  .querySelector(".dismiss")!
  .addEventListener("click", () => keysDialog.close());

function previewNeighbor(direction: number) {
  const current = document.activeElement?.closest<HTMLButtonElement>(".pz-row");
  const index = current ? Number(current.dataset.index) : selected?.index;
  const position = matches.findIndex((item) => item.index === index);
  const next = position < 0 ? 0 : position + direction;
  if (next < 0 || next >= matches.length) return;
  focusFile(next);
  void pick(matches[next], true);
}
function changePage(button: HTMLButtonElement) {
  if (button.disabled) return;
  setPanel("files");
  button.click();
}
const shortcuts = new Map<string, () => void>();
function registerShortcuts(
  listId: string,
  commands: [string, string, () => void][],
) {
  const list = get(listId);
  for (const [key, label, run] of commands) {
    shortcuts.set(key, run);
    const term = element("dt", "", label);
    const definition = document.createElement("dd");
    definition.append(element("kbd", "", key));
    list.append(term, definition);
  }
}
registerShortcuts("keys-index", [
  [
    "/",
    "Find a file",
    () => {
      setPanel("files");
      search.focus();
      search.select();
    },
  ],
  ["i", "Go to the file index", locateSelected],
  ["[", "Previous results page", () => changePage(previous)],
  ["]", "Next results page", () => changePage(more)],
]);
registerShortcuts("keys-preview", [
  ["j", "Preview next file", () => previewNeighbor(1)],
  ["k", "Preview previous file", () => previewNeighbor(-1)],
  [
    "v",
    "Go to the preview",
    () => {
      if (selected) {
        setPanel("preview");
        stage.focus();
      }
    },
  ],
  [
    "s",
    "Share this file",
    () => {
      if (selected) share.click();
    },
  ],
]);
registerShortcuts("keys-archive", [
  [
    "u",
    "Go to the parent ZIP",
    () => {
      if (!parentButton.hidden) parentButton.click();
    },
  ],
  ["?", "Open this guide", showKeys],
]);
workspace.addEventListener("keydown", (event) => {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    !(event.target instanceof HTMLElement) ||
    event.target.closest("input, textarea, select, [contenteditable]")
  )
    return;
  const inList = fileList.contains(event.target);
  const inMobilePreview =
    event.target === previewView && workspace.dataset.panel === "preview";
  if (!event.shiftKey && (inList || inMobilePreview)) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (inList && singlePanel.matches) {
        const position = matches.findIndex((item) => item.index === focusIndex);
        focusFile(position + direction);
      } else {
        previewNeighbor(direction);
      }
      return;
    }
    if (inList && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      focusFile(event.key === "Home" ? 0 : matches.length - 1);
      return;
    }
  }
  const shortcut = shortcuts.get(event.key);
  if (!shortcut) return;
  event.preventDefault();
  document.documentElement.removeAttribute("data-pointer");
  if (!event.repeat || event.key === "j" || event.key === "k") shortcut();
});
search.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && matches.length) {
    event.preventDefault();
    focusFile(0);
  }
});
workspace.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!cancelRead.hidden) {
    event.preventDefault();
    cancelRead.click();
    return;
  }
  if (event.target instanceof Element && event.target.closest(".pz-preview")) {
    event.preventDefault();
    refocusList();
  }
});
get("ws-close").addEventListener("click", home);
fileList.addEventListener("click", (event) => {
  const row =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-index]")
      : null;
  if (!row) return;
  const entry = archive?.entries[Number(row.dataset.index)];
  if (entry) void pick(entry, true);
});
enter.addEventListener("click", () => {
  if (selected) void descend(selected);
});
parentButton.addEventListener("click", ascend);
save.addEventListener("click", download);
share.addEventListener("click", showShareDialog);
search.addEventListener("input", () => {
  pageOffset = 0;
  filterFiles();
});
more.addEventListener("click", () => focusFile(pageOffset + PAGE_SIZE));
previous.addEventListener("click", () => focusFile(pageOffset - PAGE_SIZE));

function followLink() {
  const parts = new URLSearchParams(location.hash.slice(1));
  const src = parts.get("src");
  const local = parts.get("local");
  if (localLink) {
    resetReference();
    status.textContent = "";
    if (cancelOpen) cancelOpen.hidden = true;
  }
  if (!location.hash) return;
  try {
    if (parts.has("s")) {
      const id = parts.get("s")!;
      if (!shareIdPattern.test(id)) throw new Error("Invalid file link.");
      if (parseInt(id.split("-")[0], 36) * 1000 <= Date.now())
        throw new Error(
          "This file link has expired. Ask the sender for a new link.",
        );
      void open(
        new URL(sharedArchivePath(id), location.origin),
        undefined,
        true,
        [],
        id,
      );
      return;
    }
    if (parts.get("v") !== "1" || (!src && !local))
      throw new Error("Invalid PeekZip link.");
    const url = src ? hostedArchiveUrl(src, location.origin) : undefined;
    const name = parts.get("file");
    const index = parts.get("index");
    if (url && !canShare(url))
      throw new Error(
        "This link contains a private source URL. Open the archive directly instead.",
      );
    const parents = parts.getAll("parent");
    if (parents.length > maxNestedDepth)
      throw new Error("This link goes beyond the one nested ZIP limit.");
    const ancestry = parents.map((value) => {
      const segment: unknown = JSON.parse(value);
      if (
        !Array.isArray(segment) ||
        segment.length < 1 ||
        segment.length > 2 ||
        typeof segment[0] !== "string" ||
        !segment[0] ||
        (segment.length === 2 &&
          (!Number.isSafeInteger(segment[1]) || segment[1] < 0))
      )
        throw new Error("Invalid nested archive link.");
      return { name: segment[0], index: segment[1] } satisfies Target;
    });
    const target = name
      ? {
          name,
          index: index && /^\d+$/.test(index) ? Number(index) : undefined,
        }
      : undefined;
    if (url) {
      void open(url, target, false, ancestry);
      return;
    }
    const size = Number(parts.get("size"));
    if (
      !local ||
      !target ||
      !parts.has("size") ||
      !Number.isSafeInteger(size) ||
      size < 0
    )
      throw new Error("Invalid local archive link");
    clearSession();
    workspace.hidden = true;
    landing.hidden = false;
    localLink = { name: local, size, target, ancestry };
    status.dataset.awaitingFile = "";
    get("reference-file").textContent = basename(target.name);
    get("reference-zip").textContent = local;
    get("open-title").textContent = "Open a shared file";
    get("reference-info").hidden = false;
    status.textContent = "";
    if (cancelOpen) cancelOpen.hidden = false;
    fileInput.focus();
  } catch (err) {
    home();
    status.textContent = message(err);
  }
}
window.addEventListener("hashchange", () =>
  location.hash ? followLink() : home(),
);
followLink();
