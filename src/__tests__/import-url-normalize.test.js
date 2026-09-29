import { describe, it, expect } from "vitest";
import { normalizeImportUrl } from "../store/import-url-normalize";
import { buildImportShareLink } from "../store/url-import";

describe("normalizeImportUrl — Google Drive", () => {
  it("rewrites a /file/d/ID/view link to the usercontent download endpoint", () => {
    const r = normalizeImportUrl(
      "https://drive.google.com/file/d/12a4D7oHxJ7bKlkJV6hpQMS5FX8iPXSnD/view?usp=sharing",
    );
    expect(r.provider).toBe("google-drive");
    expect(r.fetchUrl).toBe(
      "https://drive.usercontent.google.com/download?id=12a4D7oHxJ7bKlkJV6hpQMS5FX8iPXSnD&export=download",
    );
  });

  it("handles open?id= and uc?id= shapes", () => {
    for (const u of [
      "https://drive.google.com/open?id=1FIR2bJQmaLmjNvWK_USnSpHT9DFjb3KX",
      "https://drive.google.com/uc?export=download&id=1FIR2bJQmaLmjNvWK_USnSpHT9DFjb3KX",
    ]) {
      const r = normalizeImportUrl(u);
      expect(r.fetchUrl).toContain("drive.usercontent.google.com/download?id=1FIR2bJQmaLmjNvWK_USnSpHT9DFjb3KX");
    }
  });

  it("throws a friendly error for a Drive folder link", () => {
    expect(() =>
      normalizeImportUrl("https://drive.google.com/drive/u/0/folders/19qP1gs4kI_nFjrX_C6oQYtVX0R4DQzBi"),
    ).toThrowError(/folder/i);
  });
});

describe("normalizeImportUrl — other providers", () => {
  it("rewrites a GitHub blob URL to raw.githubusercontent.com", () => {
    const r = normalizeImportUrl("https://github.com/owner/repo/blob/main/docs/readme.md");
    expect(r.provider).toBe("github");
    expect(r.fetchUrl).toBe("https://raw.githubusercontent.com/owner/repo/main/docs/readme.md");
  });

  it("forces Dropbox dl=1", () => {
    const r = normalizeImportUrl("https://www.dropbox.com/s/abc/notes.md?dl=0");
    expect(r.provider).toBe("dropbox");
    expect(r.fetchUrl).toContain("dl=1");
  });

  it("maps a Google Doc to an HTML export (best-effort)", () => {
    const r = normalizeImportUrl("https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0jKLMNOPQRstuv/edit");
    expect(r.provider).toBe("google-docs");
    expect(r.bestEffort).toBe(true);
    expect(r.fetchUrl).toContain("/export?format=html");
  });

  it("passes a plain direct link through unchanged", () => {
    const r = normalizeImportUrl("https://example.com/notes.md");
    expect(r.provider).toBe("generic");
    expect(r.fetchUrl).toBe("https://example.com/notes.md");
  });
});

describe("buildImportShareLink", () => {
  it("appends an encoded import_url query param", () => {
    const link = buildImportShareLink(
      "https://app.example.com/",
      "https://drive.google.com/file/d/ID/view",
    );
    expect(link).toBe(
      "https://app.example.com/?import_url=" +
        encodeURIComponent("https://drive.google.com/file/d/ID/view"),
    );
  });

  it("uses & when the base already has a query string", () => {
    const link = buildImportShareLink("https://app.example.com/?x=1", "https://e.com/a.md");
    expect(link).toContain("&import_url=");
  });
});
