import { describe, it, expect } from "vitest";
import { validateImportUrl, detectUrlFormat, UrlImportError } from "../store/importExport/url-import";

describe("validateImportUrl", () => {
  it("accepts http and https", () => {
    expect(validateImportUrl("https://example.com/a.md").href).toContain("https://");
    expect(validateImportUrl("http://example.com/a.md").href).toContain("http://");
  });

  it("rejects non-http schemes", () => {
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "ftp://x/y"]) {
      expect(() => validateImportUrl(u)).toThrow(UrlImportError);
    }
  });

  it("rejects localhost and internal hosts", () => {
    for (const u of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://foo.local/x",
      "https://api.internal/x",
    ]) {
      expect(() => validateImportUrl(u)).toThrow(UrlImportError);
    }
  });

  it("rejects malformed URLs", () => {
    expect(() => validateImportUrl("not a url")).toThrow(UrlImportError);
  });
});

describe("detectUrlFormat", () => {
  it("uses content-type first", () => {
    expect(detectUrlFormat("text/markdown", "https://x/y", "")).toBe("markdown");
    expect(detectUrlFormat("text/html; charset=utf-8", "https://x/y", "")).toBe("html");
    expect(detectUrlFormat("application/json", "https://x/y", "")).toBe("pmjson");
  });

  it("falls back to URL extension", () => {
    expect(detectUrlFormat(null, "https://x/notes.md", "hello")).toBe("markdown");
    expect(detectUrlFormat(null, "https://x/page.html", "hello")).toBe("html");
    expect(detectUrlFormat("text/plain", "https://x/doc.json", "{}")).toBe("pmjson");
  });

  it("sniffs HTML vs markdown when unknown", () => {
    expect(detectUrlFormat("text/plain", "https://x/raw", "<!DOCTYPE html><html></html>")).toBe("html");
    expect(detectUrlFormat("text/plain", "https://x/raw", "# Heading\n\nText")).toBe("markdown");
  });
});
