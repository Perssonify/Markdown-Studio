import { readFileSync } from "fs";
import { join } from "path";
import { act, render } from "@testing-library/react";
import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorLayout } from "../ui/EditorPanes";
import {
  SPLIT_STACK_MIN_HEIGHT,
  isUprightTouchDevice,
  splitShouldStack,
} from "../ui/split-layout";

/**
 * A100. Split view stacked its panes on EVERY viewport under 768px wide. A
 * landscape phone is narrow and short, so it stacked two panes, each with its
 * own header, into what was left under the chrome: 37–69px of editor apiece.
 */

describe("splitShouldStack", () => {
  it("never stacks at 768px and wider", () => {
    expect(splitShouldStack({ width: 768, height: 1000, uprightTouch: true })).toBe(false);
    expect(splitShouldStack({ width: 1440, height: 900, uprightTouch: false })).toBe(false);
  });

  it("stacks a narrow, TALL viewport — the portrait phone and narrow window", () => {
    expect(splitShouldStack({ width: 375, height: 700, uprightTouch: false })).toBe(true);
    expect(splitShouldStack({ width: 480, height: 800, uprightTouch: false })).toBe(true);
  });

  it("keeps a narrow, SHORT viewport side by side — the landscape phone", () => {
    expect(splitShouldStack({ width: 667, height: 375, uprightTouch: false })).toBe(false);
    expect(splitShouldStack({ width: 740, height: 360, uprightTouch: false })).toBe(false);
    expect(splitShouldStack({ width: 700, height: SPLIT_STACK_MIN_HEIGHT - 1, uprightTouch: false })).toBe(false);
    expect(splitShouldStack({ width: 700, height: SPLIT_STACK_MIN_HEIGHT, uprightTouch: false })).toBe(true);
  });

  it("keeps an UPRIGHT phone stacked while its keyboard shrinks the viewport", () => {
    // interactive-widget=resizes-content: a 390×844 phone typing is ~390×420.
    // Flipping to side-by-side on every keyboard open would re-lay the panes
    // under the user's fingers.
    expect(splitShouldStack({ width: 390, height: 420, uprightTouch: true })).toBe(true);
  });
});

describe("isUprightTouchDevice", () => {
  const fakeWin = ({ coarse, orientation, legacy, screen = {} }) => ({
    matchMedia: (q) => ({ matches: q === "(pointer: coarse)" ? coarse : false }),
    screen: { ...screen, ...(orientation ? { orientation: { type: orientation } } : {}) },
    ...(legacy !== undefined ? { orientation: legacy } : {}),
  });

  it("is false for fine pointers, whatever the screen says", () => {
    expect(isUprightTouchDevice(fakeWin({ coarse: false, orientation: "portrait-primary" }))).toBe(false);
  });

  it("reads the DEVICE orientation on touch", () => {
    expect(isUprightTouchDevice(fakeWin({ coarse: true, orientation: "portrait-primary" }))).toBe(true);
    expect(isUprightTouchDevice(fakeWin({ coarse: true, orientation: "landscape-secondary" }))).toBe(false);
  });

  it("falls back to legacy window.orientation, then the screen's shape", () => {
    expect(isUprightTouchDevice(fakeWin({ coarse: true, legacy: 90 }))).toBe(false);
    expect(isUprightTouchDevice(fakeWin({ coarse: true, legacy: 0 }))).toBe(true);
    expect(isUprightTouchDevice(fakeWin({ coarse: true, screen: { width: 390, height: 844 } }))).toBe(true);
  });
});

describe("EditorLayout follows the rule", () => {
  const original = { w: window.innerWidth, h: window.innerHeight, mm: window.matchMedia };
  afterEach(() => {
    window.innerWidth = original.w;
    window.innerHeight = original.h;
    window.matchMedia = original.mm;
  });

  function mount() {
    const props = {
      mode: "split", cmRef: createRef(), tiptapRef: createRef(), syncMode: "styled",
      onSyncModeChange: () => {}, pasteStyled: true, setPasteStyled: () => {},
    };
    const { container } = render(React.createElement(EditorLayout, props));
    return () => container.querySelector('[role="separator"][aria-label="Resize panes"]').getAttribute("aria-orientation");
  }

  it("sits side by side on a landscape phone and stacks when the window grows tall", () => {
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    window.innerWidth = 667;
    window.innerHeight = 375;
    const orientation = mount();
    expect(orientation()).toBe("vertical"); // side by side
    act(() => {
      window.innerHeight = 800;
      window.dispatchEvent(new Event("resize"));
    });
    expect(orientation()).toBe("horizontal"); // stacked
  });

  it("marks the panes for print: the rich pane prints, the markdown pane does not", () => {
    const props = {
      mode: "md", cmRef: createRef(), tiptapRef: createRef(), syncMode: "styled",
      onSyncModeChange: () => {}, pasteStyled: true, setPasteStyled: () => {},
    };
    const { container } = render(React.createElement(EditorLayout, props));
    expect(container.querySelector('[data-print-pane="md"]')).not.toBeNull();
    // Mounted even in Markdown-only view, which is what lets it print there.
    expect(container.querySelector('[data-print-pane="rich"] .ProseMirror, [data-print-pane="rich"] .tiptap-preview')).not.toBeNull();
  });
});

describe("the print stylesheet prints the document, not the app (A100)", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const print = css.slice(css.indexOf("@media print {"));

  it("hides the chrome", () => {
    expect(print.length).toBeGreaterThan(0);
    for (const sel of ["[data-print-hide]", '[data-tour="menubar"]', "[data-pane-header]", '[data-print-pane="md"]', "[data-workspace-overlay]"]) {
      expect(print.slice(0, print.indexOf("display: none !important"))).toContain(sel);
    }
  });

  it("releases the viewport lock so the text flows across pages", () => {
    expect(print).toMatch(/\.pf-shell,[\s\S]*?overflow: visible !important/);
    expect(print).toContain('[data-print-pane="rich"]');
  });

  it("marks the chrome it hides in the components that render it", () => {
    for (const f of ["src/ui/Toolbar.tsx", "src/ui/StatusBar.tsx", "src/ui/BottomTray.tsx", "src/App.tsx"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toContain("data-print-hide");
    }
  });
});
