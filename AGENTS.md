# Working on peekzip

- Use Node.js 24 and pnpm 12 with the checked-in lockfile
- Keep the app static and local-first. Local archive data stays in the browser. Hosted reads require a direct same-origin ZIP URL, bounded ranges and cancellation
- Archive I/O and validation live in `src/lib/archive.ts`. Selection, nesting and sharing live in `src/lib/app.ts`. Shared URL and nested archive rules live in `src/lib/archive-policy.ts`. Enforce the one-child depth limit in the reader and keep the UI and share links consistent. Preserve size and read limits unless a change explicitly requires adjusting them
- Use `src/pages/index.astro` for the opener and dialogs and `src/components/Workspace.astro` for the archive explorer. Scrollbar synchronization lives in `src/lib/scroll.ts`. Maintain keyboard focus, touch targets, mobile panel switching and reduced-motion behavior
- Run `pnpm run typecheck`, `pnpm test`, `pnpm run build` and `pnpm run test:e2e` before submitting changes. Verify affected interactions in a browser. Keep evidence for published performance claims and distinguish measured runs from estimates
- Put temporary scripts, private fixtures, screenshots and local benchmark output in `.local/`. Only `dist/` is the deployable site
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Publishing, pushing or deploying requires explicit authorization

## Video production

Use the [Remotion skills](https://github.com/remotion-dev/skills) for every video task. Start with `remotion-best-practices`. Install with `npx skills add remotion-dev/skills` if unavailable. Use the mark and fonts from `public/` and verify performance copy against the historical measurements linked from the [README](README.md#measured-performance). Identify the fixture and measurement conditions on screen when citing timings. Confirm the exported duration and streams and review representative frames before delivery. Keep exported videos and production artwork outside the repository.
