// @vitest-environment node
/**
 * One Node range, and it is the toolchain's (A113).
 *
 * `engines.node` said `^20.19.0 || >=22.12.0` — Vite 8's range — while ESLint
 * 10 needs `^20.19.0 || ^22.13.0 || >=24`, so the manifest admitted Node
 * 22.12 on which `bun run lint` refuses to start. CI never chose a Node at all:
 * every job ran the runner image's default, so a new image could move the gate
 * to a version outside the range without a line changing here.
 *
 * Now `.node-version` names the major CI runs, every workflow job installs it
 * with `actions/setup-node`, and `engines.node` is checked against what every
 * direct dependency INSTALLED here declares: any Node the range admits must be
 * one each tool admits too. Upgrading a tool that needs a newer Node turns this
 * red and names the tool.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const RANGE = pkg.engines?.node ?? "";
const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

// ── a minimal semver, enough for the engines ranges in this tree ────────────
// `^22`, `^22.13.0`, `>=24`, `>= 20`, `>=18.0.0 <20`, `~20.1`, `20.19.0`, `*`, `||`.
const parse = (v) => {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function comparator(version, c) {
  if (c === "*" || c === "" || c === "x") return true;
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(c);
  const [, op = "=", rest] = m;
  const v = parse(version);
  const b = parse(rest);
  const parts = rest.split(".").length;
  switch (op) {
    case "^": {
      if (cmp(v, b) < 0) return false;
      if (b[0] > 0 || parts === 1) return v[0] === b[0];
      if (b[1] > 0 || parts === 2) return v[0] === 0 && v[1] === b[1];
      return cmp(v, b) === 0;
    }
    case "~": return cmp(v, b) >= 0 && v[0] === b[0] && (parts === 1 || v[1] === b[1]);
    case ">=": return cmp(v, b) >= 0;
    case ">": return cmp(v, b) > 0;
    case "<=": return cmp(v, b) <= 0;
    case "<": return cmp(v, b) < 0;
    default: return parts === 1 ? v[0] === b[0] : parts === 2 ? v[0] === b[0] && v[1] === b[1] : cmp(v, b) === 0;
  }
}
function satisfies(version, range) {
  return range.split("||").some((set) =>
    set.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1").split(/\s+/).every((c) => comparator(version, c)),
  );
}
/** Every version a range or comparator names, as a probe point. */
const pointsIn = (range) => [...range.matchAll(/\d+(?:\.\d+){0,2}/g)].map((m) => parse(m[0]).join("."));

// ── the toolchain ──────────────────────────────────────────────────────────
const requireFromRoot = createRequire(join(ROOT, "package.json"));
function installedEngines() {
  const out = [];
  for (const name of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]) {
    let manifest;
    try {
      manifest = requireFromRoot(`${name}/package.json`);
    } catch {
      // A package whose exports map hides package.json: read it off disk.
      manifest = JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8"));
    }
    if (manifest.engines?.node) out.push({ name, version: manifest.version, range: manifest.engines.node });
  }
  return out;
}

/** Probe versions: every bound named anywhere, plus the start and far end of each major. */
function probes(tools) {
  const set = new Set([...pointsIn(RANGE), ...tools.flatMap((t) => pointsIn(t.range))]);
  for (let major = 16; major <= 40; major++) {
    set.add(`${major}.0.0`);
    set.add(`${major}.999.0`);
  }
  return [...set];
}

describe("engines.node is the toolchain's range", () => {
  const tools = installedEngines();

  it("reads the engines of the installed direct dependencies (the check is not vacuous)", () => {
    const names = tools.map((t) => t.name);
    for (const expected of ["vite", "vitest", "eslint", "jsdom"]) expect(names).toContain(expected);
  });

  it("admits no Node that a direct dependency refuses", () => {
    const offenders = [];
    for (const v of probes(tools)) {
      if (!satisfies(v, RANGE)) continue;
      for (const t of tools) {
        if (!satisfies(v, t.range)) offenders.push(`Node ${v}: ${t.name}@${t.version} needs ${t.range}`);
      }
    }
    // Deduplicate by tool, keeping the first (lowest) version it refuses.
    const first = new Map();
    for (const o of offenders) {
      const tool = o.split(": ")[1];
      if (!first.has(tool)) first.set(tool, o);
    }
    expect([...first.values()]).toEqual([]);
  });

  it("is bounded below (a floor per major, no bare `*`)", () => {
    expect(RANGE).not.toMatch(/^\s*\*?\s*$/);
    expect(satisfies("0.0.0", RANGE)).toBe(false);
  });
});

describe("CI runs a Node inside that range, and every job chooses it", () => {
  const pinned = read(".node-version").trim();

  it("`.node-version` names a major the range admits at its newest patch", () => {
    expect(pinned).toMatch(/^\d+$/);
    expect(satisfies(`${pinned}.999.0`, RANGE)).toBe(true);
  });

  const workflows = readdirSync(join(ROOT, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f));
  const jobsOf = (text) => {
    const body = text.slice(text.indexOf("\njobs:\n") + 7);
    return body.split(/\n(?= {2}[a-z0-9_-]+:\n)/).filter((b) => /^ {2}[a-z0-9_-]+:\n/.test(b));
  };

  it("finds the jobs it checks (the check is not vacuous)", () => {
    const toolchainJobs = workflows.flatMap((f) => jobsOf(read(`.github/workflows/${f}`))).filter((j) => /bun install/.test(j));
    expect(toolchainJobs.length).toBeGreaterThanOrEqual(5); // verify, react18, e2e, e2e-engines, publish
  });

  it.each(workflows)("%s: every job that installs the toolchain sets up Node from .node-version", (file) => {
    const missing = [];
    for (const job of jobsOf(read(`.github/workflows/${file}`))) {
      const name = job.match(/^ {2}([a-z0-9_-]+):/)[1];
      // A job that installs the dependencies runs them (Vite, Vitest, ESLint,
      // the e2e rig) on Node — even through `bunx`, which honours their
      // `#!/usr/bin/env node`. The uptime probe only runs curl.
      if (!/bun install/.test(job)) continue;
      if (!/uses: actions\/setup-node@[0-9a-f]{40}/.test(job) || !/node-version-file: \.node-version/.test(job)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });
});
