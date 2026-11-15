# Contributing to peekzip

Use Node.js 24 and pnpm 12. Run `pnpm install --frozen-lockfile` and `pnpm run dev` to start a local instance. The sample archive is a convenient first check for a change to file selection, previews or navigation.

Before submitting a change, run

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

For UI changes, exercise the affected flow at phone and desktop widths with touch and keyboard. For archive-reader changes, test local and range-enabled remote ZIPs. Keep regression tests in `test/`; they exercise the reader without shipping in the static site. The optional [large-archive benchmark](benchmarks/README.md) has its own setup.

In a pull request, describe the user-visible change, why it helps, and the checks you ran. For bugs, include the browser, steps to reproduce, and expected and observed behavior. A small synthetic ZIP is enough. Keep personal archive links, filenames, credentials, screenshots and captures out of public reports.

Use [the security reporting process](SECURITY.md) for suspected vulnerabilities.
