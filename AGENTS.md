# Working on peekzip

- Use Node.js 24 and pnpm 12 with the checked-in lockfile
- Keep the app static and local-first. Local archive data stays in the browser. Remote reads go directly to the source with bounded ranges and cancellation
- Archive I/O and validation live in `src/lib/archive.ts`. Selection, nesting and sharing live in `src/lib/app.ts`. Preserve size, depth and read limits unless a change explicitly requires adjusting them
- Use `src/pages/index.astro` for the opener and dialogs and `src/components/Workspace.astro` for the archive explorer. Maintain keyboard focus, touch targets, mobile panel switching and reduced-motion behavior
- Run `pnpm run typecheck`, `pnpm test` and `pnpm run build` before submitting changes. Verify affected interactions in a browser. Keep evidence for published performance claims and distinguish measured runs from estimates
- Put temporary scripts, private fixtures, screenshots and local benchmark output in `.local/`. Only `dist/` is the deployable site
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Publishing, pushing or deploying requires explicit authorization
