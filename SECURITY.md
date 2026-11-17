# Security

[Report a vulnerability privately on GitHub](https://github.com/sansynx/peekzip/security/advisories/new). Use a synthetic archive to reproduce the issue and keep sensitive details out of public issues.

Include the affected commit or deployment, browser version, reproduction steps and observed impact. Remove signed URLs, credentials and personal filenames from attachments.

Reports should target `main` or the [live viewer](https://peekzip.vercel.app). There is no published release-support schedule.

## Privacy boundaries

- Local archive contents stay in the browser. A local share link contains the archive name, byte size and selected path. The recipient supplies a matching ZIP.
- Hosted ZIPs must use the viewer’s exact HTTP(S) origin and a direct `.zip` path. Reads omit credentials and referrers, reject redirects and validate byte ranges. The viewer offers no server-side upload or extraction endpoint. A hosted share link contains the source URL and selected path. Access to other entries follows the source host’s permissions.
- A user can open one child ZIP. The archive reader enforces depth and size limits on every entry path, including shared links. Compressed children can expand to 64 MiB. A full save is capped at 256 MiB. Read and index limits are documented in the [README](README.md#limits).
- A local link matches by filename and byte size. Recipients should obtain their archive from a trusted source.
- Treat filenames, paths and preview contents as untrusted input.
