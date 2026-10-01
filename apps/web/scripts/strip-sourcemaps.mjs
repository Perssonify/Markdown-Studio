#!/usr/bin/env node
/**
 * Keep sourcemaps out of the deploy (production-readiness audit A016).
 *
 * The app build emits `sourcemap: 'hidden'` maps: nothing references them, but
 * they sat in dist-app/ and were deployed — about 130 files, 25 MB of a 35 MB
 * deploy, i.e. the app's whole readable source to anyone who guessed a URL.
 * They cannot simply be switched off: the third-party licence scan
 * (scripts/third-party-licenses.mjs) reads them to learn which packages
 * shipped, and they are what turns a minified stack from "Copy diagnostics"
 * back into source lines. So they are built, used, and then MOVED here, out of
 * the published directory:
 *
 *   node scripts/strip-sourcemaps.mjs                       # dist-app → dist-app-sourcemaps
 *   node scripts/strip-sourcemaps.mjs --dist dist-app --out dist-app-sourcemaps
 *
 * Run it LAST — after every step that reads the maps. Idempotent: a second run
 * finds nothing to move. Existing files in the destination are replaced.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Move every `.map` under `dist` to the same relative path under `out`. Returns the count. */
export function stripSourcemaps(dist, out) {
  if (!existsSync(dist)) return 0;
  let moved = 0;
  for (const file of walk(dist)) {
    if (!file.endsWith(".map")) continue;
    const dest = join(out, relative(dist, file));
    mkdirSync(dirname(dest), { recursive: true });
    rmSync(dest, { force: true });
    renameSync(file, dest);
    moved++;
  }
  return moved;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dist = resolve(root, arg("--dist", "dist-app"));
  const out = resolve(root, arg("--out", "dist-app-sourcemaps"));
  const n = stripSourcemaps(dist, out);
  console.log(`strip-sourcemaps: moved ${n} .map file(s) from ${relative(root, dist)}/ to ${relative(root, out)}/`);
}
