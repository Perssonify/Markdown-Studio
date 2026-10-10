import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_NAME, APP_DOMAIN, APP_URL } from "../constants.ts";

/**
 * The product name lives in ONE place — and the places that can't read it stay
 * in sync.
 *
 * A rename touches surfaces that are not TypeScript and therefore cannot import
 * `APP_NAME`: the two HTML entry points, the static web manifest, and the PWA
 * manifest inside the Vite config. Those are exactly the surfaces nobody looks
 * at during a rename, so the app ends up called one thing in the tab, another
 * on the home screen, and a third in the menu. These assertions fail the build
 * instead.
 *
 * They also guard the other half of a rename: the identifiers that must NOT
 * change with it. `pf:` localStorage keys, the `perssonify-document` export
 * envelope, the `perssonify-backup` archive name and the `perssonify-snapshots`
 * database are on-disk contracts with every existing install — renaming them
 * silently orphans people's documents.
 */

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("product name is single-sourced", () => {
  it("is the current name", () => {
    expect(APP_NAME).toBe("Markdown Studio");
    expect(APP_DOMAIN).toBe("markdownstudio.com");
    expect(APP_URL).toBe(`https://${APP_DOMAIN}`);
  });

  it.each([
    ["index.html", "index.html"],
    ["embed.html", "embed.html"],
    ["public/site.webmanifest", "public/site.webmanifest"],
    ["the PWA manifest", "vite.app.config.ts"],
  ])("%s uses the same name", (_label, file) => {
    expect(read(file)).toContain(APP_NAME);
  });

  it("names the app in the installed-app manifest, both long and short", () => {
    const m = JSON.parse(read("public/site.webmanifest"));
    expect(m.name).toBe(APP_NAME);
    expect(m.short_name).toBe(APP_NAME);
    expect(m.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sizes: "192x192",
          purpose: expect.stringContaining("any"),
        }),
      ]),
    );
    expect(read("vite.app.config.ts")).toContain("purpose: 'any maskable'");
  });

  it("leaves no earlier product name anywhere in src/ or the entry points", () => {
    // Ripgrep-free: check the surfaces a rename actually touches.
    const files = [
      "index.html",
      "embed.html",
      "public/site.webmanifest",
      "vite.app.config.ts",
      "src/constants.ts",
      "src/App.tsx",
      "src/EditorHeader.tsx",
      "src/ui/pages/help-content.ts",
      "src/ui/pages/AboutPage.tsx",
      "src/data/starter-documents.ts",
    ];
    for (const f of files) {
      const body = read(f);
      expect(body, `${f} still says "Markdown Editor"`).not.toMatch(/Markdown Editor/);
      expect(body, `${f} still says "Perssonify Editor"`).not.toMatch(/Perssonify Editor/);
    }
  });

  it("configures the import relay for the Markdown Studio web origins", () => {
    const relay = read("api/import.js");
    expect(relay).toContain("markdownstudio\\.com");
    expect(relay).toContain("markdown-studio");
    expect(relay).not.toContain("markdown-editor-v3");
  });
});

describe("data identifiers survive the rename", () => {
  it("keeps the pf: preference namespace", () => {
    expect(read("src/store/preferences/uiStore.ts")).toContain('"pf:');
  });

  it("keeps the export envelope, on both the write and the read side", () => {
    expect(read("src/store/importExport/import-export.ts")).toContain('_format: "perssonify-document"');
    expect(read("src/store/importExport/ingest.ts")).toContain("perssonify-document");
  });

  it("keeps the full-backup archive name", () => {
    // Written by the editor's export module (exportFullBackup).
    expect(read("src/editor/useExportActions.ts")).toContain('"perssonify-backup"');
  });

  it("keeps the snapshot database name", () => {
    expect(read("src/store/history/snapshot-store.ts")).toContain("perssonify-snapshots");
  });

  it("keeps the published package name", () => {
    // The npm identifier is a coordinate, not a display name; renaming it would
    // break every existing import for no user-visible gain.
    expect(JSON.parse(read("package.json")).name).toBe("@perssonify/editor");
  });
});
