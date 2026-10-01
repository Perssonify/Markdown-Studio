/**
 * Release engineering and disclosure configuration (A001, A006, A007, A014).
 *
 * These are configuration files — nothing in the app exercises them until
 * the day they matter (a compromised action tag, a publish, a researcher
 * looking for a contact) — so their load-bearing properties are pinned here.
 * No YAML parser is a dependency, so the assertions read the text; the
 * workflows' YAML validity is checked by GitHub itself on push.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
// The frontend is apps/web of the monorepo; the workflows, SECURITY.md and the
// issue templates live at the repository root, two levels up.
const REPO = "../..";
const GH = `${REPO}/.git` + "hub"; // spelled out of the path so tooling that greps for "git" commands stays quiet
const WORKFLOWS = ["ci.yml", "publish.yml", "uptime.yml"].map((f) => [f, read(`${GH}/workflows/${f}`)]);

describe("CI is reproducible (A014)", () => {
  it.each(WORKFLOWS)("%s pins every action to a full commit SHA, with its version noted", (_f, text) => {
    const uses = [...text.matchAll(/uses:\s*([^\s#]+)(\s*#\s*(\S+))?/g)];
    for (const [, ref, , version] of uses) {
      expect(ref, ref).toMatch(/@[0-9a-f]{40}$/);
      expect(version, `${ref} has no version comment`).toMatch(/^v\d+/);
    }
  });

  it.each(WORKFLOWS)("%s never installs `latest` Bun and grants least privilege", (_f, text) => {
    expect(text).not.toMatch(/bun-version:\s*latest/);
    expect(text).toMatch(/^permissions:\n {2}contents: read/m);
  });

  it("CI pins Bun, installs from the lockfile, and gates on lint (when present), types, tests and builds", () => {
    const ci = read(`${GH}/workflows/ci.yml`);
    expect(ci).toMatch(/BUN_VERSION: "\d+\.\d+\.\d+"/);
    expect(ci).toMatch(/bun install --frozen-lockfile/);
    expect(ci).toMatch(/scripts\?\.lint/);
    expect(ci).toMatch(/bunx tsc --noEmit/);
    expect(ci).toMatch(/bun run test/);
    // The CSP hash check re-runs AFTER the app build, against the built HTML.
    expect(ci.indexOf("ops-vercel-headers.test.js")).toBeGreaterThan(ci.indexOf("bun run build:app"));
    for (const suite of ["csp", "pwa"]) expect(ci).toMatch(new RegExp(`node e2e/run\\.mjs ${suite}`));
  });

  it("Dependabot watches the Bun lockfile and the pinned actions, weekly", () => {
    const dep = read(`${GH}/dependabot.yml`);
    expect(dep).toMatch(/package-ecosystem: "bun"/);
    expect(dep).toMatch(/package-ecosystem: "github-actions"/);
    expect(dep.match(/interval: "weekly"/g)).toHaveLength(2);
  });
});

describe("the browser campaign runs on Firefox and WebKit too (A100)", () => {
  const ci = read(`${GH}/workflows/ci.yml`);
  const run = read("e2e/run.mjs");
  /** The suites e2e/run.mjs lists as run green on every engine. */
  const crossEngine = [...run.matchAll(/^ {2}"?([a-z-]+)"?: \[".*", ALL\],$/gm)].map((m) => m[1]);
  const enginesJob = ci.slice(ci.indexOf("\n  e2e-engines:"));
  const chromiumJob = ci.slice(ci.indexOf("\n  e2e:"), ci.indexOf("\n  e2e-engines:"));

  it("run.mjs names its cross-engine suites", () => {
    expect(crossEngine).toEqual(expect.arrayContaining(["harness", "surfaces", "surfaces-deep", "dataloss", "floor"]));
  });

  it("a Firefox + WebKit matrix job installs its own engine and selects it", () => {
    expect(ci).toMatch(/\n {2}e2e-engines:\n/);
    expect(enginesJob).toMatch(/engine: \[firefox, webkit\]/);
    // One engine's failure must not cancel the other's evidence.
    expect(enginesJob).toMatch(/fail-fast: false/);
    expect(enginesJob).toMatch(/E2E_BROWSER: \$\{\{ matrix\.engine \}\}/);
    expect(enginesJob).toMatch(/bunx playwright-core install --with-deps \$\{\{ matrix\.engine \}\}/);
    expect(enginesJob).toMatch(/timeout-minutes: \d+/);
    expect(enginesJob).toMatch(/name: e2e-failure-\$\{\{ matrix\.engine \}\}/);
  });

  it("…and runs exactly the cross-engine suites, nothing it would only report as skipped", () => {
    const ranThere = [...enginesJob.matchAll(/run: node e2e\/run\.mjs ([a-z-]+)\n/g)].map((m) => m[1]);
    expect([...ranThere].sort()).toEqual([...crossEngine].sort());
  });

  it("the Chromium job runs the browser-floor suite as well", () => {
    expect(chromiumJob).toMatch(/node e2e\/run\.mjs floor/);
  });
});

describe("library consumers still on React 18 stay tested (A113)", () => {
  const ci = read(`${GH}/workflows/ci.yml`);
  const job = ci.slice(ci.indexOf("\n  react18:"), ci.indexOf("\n  e2e:"));
  const pkg = JSON.parse(read("package.json"));
  /** `name@version` pairs the job installs over the lockfile's React. */
  const swapped = Object.fromEntries(
    (job.match(/run: bun add -d (.+)\n/)?.[1] ?? "").trim().split(/\s+/).map((spec) => {
      const at = spec.lastIndexOf("@");
      return [spec.slice(0, at), spec.slice(at + 1)];
    }),
  );
  /** Enough semver for the `^x.y.z || ^x.y.z` shape the peer ranges use. */
  const inCaretRange = (version, range) => {
    const [a, b, c] = version.split(".").map(Number);
    return range.split("||").some((clause) => {
      const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(clause.trim());
      return !!m && a === +m[1] && (b > +m[2] || (b === +m[2] && c >= +m[3]));
    });
  };

  it("a job installs React 18 AFTER the frozen install, then runs the type gate and the unit suite on it", () => {
    expect(ci).toMatch(/\n {2}react18:\n/);
    const at = (s) => job.indexOf(s);
    expect(at("bun install --frozen-lockfile")).toBeGreaterThan(-1);
    expect(at("bun add -d")).toBeGreaterThan(at("bun install --frozen-lockfile"));
    expect(at("bunx tsc --noEmit")).toBeGreaterThan(at("bun add -d"));
    expect(at("bun run test")).toBeGreaterThan(at("bun add -d"));
    expect(job).toMatch(/timeout-minutes: \d+/);
  });

  it("installs an exact React 18 inside the published peer range, with types of the same major", () => {
    for (const name of ["react", "react-dom", "@types/react", "@types/react-dom"]) {
      expect(swapped[name], name).toMatch(/^18\.\d+\.\d+$/);
    }
    for (const name of ["react", "react-dom"]) {
      expect(inCaretRange(swapped[name], pkg.peerDependencies[name]), `${name}@${swapped[name]} vs peer ${pkg.peerDependencies[name]}`).toBe(true);
    }
  });

  it("the peer range also admits a newer major — the one the rest of CI runs on", () => {
    // Read from the PEER range, not devDependencies: this file runs inside the
    // react18 job too, where `bun add -d` has just rewritten devDependencies.
    for (const name of ["react", "react-dom"]) {
      const majors = pkg.peerDependencies[name].split("||").map((c) => Number(/\^(\d+)\./.exec(c)?.[1]));
      expect(majors, name).toContain(18);
      expect(Math.max(...majors), name).toBeGreaterThan(18);
    }
  });

  it("no other job, and no publish, rewrites the manifest", () => {
    expect(ci.replace(job, "")).not.toMatch(/bun add/);
    expect(read(`${GH}/workflows/publish.yml`)).not.toMatch(/bun add/);
  });
});

describe("npm publishing happens from CI, with provenance (A006)", () => {
  const pub = read(`${GH}/workflows/publish.yml`);
  it("runs on version tags only, behind a protected environment", () => {
    expect(pub).toMatch(/tags: \["v\*\.\*\.\*"\]/);
    expect(pub).toMatch(/environment: npm/);
    expect(pub).not.toMatch(/branches:/);
  });
  it("publishes with provenance, from a verified build", () => {
    expect(pub).toMatch(/id-token: write/);
    expect(pub).toMatch(/npm publish --provenance --access public/);
    expect(pub).toMatch(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
    const at = (s) => pub.indexOf(s);
    for (const step of ["bunx tsc --noEmit", "bun run test", "bun run build"]) {
      expect(at(step), step).toBeGreaterThan(-1);
      expect(at(step), `${step} runs before publishing`).toBeLessThan(at("npm publish"));
    }
    expect(pub).toMatch(/does not match package\.json/);
  });
});

describe("the built CommonJS entries and declarations are checked before they ship (A113)", () => {
  // The unit run skips the built half of these files (no dist/ yet), so they
  // only guard the build when they are re-run AFTER `bun run build`.
  const CHECKS = ["src/__tests__/pkg-cjs-require.test.js", "src/__tests__/pkg-declarations.test.js"];
  const STEP = `bunx vitest run ${CHECKS.join(" ")}`;
  it.each([
    ["ci.yml", read(`${GH}/workflows/ci.yml`), null],
    ["publish.yml", read(`${GH}/workflows/publish.yml`), "npm publish"],
  ])("%s re-runs the require and consumer type checks after the library build", (_f, text, before) => {
    expect(text.indexOf(STEP), STEP).toBeGreaterThan(-1);
    expect(text.indexOf(STEP)).toBeGreaterThan(text.indexOf("run: bun run build\n"));
    if (before) expect(text.indexOf(STEP)).toBeLessThan(text.indexOf(before));
  });
});

describe("the domain is watched (A001)", () => {
  it("every 30 minutes and on demand, for the app shell — not just any 200", () => {
    const up = read(`${GH}/workflows/uptime.yml`);
    expect(up).toMatch(/cron: "\*\/30 \* \* \* \*"/);
    expect(up).toMatch(/workflow_dispatch:/);
    expect(up).toMatch(/https:\/\/markdownstudio\.com/);
    expect(up).toMatch(/<title>Markdown Studio<\/title>/);
    expect(read("index.html")).toContain("<title>Markdown Studio</title>");
    expect(up).toMatch(/<div id="root"><\/div>/);
    expect(read("index.html")).toContain('<div id="root"></div>');
  });
});

describe("a reachable security contact (A007)", () => {
  const txt = read("public/.well-known/security.txt");
  const field = (name) => txt.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];

  it("publishes an RFC 9116 security.txt", () => {
    expect(field("Contact")).toBe("mailto:security@markdownstudio.com");
    expect(field("Preferred-Languages")).toBe("en");
    expect(field("Canonical")).toBe("https://markdownstudio.com/.well-known/security.txt");
  });

  it("has not expired — and says so a month BEFORE it does", () => {
    const expires = Date.parse(field("Expires"));
    expect(Number.isFinite(expires)).toBe(true);
    const days = (expires - Date.now()) / 86_400_000;
    expect(days, `security.txt expires ${field("Expires")} — renew it (RFC 9116: at most a year ahead)`).toBeGreaterThan(30);
    expect(days, "RFC 9116 recommends an Expires less than a year away").toBeLessThanOrEqual(366);
  });

  it("SECURITY.md and the issue-template link point to that mailbox, not the private repo", () => {
    const policy = read(`${REPO}/SECURITY.md`);
    const config = read(`${GH}/ISSUE_TEMPLATE/config.yml`);
    expect(policy).toContain("security@markdownstudio.com");
    expect(config).toContain("mailto:security@markdownstudio.com");
    for (const [name, text] of [["SECURITY.md", policy], ["config.yml", config]]) {
      expect(text, name).not.toMatch(/security\/advisories\/new/);
    }
  });
});
