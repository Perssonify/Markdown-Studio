import { gzipSync, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { isDangerousUrl } from "../utils/url-safety.ts";
import { sanitizeCanonicalNode } from "../store/documents/canonical-sanitize.ts";
import { extractArchive } from "../store/importExport/archive.ts";

function fileFromBytes(bytes, name) {
  return new File([bytes], name);
}

describe("url-safety: data: URIs", () => {
  it("blocks script-capable data:image/svg+xml", () => {
    expect(isDangerousUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe(true);
    expect(isDangerousUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(true);
  });
  it("allows raster image data URIs", () => {
    expect(isDangerousUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
    expect(isDangerousUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe(false);
    expect(isDangerousUrl("data:image/webp;base64,UklGRg==")).toBe(false);
  });
  it("blocks non-image and script schemes", () => {
    expect(isDangerousUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(true);
    expect(isDangerousUrl("javascript:alert(1)")).toBe(true);
    expect(isDangerousUrl("vbscript:msgbox(1)")).toBe(true);
  });
});

describe("canonical-sanitize: link marks", () => {
  it("strips a javascript: href carried on a link mark (not just node attrs)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    const clean = sanitizeCanonicalNode(doc);
    const mark = clean.content[0].content[0].marks[0];
    expect(mark.attrs.href).toBeUndefined();
  });
  it("keeps a safe href on a link mark", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ok",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    const clean = sanitizeCanonicalNode(doc);
    expect(clean.content[0].content[0].marks[0].attrs.href).toBe("https://example.com");
  });
});

describe("archive: decompression-bomb bounds", () => {
  it("rejects a zip entry whose uncompressed size exceeds the per-entry cap before inflating fully", async () => {
    const big = "a".repeat(200_000);
    const zip = zipSync({ "big.md": strToU8(big) });
    await expect(
      extractArchive(fileFromBytes(zip, "x.zip"), { maxEntryBytes: 1000 })
    ).rejects.toThrow(/too large/i);
  });

  it("rejects a gzip whose decompressed output exceeds the total cap", async () => {
    const big = "b".repeat(500_000);
    const gz = gzipSync(strToU8(big));
    await expect(
      extractArchive(fileFromBytes(gz, "x.gz"), { maxTotalBytes: 1000 })
    ).rejects.toThrow(/too large/i);
  });

  it("still extracts a normal small zip of text documents", async () => {
    const zip = zipSync({ "notes/a.md": strToU8("# Hello"), "notes/b.txt": strToU8("world") });
    const entries = await extractArchive(fileFromBytes(zip, "ok.zip"));
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(["notes/a.md", "notes/b.txt"]);
  });
});
