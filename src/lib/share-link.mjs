// The expiry is public. The random part is the bearer credential.
export const shareIdPattern = /^[0-9a-z]{6,9}-[0-9a-f]{32}$/;
export const shareLifetime = 24 * 60 * 60 * 1000;
export const maxSharedZipBytes = 256 * 1024 ** 2 + 4096;

/** @param {string} id */
export function sharedArchivePath(id) {
  return `/shared/${id}.zip`;
}
