# Security

Report vulnerabilities privately. On GitHub, use **Security → Report a vulnerability** when the repository offers private reporting. If that option is unavailable, open an issue asking the maintainer for a private reporting channel and withhold the vulnerability details until one is available.

Include the affected commit or deployment, browser version, minimal steps using synthetic data, and the impact you observed. Remove signed URLs, tokens, private filenames and real archives from attachments and logs.

Report against the current main branch or the hosted viewer. There is no published release-support schedule.

## Privacy boundaries

Local files are processed in the browser. Remote archives are read from their own host using bounded HTTP ranges. A shared preview link identifies the archive and entry and grants no additional access control over the source. Treat untrusted archive contents and filenames as data in any proposed preview change.
