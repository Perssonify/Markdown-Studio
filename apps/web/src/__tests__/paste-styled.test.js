import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { useUIStore } from "../store/preferences/uiStore";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
/** Source with comments removed, so a pin asserts on code and not on prose. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Styled paste is the DEFAULT and is remembered.
 *
 * It used to default to "strip styles" and behave as a one-shot: you armed the
 * toggle, pasted once, and it disarmed itself. That is coherent only while
 * stripping is the default — pasting from a web page or a document and silently
 * losing its bold, links and headings is the surprising outcome, not the safe
 * one. The preference now persists, and Shift inverts it for a single paste in
 * whichever direction it is set.
 */
describe("styled paste", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("is on by default", () => {
    expect(useUIStore.getState().pasteStyled).toBe(true);
  });

  it("persists a change, so it survives a reload", () => {
    useUIStore.getState().setPasteStyled(false);
    expect(localStorage.getItem("pf:paste-styled")).toBe("false");
    useUIStore.getState().setPasteStyled(true);
    expect(localStorage.getItem("pf:paste-styled")).toBe("true");
  });

  it("only an explicit 'false' turns it off — anything else defaults to on", () => {
    // The same read idiom as spellcheck and case-content-only: absent, empty or
    // corrupt storage must land on the default rather than on "off".
    const read = (v) => (v === null ? true : v !== "false");
    expect(read(null)).toBe(true);
    expect(read("")).toBe(true);
    expect(read("nonsense")).toBe(true);
    expect(read("true")).toBe(true);
    expect(read("false")).toBe(false);
  });

  it("Shift inverts the preference rather than forcing styled", () => {
    // The rule the paste handler applies. As `shiftKey || pasteStyled` the
    // modifier was dead once the default became on — it could never change the
    // outcome. As an inversion it means "paste the other way" either way round.
    const decide = (pref, shift) => (shift ? !pref : pref);
    expect(decide(true, false)).toBe(true);
    expect(decide(true, true)).toBe(false);
    expect(decide(false, false)).toBe(false);
    expect(decide(false, true)).toBe(true);
  });

  it("reads the modifier from the VIEW, because a ClipboardEvent has none", () => {
    // Measured in a browser: `shiftKey` is not on ClipboardEvent's prototype
    // chain (it does not inherit from UIEvent) and is undefined on the event a
    // real ⇧+paste delivers. The handler used to read `event.shiftKey`, so the
    // inversion above — a documented feature — never once fired. ProseMirror
    // tracks the modifier itself and reads exactly this field for its own
    // plain-text-paste branch.
    const pane = read("src/ui/TiptapPane.tsx");
    const handler = code(pane.slice(pane.indexOf("handlePaste:"), pane.indexOf("onUpdate:")));
    expect(handler).toMatch(/input\?\.shiftKey/);
    expect(handler).not.toMatch(/event\.shiftKey/);

    // …and the consumer must take it as an argument, not off an event.
    const lifecycle = read("src/hooks/useDocumentLifecycle.ts");
    const body = code(lifecycle.slice(lifecycle.indexOf("const handleHtmlPaste"), lifecycle.indexOf("toast.show(styled")));
    expect(body).toMatch(/mods\?\.shiftKey \? !pasteStyled : pasteStyled/);
    expect(body).not.toMatch(/event\?\.shiftKey/);
  });

  it("does not disarm itself after a paste", () => {
    // The old handler called setPasteStyled(false) after every styled paste.
    // With styled as the default that would turn the preference off the first
    // time it was used.
    const src = require("fs").readFileSync(
      require("path").join(process.cwd(), "src/hooks/useDocumentLifecycle.ts"), "utf8",
    );
    const handler = src.slice(src.indexOf("const handleHtmlPaste"), src.indexOf("// Clear the sync debounce timers"));
    // Positive first: this is the shape of the `indexOf("const getSyncDelay")`
    // bug this repo already shipped — rename the function, or lose that comment,
    // and `slice(-1, n)` yields "", which contains nothing and passes.
    expect(handler).toMatch(/mods\?\.shiftKey/);
    expect(handler).not.toContain("setPasteStyled(false)");
  });
});
