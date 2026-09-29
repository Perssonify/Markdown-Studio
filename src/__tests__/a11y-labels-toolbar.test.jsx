import { readFileSync } from "fs";
import { join } from "path";
import { act, fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DialogProvider } from "../ui/DialogProvider";
import { ModeSwitcher, modeAccessibleName } from "../ui/ModeSwitcher";
import { StatusBar } from "../ui/StatusBar";
import { EditorToolbar } from "../ui/Toolbar";

/**
 * A096 (WCAG 2.5.3 label-in-name) and A094 (the toolbar as ONE tab stop).
 *
 * Label in name: a control's accessible name must contain the text it shows,
 * or a speech-input user saying "click MD" / "click Panel" / "click Styled
 * paste" reaches nothing. Several did not.
 */

const dialogApi = { confirm: async () => true, prompt: async () => null, equation: async () => null, confirmUnsaved: async () => "cancel" };
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("label in name", () => {
  it("modeAccessibleName always contains the visible short label", () => {
    expect(modeAccessibleName("MD", "Markdown")).toBe("MD (Markdown)");
    expect(modeAccessibleName("Split", "Split view")).toBe("Split view");
    expect(modeAccessibleName("HTML", "Rich text")).toMatch(/^HTML/);
  });

  it("every mode button's name contains the text it shows", () => {
    const { container } = render(<ModeSwitcher mode="split" setMode={() => {}} />);
    const buttons = container.querySelectorAll('[data-slot="mode-switcher-button"]');
    expect(buttons).toHaveLength(3);
    for (const b of buttons) {
      const shown = b.querySelector("span")?.textContent?.trim();
      expect(shown, "a mode button with no visible label").toBeTruthy();
      expect(b.getAttribute("aria-label").toLowerCase()).toContain(shown.toLowerCase());
    }
  });

  it("the status bar's Panel toggle is named by its label and reports expansion", () => {
    const { container, rerender } = render(<StatusBar onToggleTray={() => {}} trayOpen={false} />);
    const btn = () => container.querySelector('button[aria-label="Panel tray"]');
    expect(btn()).not.toBeNull();
    expect(btn().textContent).toContain("Panel");
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    rerender(<StatusBar onToggleTray={() => {}} trayOpen />);
    expect(btn().getAttribute("aria-expanded")).toBe("true");
  });

  it("the pane switches are named by their visible labels, explained by a description", () => {
    const panes = codeOnly(readFileSync(join(process.cwd(), "src/ui/EditorPanes.tsx"), "utf8"));
    expect(panes).toContain('aria-label="Styled paste" aria-describedby={descId}');
    expect(panes).toContain('aria-label="Styled Markdown" aria-describedby={descId}');
    // The old shape: the whole explanatory sentence AS the name.
    expect(panes).not.toContain("aria-label={explainer}");
    // A toggle button keeps one name; its state is aria-pressed.
    expect(panes).toContain('aria-label="Sync scrolling"');
    expect(panes).not.toContain("aria-roledescription");
  });
});

/** Mount, then flush one microtask: the compact-mode chevrons mount from the
 *  toolbar's own layout effect, and the roving hook's MutationObserver fixes
 *  their tabindex in a microtask (before paint in a browser). */
async function mountToolbar(props = {}) {
  let utils;
  await act(async () => {
    utils = renderToolbar(props);
    await Promise.resolve();
  });
  return utils;
}

function renderToolbar(props) {
  return render(
    <DialogProvider value={dialogApi}>
      <TooltipProvider>
        <EditorToolbar
          toast={{ show: vi.fn() }}
          dispatch={vi.fn()}
          updateFormats={vi.fn()}
          setFocusedPane={vi.fn()}
          toggleFindReplace={vi.fn()}
          saveStatus="editing"
          onSave={vi.fn()}
          mode="split"
          {...props}
        />
      </TooltipProvider>
    </DialogProvider>
  );
}

const stops = (root) =>
  [...root.querySelectorAll("button")].filter((b) => b.tabIndex >= 0 && !b.disabled);

describe("the formatting toolbar is one tab stop (A094)", () => {
  it("is a named role=toolbar", async () => {
    const { container } = await mountToolbar();
    const bar = container.querySelector('[role="toolbar"]');
    expect(bar).not.toBeNull();
    expect(bar.getAttribute("aria-label")).toBe("Formatting");
  });

  /** jsdom has no layout, so the toolbar measures 0px and starts COMPACT; the
   *  chevron mounts the other ~25 controls — the "arrives later" case the
   *  hook's observer exists for. */
  async function expand(container) {
    const chevron = container.querySelector('button[title="Expand Toolbar"]');
    expect(chevron).not.toBeNull();
    await act(async () => { fireEvent.click(chevron); await Promise.resolve(); });
  }

  it("leaves exactly one tabbable control out of dozens — including ones that mount later", async () => {
    const { container } = await mountToolbar();
    const bar = container.querySelector('[role="toolbar"]');
    expect(stops(bar)).toHaveLength(1);
    await expand(container);
    expect(bar.querySelectorAll("button").length).toBeGreaterThan(25);
    expect(stops(bar).map((b) => b.getAttribute("aria-label") || b.title || b.textContent)).toHaveLength(1);
  });

  it("starts on the first control on screen, and reaches Save LAST", async () => {
    // Save floats right, so it is first in the DOM and last visually.
    const { container } = await mountToolbar();
    const bar = container.querySelector('[role="toolbar"]');
    const first = stops(bar)[0];
    expect(first.getAttribute("aria-label")).not.toBe("Save");
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement.getAttribute("aria-label")).toBe("Save");
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first); // wraps
  });

  it("names the block and font pickers after what they show", async () => {
    const { container } = await mountToolbar();
    await expand(container);
    const block = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Paragraph"));
    expect(block.getAttribute("aria-label")).toBe("Block type: Paragraph");
    const font = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("Font:"));
    expect(font.getAttribute("aria-label")).toContain(font.textContent.trim());
  });
});
