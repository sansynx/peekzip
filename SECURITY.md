# Security

[Report a vulnerability privately on GitHub](https://github.com/sansynx/peekzip/security/advisories/new). Use a synthetic archive to reproduce the issue and keep sensitive details out of public issues.

Include the affected commit or deployment, browser version, reproduction steps and observed impact. Remove signed URLs, credentials and personal filenames from attachments.

Reports should target `main` or the [live viewer](https://peekzip.vercel.app). There is no published release-support schedule.

## Privacy boundaries

- Local ZIPs stay on the sender’s device. **Create file link** uploads only the selected entry, packaged under its basename in a single-file ZIP. Anyone with the unguessable link can read that file for 24 hours. Vercel Blob holds the copy in a private store with a one-day deletion policy.
- Hosted ZIPs must use the viewer’s exact HTTP(S) origin and a direct `.zip` path. Reads omit credentials and referrers, reject redirects and validate byte ranges. ZIP extraction runs in the browser. The file-sharing endpoint issues a short-lived, size-limited PUT for a single object. A hosted share link contains the source URL and selected path. Access to other entries follows the source host’s permissions.
- A user can open one child ZIP. The archive reader enforces depth and size limits on every entry path, including shared links. Compressed children can expand to 64 MiB. A full save is capped at 256 MiB. The index is limited to 100,000 entries and 32 MiB per read. Full previews are capped at 16 MiB. Large stored text and CSV previews read only the first 192 KiB and skip whole-file checksum verification.
- Legacy local references match by archive filename and byte size; they contain no file data. Recipients should obtain their archive from a trusted source.
- Treat filenames, paths and preview contents as untrusted input.
