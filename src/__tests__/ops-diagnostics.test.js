/**
 * Privacy-safe diagnostics (A009).
 *
 * Before this there was no error capture at all — no window.onerror, no
 * unhandledrejection, and the error boundary only console.error'd. These cases
 * pin what the ring records, and above all what it must NEVER record: document
 * text that error messages routinely echo back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_RECOVERY_KEY,
  DIAGNOSTICS_KEY,
  _resetCaptureForTests,
  _resetDiagnosticsForTests,
  buildDiagnosticsReport,
  getDiagnostics,
  installGlobalErrorCapture,
  recordDiagnostic,
  redactMessage,
  setErrorReporter,
  summarizeStack,
  uaFamily,
} from "../utils/diagnostics";
import { VERSION } from "../constants";

beforeEach(() => {
  localStorage.clear();
  _resetDiagnosticsForTests();
});
afterEach(() => {
  vi.useRealTimers();
  _resetDiagnosticsForTests();
});

describe("redactMessage — nothing the user typed survives", () => {
  it("keeps only the first line (Mermaid prints the offending source below it)", () => {
    const msg = "Parse error on line 2:\n...Salary review for Dana-->B\n---^\nExpecting 'SEMI'";
    expect(redactMessage(msg)).toBe("Parse error on line 2:");
  });

  it("drops quoted fragments (JSON / KaTeX / generic errors echo input in quotes)", () => {
    const out = redactMessage(`Unexpected token 'M', "My secret diary entry" is not valid JSON`);
    expect(out).not.toMatch(/secret|diary|'M'/);
    expect(out).toMatch(/is not valid JSON/);
  });

  it("drops the formula after KaTeX's 'at position N:'", () => {
    const out = redactMessage("KaTeX parse error: Undefined control sequence: \\salary at position 5: x^2+\\̲s̲a̲l̲a̲r̲y̲");
    expect(out).not.toMatch(/salary|x\^2/);
    expect(out).toMatch(/at position 5: …$/);
  });

  it("reduces URLs to their origin and drops blob/data URLs", () => {
    const out = redactMessage(
      "Failed to fetch https://drive.google.com/file/d/SECRETID/view?usp=sharing and blob:https://x/uuid-1 and data:text/plain,hello",
    );
    expect(out).not.toMatch(/SECRETID|usp=|uuid-1|hello/);
    expect(out).toMatch(/https:\/\/drive\.google\.com\/…/);
  });

  it("masks e-mail addresses and truncates long messages", () => {
    expect(redactMessage("owner is someone@example.com here")).toBe("owner is [email] here");
    expect(redactMessage("x".repeat(500)).length).toBeLessThanOrEqual(200);
  });

  it("keeps the shape of ordinary engine errors", () => {
    expect(redactMessage("Cannot read properties of undefined (reading 'type')")).toBe(
      'Cannot read properties of undefined (reading "…")',
    );
  });
});

describe("stack and browser summaries", () => {
  it("reduces Chromium and Firefox frames to fn@basename:line:col", () => {
    const chrome = [
      "TypeError: boom",
      "    at render (https://markdownstudio.com/assets/index-abc123.js?v=1:1:2345)",
      "    at https://markdownstudio.com/assets/tiptap-x.js:2:10",
    ].join("\n");
    expect(summarizeStack(chrome)).toEqual(["render@index-abc123.js:1:2345", "<anonymous>@tiptap-x.js:2:10"]);
    expect(summarizeStack("onClick@https://markdownstudio.com/assets/a.js:3:4")).toEqual(["onClick@a.js:3:4"]);
    expect(summarizeStack(undefined)).toBeUndefined();
  });

  it("names the browser family and OS, not the full user agent", () => {
    const chromeWin =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Safari/537.36";
    expect(uaFamily(chromeWin)).toBe("Chrome 140 · Windows");
    const safariIos =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";
    expect(uaFamily(safariIos)).toBe("Safari 18 · iOS");
    expect(uaFamily("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox 131 · Linux");
    expect(uaFamily(chromeWin.replace("Safari/537.36", "Safari/537.36 Edg/140.0.1"))).toBe("Edge 140 · Windows");
  });
});

describe("the ring", () => {
  it("records kind, version, class and a redacted message", () => {
    const entry = recordDiagnostic({ kind: "render", error: new TypeError('Bad "Quarterly plan" node') });
    expect(entry).toMatchObject({ kind: "render", v: VERSION, name: "TypeError" });
    expect(entry.message).not.toMatch(/Quarterly/);
    expect(getDiagnostics()).toHaveLength(1);
  });

  it("collapses a repeating error into one entry with a count", () => {
    for (let i = 0; i < 5; i++) recordDiagnostic({ kind: "error", error: new Error("same thing") });
    const all = getDiagnostics();
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(5);
  });

  it("is bounded", () => {
    for (let i = 0; i < 60; i++) recordDiagnostic({ kind: "error", error: new Error(`distinct ${i}`) });
    const all = getDiagnostics();
    expect(all.length).toBeLessThanOrEqual(25);
    expect(all[all.length - 1].message).toBe("distinct 59");
  });

  it("persists (debounced) and survives a reload", () => {
    vi.useFakeTimers();
    recordDiagnostic({ kind: "chunk", error: new TypeError("Failed to fetch dynamically imported module: https://x/a.js") });
    expect(localStorage.getItem(DIAGNOSTICS_KEY)).toBeNull(); // not written synchronously
    vi.advanceTimersByTime(1100);
    expect(JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY))).toHaveLength(1);
    _resetDiagnosticsForTests(); // a fresh page
    expect(getDiagnostics()[0].kind).toBe("chunk");
  });

  it("hands every entry to a subscribed reporter, and a throwing reporter changes nothing", () => {
    const seen = [];
    setErrorReporter((e) => seen.push(e));
    recordDiagnostic({ kind: "save", name: "save-conflict", message: "Changed in another tab" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "save", name: "save-conflict" });
    setErrorReporter(() => {
      throw new Error("host reporter broke");
    });
    expect(() => recordDiagnostic({ kind: "error", error: new Error("x") })).not.toThrow();
  });
});

describe("global capture", () => {
  beforeEach(() => _resetCaptureForTests());

  it("records uncaught errors and unhandled rejections", () => {
    installGlobalErrorCapture(window);
    const err = new RangeError("Maximum call stack size exceeded");
    window.dispatchEvent(new ErrorEvent("error", { error: err, message: err.message, filename: "https://markdownstudio.com/assets/index-abc.js?x=1", lineno: 3, colno: 9 }));
    const rejection = new Event("unhandledrejection");
    rejection.reason = new Error("quota exceeded");
    window.dispatchEvent(rejection);
    const [a, b] = getDiagnostics();
    expect(a).toMatchObject({ kind: "error", name: "RangeError", where: "index-abc.js:3:9" });
    expect(b).toMatchObject({ kind: "unhandledrejection", message: "quota exceeded" });
  });

  it("adopts the boot watchdog's note exactly once", () => {
    localStorage.setItem(BOOT_RECOVERY_KEY, JSON.stringify({ t: 1, reason: "script-error" }));
    installGlobalErrorCapture(window);
    expect(localStorage.getItem(BOOT_RECOVERY_KEY)).toBeNull();
    expect(getDiagnostics().find((e) => e.kind === "boot")).toMatchObject({ name: "BootRecovery", message: "script-error" });
  });
});

describe("the report a user pastes", () => {
  it("carries version, browser and the events — and says it holds no document content", () => {
    recordDiagnostic({ kind: "render", error: new TypeError('Cannot render "Tax return 2026" heading') });
    const text = buildDiagnosticsReport({ "Save status": "editing" });
    expect(text).toContain(`App version: ${VERSION}`);
    expect(text).toContain("Save status: editing");
    expect(text).toContain("[render] TypeError");
    expect(text).not.toContain("Tax return 2026");
    expect(text).toContain("This report contains no document content.");
  });
});
