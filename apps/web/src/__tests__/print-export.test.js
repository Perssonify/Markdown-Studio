import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printHtmlDocument } from "../store/importExport/print-export";

/**
 * "Print / Save as PDF". Untested, and it does two things worth holding: it
 * writes a document TITLE into HTML (an injection surface — the title comes from
 * the user's own first heading, but so does anything they paste in from
 * elsewhere), and it must clean up the hidden iframe it appends to the page. An
 * iframe leaked per print is a leak in the one feature people use repeatedly on
 * a long document.
 */

const iframes = () => [...document.querySelectorAll("iframe")];

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of iframes()) f.remove();
});
afterEach(() => {
  vi.useRealTimers();
  for (const f of iframes()) f.remove();
});

describe("printHtmlDocument", () => {
  it("appends one hidden, aria-hidden iframe", () => {
    printHtmlDocument("Doc", "<p>body</p>");
    expect(iframes()).toHaveLength(1);
    const f = iframes()[0];
    expect(f.getAttribute("aria-hidden")).toBe("true");
    expect(f.style.visibility).toBe("hidden");
  });

  it("writes the body HTML through unchanged", () => {
    printHtmlDocument("Doc", "<h1>Heading</h1><p>Some <em>body</em>.</p>");
    const doc = iframes()[0].contentDocument;
    expect(doc.body.innerHTML).toContain("<h1>Heading</h1>");
    expect(doc.body.innerHTML).toContain("<em>body</em>");
  });

  it("escapes the title instead of interpolating it as markup", () => {
    printHtmlDocument('</title><script>window.__pwned = 1</script>', "<p>body</p>");
    const doc = iframes()[0].contentDocument;
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.title).toContain("<script>");
    expect(iframes()[0].contentWindow.__pwned).toBeUndefined();
  });

  it("escapes ampersands and angle brackets in an ordinary title", () => {
    printHtmlDocument("R&D <notes>", "<p>body</p>");
    expect(iframes()[0].contentDocument.title).toBe("R&D <notes>");
  });

  it("carries the export stylesheet and the page rules", () => {
    printHtmlDocument("Doc", "<p>body</p>");
    const css = iframes()[0].contentDocument.querySelector("style").textContent;
    expect(css).toContain("@page");
    expect(css).toContain("page-break-inside: avoid");
  });

  it("calls print on the iframe's own window, after a layout pass", () => {
    printHtmlDocument("Doc", "<p>body</p>");
    const win = iframes()[0].contentWindow;
    const print = vi.fn();
    win.print = print;
    expect(print).not.toHaveBeenCalled(); // not synchronously
    vi.advanceTimersByTime(300);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("removes the iframe once printing finishes", () => {
    printHtmlDocument("Doc", "<p>body</p>");
    const win = iframes()[0].contentWindow;
    win.print = () => {};
    vi.advanceTimersByTime(300);
    win.dispatchEvent(new Event("afterprint"));
    expect(iframes()).toHaveLength(1); // removal is delayed so the job can spool
    vi.advanceTimersByTime(1000);
    expect(iframes()).toHaveLength(0);
  });

  it("removes the iframe even if afterprint never fires", () => {
    // Some browsers never fire it; without the fallback every print leaks a
    // document-sized iframe for the rest of the session.
    printHtmlDocument("Doc", "<p>body</p>");
    iframes()[0].contentWindow.print = () => {};
    vi.advanceTimersByTime(300 + 60000 + 1000);
    expect(iframes()).toHaveLength(0);
  });

  it("two prints in flight each clean up their own iframe", () => {
    // Every call closes over its own iframe and its own cleanup, so finishing
    // the first must not take the second's document out from under it.
    printHtmlDocument("First", "<p>one</p>");
    printHtmlDocument("Second", "<p>two</p>");
    expect(iframes()).toHaveLength(2);
    const [a, b] = iframes();
    a.contentWindow.print = () => {};
    b.contentWindow.print = () => {};
    vi.advanceTimersByTime(300);

    a.contentWindow.dispatchEvent(new Event("afterprint"));
    vi.advanceTimersByTime(1000);
    expect(iframes()).toEqual([b]);

    b.contentWindow.dispatchEvent(new Event("afterprint"));
    vi.advanceTimersByTime(1000);
    expect(iframes()).toHaveLength(0);
  });

  // NOTE: the `done` flag makes cleanup idempotent, which only saves a redundant
  // removal timer — removing an already-removed iframe is a no-op — so nothing
  // here can hold it. It is hygiene, not tested behaviour.

  it("does not throw when the browser refuses to print", () => {
    printHtmlDocument("Doc", "<p>body</p>");
    iframes()[0].contentWindow.print = () => { throw new Error("blocked"); };
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
    vi.advanceTimersByTime(61000);
    expect(iframes()).toHaveLength(0);
  });
});
