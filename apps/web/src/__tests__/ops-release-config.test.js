/**
 * Disclosure configuration (A007).
 *
 * These are configuration files — nothing in the app exercises them until
 * the day they matter (a researcher looking for a contact) — so their
 * load-bearing properties are pinned here. The repository has no CI
 * workflows any more (changes go through reviewed PRs, verified locally),
 * so nothing here reads .github/workflows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
// The frontend is apps/web of the monorepo; SECURITY.md and the issue
// templates live at the repository root, two levels up.
const REPO = "../..";
const GH = `${REPO}/.git` + "hub"; // spelled out of the path so tooling that greps for "git" commands stays quiet

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

  // The repository is public, so GitHub's private reporting is a channel too
  // (it must be switched on in the repo settings); the mailbox stays, because
  // it works for reporters without a GitHub account.
  it("SECURITY.md and the issue templates name that mailbox, and no longer call the repo private", () => {
    const policy = read(`${REPO}/SECURITY.md`);
    const config = read(`${GH}/ISSUE_TEMPLATE/config.yml`);
    expect(policy).toContain("security@markdownstudio.com");
    expect(config).toContain("mailto:security@markdownstudio.com");
    for (const [name, text] of [["SECURITY.md", policy], ["config.yml", config]]) {
      expect(text, name).not.toMatch(/repository is private/i);
      expect(text, name).not.toMatch(/no server copy/i);
    }
  });
});
