import { act, fireEvent, render } from "@testing-library/react";
import React, { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { isRovingCandidate, rovingNextIndex, useRovingFocus } from "../ui/chrome/hooks/use-roving-focus";

/**
 * A094. The formatting toolbar was ~40 tab stops, so the document was a long
 * walk away by keyboard. The toolbar pattern makes the group ONE stop and moves
 * with the arrow keys; these cases drive the shared hook.
 */

describe("rovingNextIndex", () => {
  it("moves and wraps horizontally", () => {
    expect(rovingNextIndex("ArrowRight", 0, 3)).toBe(1);
    expect(rovingNextIndex("ArrowRight", 2, 3)).toBe(0);
    expect(rovingNextIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(rovingNextIndex("Home", 2, 3)).toBe(0);
    expect(rovingNextIndex("End", 0, 3)).toBe(2);
  });

  it("ignores the other axis and non-navigation keys", () => {
    expect(rovingNextIndex("ArrowDown", 0, 3)).toBeNull(); // a menu trigger opens on it
    expect(rovingNextIndex("Enter", 0, 3)).toBeNull();
    expect(rovingNextIndex("ArrowDown", 0, 3, "vertical")).toBe(1);
    expect(rovingNextIndex("ArrowRight", 0, 3, "vertical")).toBeNull();
  });

  it("has nothing to move to in an empty group", () => {
    expect(rovingNextIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("isRovingCandidate", () => {
  it("skips disabled and opted-out controls", () => {
    document.body.innerHTML = `<div><button id="a">a</button><button id="b" disabled>b</button>
      <div data-roving-ignore><button id="c">c</button></div><button id="d" aria-disabled="true">d</button></div>`;
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => document.getElementById(id));
    expect(isRovingCandidate(a)).toBe(true);
    expect(isRovingCandidate(b)).toBe(false);
    expect(isRovingCandidate(c)).toBe(false);
    expect(isRovingCandidate(d)).toBe(false);
    document.body.innerHTML = "";
  });
});

function Bar({ extra = false, orderItems, onNavigate }) {
  const ref = useRef(null);
  useRovingFocus(ref, { orderItems, onNavigate });
  return (
    <div ref={ref} role="toolbar" aria-label="t">
      <button id="save">Save</button>
      <button id="one">One</button>
      <button id="two" disabled>Two</button>
      <button id="three">Three</button>
      {extra && <button id="four">Four</button>}
    </div>
  );
}

/** Buttons Tab can actually land on (a disabled one keeps tabIndex 0 but is
 *  never focusable, so it is not a stop). */
const tabbable = (container) =>
  [...container.querySelectorAll("button")].filter((b) => b.tabIndex === 0 && !b.disabled).map((b) => b.id);

describe("useRovingFocus", () => {
  it("leaves exactly one tab stop in the group", () => {
    const { container } = render(<Bar />);
    expect(tabbable(container)).toEqual(["save"]);
    // The disabled one is not a stop either way, and every other is -1.
    expect(container.querySelector("#one").tabIndex).toBe(-1);
    expect(container.querySelector("#three").tabIndex).toBe(-1);
  });

  it("moves focus with the arrows, skipping disabled controls, and wraps", () => {
    const { container } = render(<Bar />);
    const save = container.querySelector("#save");
    act(() => save.focus());
    fireEvent.keyDown(save, { key: "ArrowRight" });
    expect(document.activeElement.id).toBe("one");
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(document.activeElement.id).toBe("three"); // #two is disabled
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(document.activeElement.id).toBe("save");
    fireEvent.keyDown(document.activeElement, { key: "End" });
    expect(document.activeElement.id).toBe("three");
    // The tab stop follows focus, so Tab leaves from — and returns to — here.
    expect(tabbable(container)).toEqual(["three"]);
  });

  it("marks the arrow key handled so the page does not also scroll", () => {
    const { container } = render(<Bar />);
    const save = container.querySelector("#save");
    act(() => save.focus());
    const ev = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    save.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const other = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it("adopts a clicked (focused) control as the tab stop", () => {
    const { container } = render(<Bar />);
    act(() => container.querySelector("#three").focus());
    expect(tabbable(container)).toEqual(["three"]);
  });

  it("keeps a control that mounts LATER out of the tab order", async () => {
    // The table controls appear when the caret enters a table; without the
    // observer each would arrive as an extra tab stop.
    const { container, rerender } = render(<Bar />);
    rerender(<Bar extra />);
    await act(async () => { await Promise.resolve(); }); // MutationObserver microtask
    expect(container.querySelector("#four").tabIndex).toBe(-1);
    expect(tabbable(container)).toEqual(["save"]);
  });

  it("walks items in the caller's visual order", () => {
    // The toolbar's Save floats right: first in the DOM, last on screen.
    const lastFirst = (items) => [...items.slice(1), items[0]];
    const { container } = render(<Bar orderItems={lastFirst} />);
    expect(tabbable(container)).toEqual(["one"]);
    act(() => container.querySelector("#three").focus());
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(document.activeElement.id).toBe("save");
  });

  it("reports keyboard navigation so a tablist can activate on focus", () => {
    const onNavigate = vi.fn();
    const { container } = render(<Bar onNavigate={onNavigate} />);
    act(() => container.querySelector("#save").focus());
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(container.querySelector("#one"));
  });

  it("leaves text entry inside the group alone", () => {
    function WithInput() {
      const ref = useRef(null);
      useRovingFocus(ref, { itemSelector: "button, input" });
      return <div ref={ref}><button id="b1">b</button><input id="in" /></div>;
    }
    const { container } = render(<WithInput />);
    const input = container.querySelector("#in");
    act(() => input.focus());
    const ev = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});
