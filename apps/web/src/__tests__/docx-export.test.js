import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportAsDocx } from "../store/importExport/docx-export";

// jsdom doesn't implement URL.createObjectURL / anchor downloads; stub them and
// capture the Blob that downloadBlob would hand to the browser.
let created;
beforeEach(() => {
  created = [];
  globalThis.URL.createObjectURL = vi.fn((blob) => {
    created.push(blob);
    return "blob:mock";
  });
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportAsDocx", () => {
  const sample = [
    "# Title",
    "",
    "A paragraph with **bold**, *italic*, ~~strike~~, `code`, and a [link](https://example.com).",
    "",
    "- one",
    "- two",
    "  - nested",
    "",
    "1. first",
    "2. second",
    "",
    "> a quote",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "---",
  ].join("\n");

  it("produces a non-empty .docx blob and returns a sanitized filename", async () => {
    const filename = await exportAsDocx("My Report", sample);
    expect(filename).toBe("my-report.docx");
    expect(created.length).toBe(1);
    expect(created[0].size).toBeGreaterThan(0);
  });

  it("handles empty markdown without throwing", async () => {
    const filename = await exportAsDocx("Empty", "");
    expect(filename).toBe("empty.docx");
    expect(created[0].size).toBeGreaterThan(0);
  });

  it("falls back to 'untitled' for a blank title", async () => {
    const filename = await exportAsDocx("", "# hi");
    expect(filename).toBe("untitled.docx");
  });
});
