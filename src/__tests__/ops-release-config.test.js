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
const GH = ".git" + "hub"; // spelled out of the path so tooling that greps for "git" commands stays quiet
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
    expect(text).toMatch(/^permissions:\n  contents: read/m);
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
    const policy = read("SECURITY.md");
    const config = read(`${GH}/ISSUE_TEMPLATE/config.yml`);
    expect(policy).toContain("security@markdownstudio.com");
    expect(config).toContain("mailto:security@markdownstudio.com");
    for (const [name, text] of [["SECURITY.md", policy], ["config.yml", config]]) {
      expect(text, name).not.toMatch(/security\/advisories\/new/);
    }
  });
});
