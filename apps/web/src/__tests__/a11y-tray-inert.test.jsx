import { act, fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { BottomTray } from "../ui/chrome/bottomTray";

/**
 * A093. The collapsed tray stays MOUNTED (it animates grid-template-rows to
 * 0fr), and it was only `aria-hidden` — which hides it from assistive tech but
 * leaves its four buttons in the Tab order (axe `aria-hidden-focus` on every
 * surface). A keyboard user tabbed into controls nobody could see.
 */

const tabs = [
  { id: "links", label: "Document Links", content: <p>links body</p> },
  { id: "console", label: "Console", content: <p>console body</p> },
];

function mount(props = {}) {
  const onTabChange = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <div>
      <button id="opener">Panel</button>
      <BottomTray open={false} activeTab="links" onTabChange={onTabChange} onClose={onClose} tabs={tabs} {...props} />
    </div>
  );
  const tray = utils.container.querySelector("[data-print-hide]");
  return { ...utils, tray, onTabChange, onClose };
}

describe("the collapsed tray is inert", () => {
  it("is inert while collapsed and not once opened", () => {
    const { tray, rerender } = mount();
    expect(tray.hasAttribute("inert")).toBe(true);
    rerender(
      <div>
        <button id="opener">Panel</button>
        <BottomTray open activeTab="links" onTabChange={() => {}} onClose={() => {}} tabs={tabs} />
      </div>
    );
    expect(tray.hasAttribute("inert")).toBe(false);
  });

  it("hands focus back to what opened it when it collapses around focus", () => {
    const { container, rerender } = mount();
    const opener = container.querySelector("#opener");
    act(() => opener.focus());
    const view = (open) => (
      <div>
        <button id="opener">Panel</button>
        <BottomTray open={open} activeTab="links" onTabChange={() => {}} onClose={() => {}} tabs={tabs} />
      </div>
    );
    rerender(view(true));
    const collapse = container.querySelector('button[aria-label="Collapse tray"]');
    act(() => collapse.focus());
    expect(document.activeElement).toBe(collapse);
    rerender(view(false));
    // Without the hand-back, inert strands focus on <body>.
    expect(document.activeElement).toBe(opener);
  });
});

describe("the tray's tabs are a real tablist", () => {
  it("uses tab roles tied to one tabpanel", () => {
    const { container } = mount({ open: true });
    const list = container.querySelector('[role="tablist"]');
    const [a, b] = list.querySelectorAll('[role="tab"]');
    expect(a.getAttribute("aria-selected")).toBe("true");
    expect(b.getAttribute("aria-selected")).toBe("false");
    const panel = container.querySelector('[role="tabpanel"]');
    expect(a.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(a.id);
  });

  it("is one tab stop, and the arrows move AND activate", () => {
    const { container, onTabChange } = mount({ open: true });
    const [a, b] = container.querySelectorAll('[role="tab"]');
    expect(a.tabIndex).toBe(0);
    expect(b.tabIndex).toBe(-1);
    act(() => a.focus());
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(document.activeElement).toBe(b);
    expect(onTabChange).toHaveBeenCalledWith("console");
  });
});
