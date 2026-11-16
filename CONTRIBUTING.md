# Contributing to peekzip

Start with the [local setup](README.md#run-locally). To serve the production build locally, run `pnpm run build` followed by `pnpm run preview`.

## Before opening a pull request

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

- For **viewer changes**, try the sample on a phone-sized screen and desktop. Click a file, step through previews with the arrow keys, and check touch scrolling with content that overflows.
- For **archive-reader changes**, test a local ZIP and an HTTP source that supports byte ranges. Reader regression tests live in `test/`.
- For **performance claims**, include the setup and measured result. Keep generated fixtures in the ignored `.local/` directory. See the [ZIP64 benchmark guide](benchmarks/README.md).

Describe what changed and how you checked it. For a bug, include the browser version, steps to reproduce and expected and observed behavior. Use a small synthetic archive and omit private filenames, archive URLs and credentials.

Report vulnerabilities through the [private reporting process](SECURITY.md).
