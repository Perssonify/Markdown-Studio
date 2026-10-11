import { describe, it, expect } from "vitest";
import { ingest, sanitizeForIngest } from "../store/importExport/ingest.ts";

describe("sanitizeForIngest — XSS hardening", () => {
  it("removes <script> and its body (not dumped as text)", () => {
    const out = sanitizeForIngest('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toMatch(/alert\(1\)/);
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("hi");
  });

  it("removes <style>, <svg>, <math>, <template>, <noscript> entirely", () => {
    for (const [tag, payload] of [
      ["style", "<style>body{background:url(x)}</style>"],
      ["svg", "<svg onload=alert(1)><script>alert(2)</script></svg>"],
      ["math", "<math><mtext>x</mtext></math>"],
      ["template", "<template><img src=x onerror=alert(1)></template>"],
      ["noscript", "<noscript><p>x</p></noscript>"],
    ]) {
      const out = sanitizeForIngest(`<p>ok</p>${payload}`);
      expect(out, tag).not.toMatch(new RegExp(`<${tag}`, "i"));
      expect(out, tag).not.toMatch(/alert\(/);
      expect(out).toContain("ok");
    }
  });

  it("strips event-handler attributes and javascript: URLs", () => {
    const out = sanitizeForIngest('<a href="javascript:alert(1)" onclick="alert(2)">x</a><img src=y onerror="alert(3)">');
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("drops iframe/object/form but keeps benign markup", () => {
    const out = sanitizeForIngest('<p><strong>keep</strong></p><iframe src="//evil"></iframe><form><input></form>');
    expect(out).not.toMatch(/<iframe|<form|<input/i);
    expect(out).toContain("keep");
    expect(out).toContain("<strong>");
  });
});

describe("pmjson full-backup envelope round-trips document state", () => {
  it("forwards tags, metadata, timestamps, id, and title from the envelope", () => {
    const envelope = JSON.stringify({
      _format: "perssonify-document",
      _version: "1.1.0",
      id: "doc-abc",
      title: "My Backup Doc",
      canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
      metadata: { author: "stefan", pinned: true },
      tags: ["work", "important"],
      created: "2024-01-02T03:04:05.000Z",
      updated: "2025-06-07T08:09:10.000Z",
    });
    const { doc } = ingest(envelope, "pmjson", "file-import");
    expect(doc.id).toBe("doc-abc");
    expect(doc.title).toBe("My Backup Doc");
    expect(doc.userTitle).toBe("My Backup Doc");
    expect(doc.tags).toEqual(["work", "important"]);
    expect(doc.metadata).toEqual({ author: "stefan", pinned: true });
    expect(doc.created).toBe("2024-01-02T03:04:05.000Z");
    expect(doc.updated).toBe("2025-06-07T08:09:10.000Z");
  });

  it("still accepts a raw ProseMirror doc (no envelope) with sensible defaults", () => {
    const raw = JSON.stringify({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }] });
    const { doc } = ingest(raw, "pmjson", "file-import");
    expect(doc.title).toBe("Title");
    expect(doc.tags).toEqual([]);
  });
});

describe("sanitizeForIngest: containers vs controls", () => {
  it("unwraps a <form> and KEEPS its structure, headings and images", () => {
    const html = `
      <form action="/x">
        <h1>Report</h1>
        <p>Body text</p>
        <ul><li>one</li><li>two</li></ul>
        <img src="data:image/png;base64,iVBORw0KGgo=" alt="chart">
      </form>`;
    const out = sanitizeForIngest(html);
    expect(out).not.toMatch(/<form/i);
    expect(out).toMatch(/<h1>Report<\/h1>/);
    expect(out).toMatch(/<li>one<\/li>/);
    expect(out).toMatch(/<img/);
  });

  it("still strips script bodies entirely", () => {
    const out = sanitizeForIngest("<div>keep<script>alert(1)</script></div>");
    expect(out).toMatch(/keep/);
    expect(out).not.toMatch(/alert\(1\)/);
    expect(out).not.toMatch(/<script/i);
  });

  it("collapses genuine form controls to their visible text", () => {
    const out = sanitizeForIngest("<p>a</p><textarea>typed value</textarea><select><option>x</option></select>");
    expect(out).not.toMatch(/<textarea|<select/i);
    expect(out).toMatch(/typed value/);
  });
});
