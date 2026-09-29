import { describe, expect, it } from "vitest";
import { convertDocxToHtml } from "../store/docx-import.ts";

// Build a minimal real .docx in-memory with the `docx` lib, then convert it back
// via mammoth. Exercises the actual mammoth conversion (not a mock) and confirms
// the lazy import resolves in the test/browser-like environment.
async function makeDocx() {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Report Title", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [new TextRun("Plain and "), new TextRun({ text: "bold", bold: true })],
          }),
          new Paragraph({ text: "First bullet", bullet: { level: 0 } }),
          new Paragraph({ text: "Second bullet", bullet: { level: 0 } }),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}

describe("DOCX import", () => {
  it("converts a .docx blob to HTML (headings, bold, lists)", async () => {
    const blob = await makeDocx();
    const { html, messages } = await convertDocxToHtml(blob);
    expect(typeof html).toBe("string");
    expect(html).toMatch(/<h1[^>]*>Report Title<\/h1>/);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("First bullet");
    expect(html).toContain("Second bullet");
    expect(html).toContain("<li>");
    expect(Array.isArray(messages)).toBe(true);
  });

  it("rejects a non-docx blob with a recognisable error", async () => {
    // `rejects.toBeDefined()` passed for ANY thrown value, including an
    // unrelated TypeError introduced by a refactor.
    const junk = new Blob([new Uint8Array([1, 2, 3, 4])]);
    await expect(convertDocxToHtml(junk)).rejects.toThrow(/zip|docx|end of central|corrupt|invalid/i);
  });
});
