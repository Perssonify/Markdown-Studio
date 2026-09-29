# Runbook — Deploy Broken / Blank Page

## Symptoms
- Vercel deploy fails, or the deployed site loads a blank white page.
- `#root` never mounts; console may be empty or show a module error.

## Diagnosis
1. **Build vs runtime?**
   - **Build failed** → check the Vercel build log. `vercel.json` runs `bun run build:app` (→ `vite build --config vite.app.config.ts`). Look for a TypeScript error, a missing dependency, or a bad import — reproduce locally with `bun run build:app`.
   - **Build succeeded, page blank** → open devtools console on the deployed URL.
2. **Blank page checks:**
   - No `[DIAG +0ms] [BOOT]` log → the JS bundle didn't load/execute (bad asset path, CSP, or a throwing module at import time).
   - `[BOOT] root element: MISSING` → `index.html` didn't ship `<div id="root">` (it should — [index.html](../../index.html)).
   - A thrown error in a top-level module → the [ErrorBoundary](../../src/ui/ErrorBoundary.tsx) only catches *render* errors, not import-time throws.
3. **Routing:** deep links 404? Confirm the SPA rewrite (`/(.*) → /index.html`) is in [vercel.json](../../vercel.json).

## Remediation
- **Bad build locally first:** reproduce with `bun run build:app && bun run preview` before pushing. If `preview` is blank, it's a real bundle problem, not Vercel.
- **Rollback:** redeploy the last green deployment from the Vercel dashboard while you fix forward.
- **Dependency drift:** if CI/Vercel installs differ from yours, ensure `bun.lock` is committed and up to date (Vercel runs `bun install`).

## Prevention
- Run `bun run build:app && bun run preview` and `bunx tsc --noEmit` before merging to `main`. CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) runs the same gate on every PR ([workflows.md](../workflows.md#cicd-pipeline)), but reproducing locally is faster.

## Escalation
No on-call. If a Vercel-specific issue (not reproducible locally), check Vercel status and the project's build settings; otherwise file a GitHub issue with the build log.
