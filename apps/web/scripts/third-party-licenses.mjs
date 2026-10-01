#!/usr/bin/env node
/**
 * Third-party licence notices for the built app (production-readiness audit A077).
 *
 * The app ships a few hundred open-source packages in its bundle, most under
 * licences (MIT, BSD, ISC, Apache, OFL for the fonts …) that require their
 * notice to travel with the software. None did. This script writes one plain
 * text file listing every package ACTUALLY PRESENT in a build, with its version,
 * declared licence and the licence/notice files it ships:
 *
 *   node scripts/third-party-licenses.mjs            # after `vite build --config vite.app.config.ts`
 *   node scripts/third-party-licenses.mjs --dist dist-app --out dist-app/third-party-licenses.txt
 *   node scripts/third-party-licenses.mjs --public   # also refresh the committed public/ copy
 *
 * No dependencies. What counts as "in the build":
 *  1. Every package with a source file in the build's source maps (the app
 *     build emits `sourcemap: 'hidden'`, service worker included). This is the
 *     ground truth, not package.json: devDependencies such as React and TipTap
 *     are bundled, and declared dependencies such as vaul are not.
 *  2. Packages a prebuilt file declares it embeds (`//#region node_modules/…`
 *     markers left by the upstream bundler — docx embeds sax, jszip, xml-js …).
 *  3. Stylesheets and fonts imported from src/ (CSS never appears in the JS
 *     source maps): Tailwind, tw-animate-css, KaTeX's CSS, the Geist and Inter
 *     fonts — whose entries carry the full SIL Open Font License text.
 *  4. The production dependencies of packages that ship only prebuilt
 *     (dist/minified) files, since such a file may compile its dependencies in
 *     without saying so — jszip's prebuilt file carries pako this way. Listed
 *     separately, as possibly included. Over-listing a notice costs nothing;
 *     omitting one is the defect this exists to fix.
 *
 * Fails (exit 1) when the build has no source maps: an empty notice file must
 * never be produced silently. If the build stops emitting maps, switch this to
 * a Vite plugin reading each chunk's `moduleIds` instead.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const POSIX = (p) => p.split(sep).join("/");
const LICENCE_FILE = /^(licen[cs]e|copying|notice|ofl)([.-].*)?$/i;
const MAX_TEXT = 64 * 1024;

/** The package a path belongs to: the segment after its LAST `node_modules/`. */
export function packageFromPath(p) {
  const path = POSIX(p);
  const i = path.lastIndexOf("node_modules/");
  if (i < 0) return null;
  const rest = path.slice(i + "node_modules/".length).split("/");
  if (!rest[0] || rest[0] === ".pnpm" || rest[0] === ".bin") return null;
  const name = rest[0].startsWith("@") ? (rest[1] ? `${rest[0]}/${rest[1]}` : null) : rest[0];
  if (!name) return null;
  return { name, dir: path.slice(0, i) + "node_modules/" + name, inner: rest.slice(name.split("/").length).join("/") };
}

/** Package names a prebuilt file says it embeds (`//#region node_modules/x/…`, `// node_modules/x/…`). */
export function embeddedPackages(content) {
  const out = new Set();
  const re = /(?:\/\/#region |^\/\/ )(\S*node_modules\/\S+)/gm;
  let m;
  while ((m = re.exec(content))) {
    const pkg = packageFromPath(m[1]);
    if (pkg) out.add(pkg.name);
  }
  return [...out];
}

/** Bare package imports in CSS (`@import "x"`) and entry files (`import "x"`). */
export function bareImports(content) {
  const out = new Set();
  const re = /(?:@import\s+|^import\s+)["']([^"'./][^"']*)["']/gm;
  let m;
  while ((m = re.exec(content))) {
    const spec = m[1];
    const parts = spec.split("/");
    out.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  }
  return [...out];
}

function walk(dir, pick, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, pick, out);
    else if (pick(e.name)) out.push(p);
  }
  return out;
}

/**
 * The last directory whose node_modules is searched: the Bun workspace root
 * when this package lives in one (the repository keeps a single hoisted
 * node_modules beside the workspace's package.json, above apps/web), else
 * `rootDir` itself.
 */
const boundaries = new Map();
function moduleBoundary(rootDir) {
  const key = resolve(rootDir);
  if (!boundaries.has(key)) {
    let found = key;
    for (let d = key; ; ) {
      if (readJson(join(d, "package.json"))?.workspaces) {
        found = d;
        break;
      }
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
    boundaries.set(key, found);
  }
  return boundaries.get(key);
}

/** Find `name`'s directory the way Node would, starting from `fromDir`. */
function resolvePackageDir(name, fromDir, rootDir) {
  const stop = moduleBoundary(rootDir);
  let d = fromDir;
  for (;;) {
    const cand = join(d, "node_modules", name);
    if (existsSync(join(cand, "package.json"))) return cand;
    if (resolve(d) === stop) break;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  const atRoot = join(stop, "node_modules", name);
  return existsSync(join(atRoot, "package.json")) ? atRoot : null;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function licenceOf(pkg) {
  if (typeof pkg?.license === "string") return pkg.license;
  if (pkg?.license?.type) return pkg.license.type;
  if (Array.isArray(pkg?.licenses)) return pkg.licenses.map((l) => l?.type ?? l).join(" OR ");
  return null;
}

function sourceUrl(pkg) {
  const repo = typeof pkg?.repository === "string" ? pkg.repository : pkg?.repository?.url;
  let url = (repo || pkg?.homepage || "").trim();
  url = url.replace(/^git\+/, "").replace(/\.git$/, "");
  url = url.replace(/^git:\/\//, "https://").replace(/^git@github\.com:/, "https://github.com/");
  url = url.replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  url = url.replace(/^github:/, "https://github.com/");
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`; // npm "user/repo" shorthand
  return url;
}

/** Everything the notice needs from one installed package. */
export function readPackage(dir) {
  const pkg = readJson(join(dir, "package.json")) ?? {};
  const texts = [];
  for (const f of readdirSync(dir).sort()) {
    if (!LICENCE_FILE.test(f)) continue;
    const full = join(dir, f);
    if (!statSync(full).isFile()) continue;
    let text = readFileSync(full, "utf8").replace(/\r\n/g, "\n").trim();
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n[… truncated; see the package for the full text]";
    texts.push({ file: f, text });
  }
  return {
    name: pkg.name ?? "(unnamed)",
    version: pkg.version ?? "?",
    license: licenceOf(pkg),
    source: sourceUrl(pkg),
    dependencies: Object.keys(pkg.dependencies ?? {}),
    texts,
  };
}

/**
 * Collect every third-party package present in `distDir`'s build.
 * Returns entries keyed "name@version", each with how it got in.
 */
export function collectPackages({ distDir, rootDir, srcDir = join(rootDir, "src") }) {
  const maps = walk(distDir, (n) => n.endsWith(".map"));
  if (maps.length === 0) {
    throw new Error(`no source maps under ${distDir} — build the app first (vite build --config vite.app.config.ts), with build.sourcemap enabled`);
  }
  // absolute package dir → { kind, importedBy, inside, files }
  //   importedBy — stylesheets/entries that import it (CSS, fonts)
  //   inside     — packages whose prebuilt file compiles it in (or may)
  const byDir = new Map();
  const missing = new Map(); // embedded name with no local copy → Set(host)
  const add = (dir, kind, { importedBy, inside, file } = {}) => {
    const key = resolve(dir);
    let e = byDir.get(key);
    if (!e) byDir.set(key, (e = { dir: key, kind, importedBy: new Set(), inside: new Set(), files: new Set() }));
    if (kind === "bundled") e.kind = "bundled";
    else if (kind === "embedded" && e.kind === "dependency") e.kind = "embedded";
    if (importedBy) e.importedBy.add(importedBy);
    if (inside) e.inside.add(inside);
    if (file) e.files.add(file);
  };

  for (const mapFile of maps) {
    const map = readJson(mapFile);
    if (!map?.sources) continue;
    const base = resolve(dirname(mapFile), map.sourceRoot ?? "");
    map.sources.forEach((src, i) => {
      const pkg = packageFromPath(resolve(base, src));
      if (!pkg) return;
      // Some maps are relative to a directory that no longer exists (the
      // service worker is bundled in a temporary one): resolve by name then.
      const pkgDir = existsSync(join(pkg.dir, "package.json")) ? pkg.dir : resolvePackageDir(pkg.name, rootDir, rootDir);
      if (!pkgDir) {
        (missing.get(pkg.name) ?? missing.set(pkg.name, new Set()).get(pkg.name)).add(POSIX(relative(distDir, mapFile)));
        return;
      }
      add(pkgDir, "bundled", { file: pkg.inner });
      const content = map.sourcesContent?.[i];
      if (!content) return;
      const hostName = readJson(join(pkgDir, "package.json"))?.name ?? pkg.name;
      for (const name of embeddedPackages(content)) {
        if (name === hostName) continue;
        const dir = resolvePackageDir(name, pkgDir, rootDir);
        if (dir) add(dir, "embedded", { inside: hostName });
        else (missing.get(name) ?? missing.set(name, new Set()).get(name)).add(hostName);
      }
    });
  }

  // Stylesheets and fonts: CSS is not in the JS source maps.
  const styleSources = [
    ...walk(srcDir, (n) => n.endsWith(".css")),
    ...["main.tsx", "embed.tsx"].map((f) => join(srcDir, f)).filter((f) => existsSync(f)),
  ];
  for (const file of styleSources) {
    for (const name of bareImports(readFileSync(file, "utf8"))) {
      const dir = resolvePackageDir(name, rootDir, rootDir);
      if (dir) add(dir, "bundled", { importedBy: POSIX(relative(rootDir, file)) });
    }
  }

  // Packages that ship only MINIFIED prebuilt bundles (browserify/UMD style,
  // e.g. jszip.min.js) compile their whole dependency tree in without leaving
  // a marker. An ordinary dist/ ESM file imports its dependencies instead, so
  // those already appear in the source maps on their own.
  const names = () => new Set([...byDir.values()].map((e) => readJson(join(e.dir, "package.json"))?.name));
  const queue = [...byDir.values()].filter(
    (e) => e.files.size > 0 && [...e.files].every((f) => /\.min\.[cm]?js$/.test(f)),
  );
  const seen = new Set();
  while (queue.length) {
    const host = queue.shift();
    if (seen.has(host.dir)) continue;
    seen.add(host.dir);
    const info = readPackage(host.dir);
    const present = names();
    for (const dep of info.dependencies) {
      if (dep.startsWith("@types/") || present.has(dep)) continue;
      const dir = resolvePackageDir(dep, host.dir, rootDir);
      if (!dir) continue;
      add(dir, "dependency", { inside: info.name });
      queue.push(byDir.get(resolve(dir)));
    }
  }

  const entries = new Map();
  const rank = { bundled: 0, embedded: 1, dependency: 2 };
  for (const e of byDir.values()) {
    const info = readPackage(e.dir);
    const key = `${info.name}@${info.version}`;
    const prev = entries.get(key);
    const next = { ...info, kind: e.kind, importedBy: [...e.importedBy].sort(), inside: [...e.inside].sort() };
    if (!prev || rank[e.kind] < rank[prev.kind]) entries.set(key, next);
  }
  return {
    entries: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
    missing: [...missing.entries()].map(([name, hosts]) => ({ name, hosts: [...hosts].sort() })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const RULE = "-".repeat(78);

function entryBlock(e) {
  const lines = [RULE, `${e.name} ${e.version}`, `Licence: ${e.license ?? "not declared in package.json — see the text below"}`];
  if (e.source) lines.push(`Source: ${e.source}`);
  if (e.importedBy.length) lines.push(`Imported by: ${e.importedBy.join(", ")}`);
  if (e.kind === "bundled" && e.inside.length) lines.push(`Also compiled into: ${e.inside.join(", ")}`);
  if (e.kind === "embedded") lines.push(`Included inside: ${e.inside.join(", ")} (compiled into its prebuilt file; licence text from the locally installed copy)`);
  if (e.kind === "dependency") lines.push(`May be included inside: ${e.inside.join(", ")} (a dependency of a package that ships a minified prebuilt bundle)`);
  lines.push("");
  if (e.texts.length === 0) lines.push(`(This package ships no licence file. Its package.json declares: ${e.license ?? "nothing"}.)`, "");
  for (const t of e.texts) lines.push(`[${t.file}]`, "", t.text, "");
  return lines.join("\n");
}

/** The notice file. Deterministic: no dates, sorted, so a rebuild with the same dependencies is byte-identical. */
export function renderNotices({ entries, missing }, appName = "Markdown Studio") {
  const bundled = entries.filter((e) => e.kind !== "dependency");
  const deps = entries.filter((e) => e.kind === "dependency");
  const licences = [...new Set(entries.map((e) => e.license ?? "UNDECLARED"))].sort();
  const out = [
    `THIRD-PARTY SOFTWARE NOTICES — ${appName}`,
    "",
    `${appName} is built with the open-source software listed below. Each entry gives`,
    "the package, its version, its licence and the licence and notice files it ships.",
    "The list is generated from the packages actually present in the application build",
    "(scripts/third-party-licenses.mjs), not from a hand-maintained list.",
    "",
    "The Geist and Inter typefaces are licensed under the SIL Open Font License,",
    "Version 1.1; the full licence text is reproduced in their entries",
    "(@fontsource-variable/geist, @fontsource-variable/inter).",
    "",
    `Licences in use: ${licences.join(", ")}.`,
    `Packages: ${bundled.length} included in the build, ${deps.length} more that may be compiled into them.`,
    "",
    "=".repeat(78),
    "PART 1 — INCLUDED IN THE BUILD",
    "=".repeat(78),
    "",
    ...bundled.map(entryBlock),
  ];
  if (missing.length) {
    out.push(RULE, "Also compiled into prebuilt packages above, with no separately installed copy:", "");
    for (const m of missing) out.push(`  ${m.name} — inside ${m.hosts.join(", ")}; see that package's own notices.`);
    out.push("");
  }
  if (deps.length) {
    out.push(
      "=".repeat(78),
      "PART 2 — DEPENDENCIES OF PREBUILT PACKAGES",
      "These are dependencies of packages that ship only prebuilt files. Those files may",
      "compile them in, so their notices are reproduced here as well.",
      "=".repeat(78),
      "",
      ...deps.map(entryBlock),
    );
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function main(argv) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(scriptDir, "..");
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const distDir = resolve(rootDir, arg("--dist") ?? "dist-app");
  const outFile = resolve(rootDir, arg("--out") ?? join(distDir, "third-party-licenses.txt"));
  const result = collectPackages({ distDir, rootDir });
  const text = renderNotices(result);
  writeFileSync(outFile, text);
  const targets = [outFile];
  if (argv.includes("--public")) {
    const pub = join(rootDir, "public", "third-party-licenses.txt");
    writeFileSync(pub, text);
    targets.push(pub);
  }
  const included = result.entries.filter((e) => e.kind !== "dependency").length;
  console.log(`third-party-licenses: ${included} packages in the build (+${result.entries.length - included} dependencies of prebuilt packages) → ${targets.map((t) => POSIX(relative(rootDir, t))).join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`third-party-licenses: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
