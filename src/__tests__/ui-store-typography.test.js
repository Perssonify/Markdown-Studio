import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "../store/uiStore";

// Typography & reading-comfort prefs (v1.35.0). Each setter must update the
// store AND persist to its localStorage key so the pref survives a reload.
describe("uiStore typography prefs", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("setEditorFontSize updates state and persists pf:font-size", () => {
    useUIStore.getState().setEditorFontSize(19);
    expect(useUIStore.getState().editorFontSize).toBe(19);
    expect(localStorage.getItem("pf:font-size")).toBe("19");
  });

  it("setEditorLineHeight updates state and persists pf:line-height", () => {
    useUIStore.getState().setEditorLineHeight(1.8);
    expect(useUIStore.getState().editorLineHeight).toBe(1.8);
    expect(localStorage.getItem("pf:line-height")).toBe("1.8");
  });

  it("setReadingWidth updates state and persists pf:reading-width", () => {
    useUIStore.getState().setReadingWidth(800);
    expect(useUIStore.getState().readingWidth).toBe(800);
    expect(localStorage.getItem("pf:reading-width")).toBe("800");
  });

  it("setSpellcheck updates state and persists pf:spellcheck", () => {
    useUIStore.getState().setSpellcheck(false);
    expect(useUIStore.getState().spellcheck).toBe(false);
    expect(localStorage.getItem("pf:spellcheck")).toBe("false");
  });

  it("setFocusMode updates state and persists pf:focus-mode", () => {
    useUIStore.getState().setFocusMode(true);
    expect(useUIStore.getState().focusMode).toBe(true);
    expect(localStorage.getItem("pf:focus-mode")).toBe("true");
  });
});
