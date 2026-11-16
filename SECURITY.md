# Security

[Report a vulnerability privately on GitHub](https://github.com/sansynx/peekzip/security/advisories/new). Use a synthetic archive to reproduce the issue and keep sensitive details out of public issues.

Include the affected commit or deployment, browser version, reproduction steps and observed impact. Remove signed URLs, credentials and personal filenames from attachments.

Reports should target `main` or the [live viewer](https://peekzip.vercel.app). There is no published release-support schedule.

## Privacy boundaries

- Local archive contents stay in the browser. A local share link contains the archive name, byte size and selected path. The recipient supplies a matching ZIP.
- Remote reads go directly to the archive host using bounded byte ranges. A hosted share link contains the source URL and selected path. Access to other entries follows the source host’s permissions.
- Treat filenames, paths and preview contents as untrusted input.
