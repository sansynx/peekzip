export const maxNestedDepth = 1;
export const maxNestedBytes = 64 * 1024 ** 2;
export const maxSaveBytes = 256 * 1024 ** 2;

export function hostedArchiveUrl(
  value: string,
  origin: string | undefined,
): URL {
  const message =
    "Use a direct .zip URL on this site's origin, or choose a local file.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  if (
    url.origin !== origin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.pathname.toLowerCase().endsWith(".zip")
  )
    throw new Error(message);
  return url;
}

export function nestedLimit(
  depth: number,
  entry: { stored: boolean; size: number },
) {
  if (depth >= maxNestedDepth)
    return "One nested ZIP is allowed. This ZIP is already inside another archive.";
  if (!entry.stored && entry.size > maxNestedBytes)
    return "Compressed nested ZIPs can be opened up to 64 MiB each.";
  return "";
}
