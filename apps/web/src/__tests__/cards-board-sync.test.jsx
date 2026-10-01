import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardSyncSignature, planCardReload } from "../store/cards";
import { CardsView } from "../ui/CardsView";
import { GraphView } from "../ui/GraphView";

/**
 * A087 — the board re-read EVERY document on any change and blanked to
 *        skeletons while it did (scroll position lost).
 * A056 — pin and colour did not update the board until it was reopened: the
 *        reload key was `id:updated`, and those patches keep `updated`.
 * A057 — Escape in a dialog over the board (a card's delete confirmation), or
 *        in a control beside it, closed the whole board; Escape in the
 *        composer discarded the draft.
 */

const T0 = "2024-01-01T00:00:00.000Z";
const summary = (id, title, updated = T0) => ({ id, title, updated, created: T0 });
const record = (id, title, updated = T0, metadata = {}) => ({
  id, title, updated, created: T0, metadata,
  canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `${title} body` }] }] },
});

let store;
function rig(ids = ["a", "b", "c"]) {
  store = new Map(ids.map((id) => [id, record(id, `Note ${id}`)]));
  const loadDoc = vi.fn(async (id) => (store.has(id) ? { ...store.get(id) } : null));
  const props = {
    docs: ids.map((id) => summary(id, `Note ${id}`)),
    activeDocId: null,
    loadDoc,
    toMarkdown: () => "",
    onCreate: vi.fn(),
    onSaveCard: vi.fn(),
    onPatchMeta: vi.fn(async () => {}),
    onDelete: vi.fn(),
    onOpenInEditor: vi.fn(),
    onClose: vi.fn(),
  };
  return { props, loadDoc };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const board = (container) => container.querySelector(".overflow-y-auto");
const cardTitles = (container) => [...container.querySelectorAll("h3.line-clamp-2")].map((h) => h.textContent);

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the board updates in place (A087)", () => {
  it("re-reads ONLY the changed card, with no skeleton and the scroll kept", async () => {
    const { props, loadDoc } = rig();
    const view = render(<CardsView {...props} />);
    await settle();
    expect(loadDoc).toHaveBeenCalledTimes(3);
    const el = board(view.container);
    el.scrollTop = 480;

    store.set("b", record("b", "Note b edited", "2024-06-01T00:00:00.000Z"));
    view.rerender(<CardsView {...props} docs={[summary("a", "Note a"), summary("b", "Note b edited", "2024-06-01T00:00:00.000Z"), summary("c", "Note c")]} />);
    // While it loads, the board is NOT replaced by skeletons.
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    await settle();

    expect(loadDoc).toHaveBeenCalledTimes(4);
    expect(loadDoc).toHaveBeenLastCalledWith("b");
    expect(cardTitles(view.container)).toContain("Note b edited");
    expect(board(view.container)).toBe(el);
    expect(el.scrollTop).toBe(480);
  });

  it("reads only a NEW card, and drops a removed one without reading anything", async () => {
    const { props, loadDoc } = rig();
    const view = render(<CardsView {...props} />);
    await settle();
    store.set("d", record("d", "Note d"));
    view.rerender(<CardsView {...props} docs={[...props.docs, summary("d", "Note d")]} />);
    await settle();
    expect(loadDoc.mock.calls.map((c) => c[0]).slice(3)).toEqual(["d"]);

    view.rerender(<CardsView {...props} docs={props.docs.filter((d) => d.id !== "a")} />);
    await settle();
    expect(loadDoc).toHaveBeenCalledTimes(4);
    expect(cardTitles(view.container)).not.toContain("Note a");
  });

  it("builds a big library's cards progressively as the board scrolls", async () => {
    const observers = [];
    const RealIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() { this.dead = true; }
    };
    try {
      const ids = Array.from({ length: 130 }, (_, i) => `n${String(i).padStart(3, "0")}`);
      const { props } = rig(ids);
      const view = render(<CardsView {...props} />);
      // 130 cards load in chunks with a macrotask yield between them.
      for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
      expect(cardTitles(view.container)).toHaveLength(60);
      const live = () => observers.filter((o) => !o.dead).at(-1);
      await act(async () => { live().cb([{ isIntersecting: true }]); });
      expect(cardTitles(view.container)).toHaveLength(120);
      await act(async () => { live().cb([{ isIntersecting: true }]); });
      expect(cardTitles(view.container)).toHaveLength(130); // every card reachable
    } finally {
      globalThis.IntersectionObserver = RealIO;
    }
  });

  it("shows skeletons on the FIRST load only", async () => {
    const { props } = rig();
    const view = render(<CardsView {...props} />);
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await settle();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe("pin and colour show at once (A056)", () => {
  it("the signature changes with pin/colour, not just with `updated`", () => {
    const base = { id: "a", updated: T0 };
    expect(cardSyncSignature({ ...base, metadata: { cardPinned: true } })).not.toBe(cardSyncSignature(base));
    expect(cardSyncSignature({ ...base, metadata: { cardColor: "red" } })).not.toBe(cardSyncSignature(base));
    const loaded = new Map([["a", cardSyncSignature(base)]]);
    expect(planCardReload([{ ...base, metadata: { cardPinned: true } }], loaded)).toEqual({ load: ["a"], drop: [] });
  });

  it("pinning moves the card to Pinned immediately", async () => {
    const { props } = rig();
    const view = render(<CardsView {...props} />);
    await settle();
    expect(screen.queryByText("Pinned")).toBeNull();
    const pins = view.container.querySelectorAll('button[aria-label="Pin note to top"]');
    await act(async () => { fireEvent.click(pins[1]); });
    expect(props.onPatchMeta).toHaveBeenCalledWith(expect.any(String), { cardPinned: true });
    expect(screen.getByText("Pinned")).toBeTruthy();
  });

  it("a colour applies immediately", async () => {
    const { props } = rig(["a"]);
    const view = render(<CardsView {...props} />);
    await settle();
    await act(async () => { fireEvent.click(view.container.querySelector('button[aria-label="Change note colour"]')); });
    await act(async () => { fireEvent.click(view.container.querySelector('button[aria-label="Coral"]')); });
    expect(props.onPatchMeta).toHaveBeenCalledWith("a", { cardColor: "red" });
    const card = view.container.querySelector("h3.line-clamp-2").closest("div.group");
    expect(card.style.backgroundColor).not.toBe("");
  });

  it("a failed write puts the card back to what is stored", async () => {
    const { props, loadDoc } = rig(["a"]);
    props.onPatchMeta = vi.fn(async () => { throw new Error("quota"); });
    const view = render(<CardsView {...props} />);
    await settle();
    await act(async () => { fireEvent.click(view.container.querySelector('button[aria-label="Pin note to top"]')); });
    await settle();
    expect(loadDoc).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Pinned")).toBeNull();
  });
});

describe("Escape belongs to what it was pressed in (A057)", () => {
  function inOverlay(ui) {
    // PerssonifyEditor's overlay shell: the board is inside it, focus starts on it.
    const shell = document.createElement("div");
    shell.setAttribute("data-workspace-overlay", "cards");
    shell.tabIndex = -1;
    document.body.appendChild(shell);
    const view = render(ui, { container: shell });
    return { view, shell };
  }
  const escape = (target) => {
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  afterEach(() => { for (const el of [...document.body.children]) el.remove(); });

  it("Escape in a control OUTSIDE the board (a library rename box) leaves the board open", async () => {
    const { props } = rig();
    inOverlay(<CardsView {...props} />);
    await settle();
    const rename = document.createElement("input");
    document.body.appendChild(rename);
    rename.focus();
    escape(rename);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("Escape on a confirmation dialog over the board closes the dialog, not the board", async () => {
    const { props } = rig();
    inOverlay(<CardsView {...props} />);
    await settle();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    const cancel = document.createElement("button");
    dialog.appendChild(cancel);
    document.body.appendChild(dialog);
    cancel.focus();
    escape(cancel);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("an open modal dialog outside keeps Escape even when focus is still on the board", async () => {
    const { props } = rig();
    const { shell } = inOverlay(<CardsView {...props} />);
    await settle();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    shell.focus();
    escape(shell);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("a popup that is mounted but HIDDEN does not hold Escape (the emoji suggestion list)", async () => {
    // Found in a real browser: the editor's emoji suggestion box is a
    // role="listbox" parked on <body> with display:none; counted as an open
    // popup, it made the board ignore every Escape.
    const { props } = rig();
    const { shell } = inOverlay(<CardsView {...props} />);
    await settle();
    const box = document.createElement("div");
    box.setAttribute("role", "listbox");
    box.style.display = "none";
    document.body.appendChild(box);
    shell.focus();
    escape(shell);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape inside the board (or on its shell, or with nothing focused) closes it", async () => {
    const { props } = rig();
    const { shell } = inOverlay(<CardsView {...props} />);
    await settle();
    shell.focus();
    escape(shell);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    document.activeElement?.blur?.();
    escape(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("does nothing when something inside already handled Escape", async () => {
    const { props } = rig();
    const { shell } = inOverlay(<CardsView {...props} />);
    await settle();
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    e.preventDefault();
    shell.dispatchEvent(e);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("Escape in the composer keeps the draft — across closing the board, too", async () => {
    const { props } = rig();
    const { view } = inOverlay(<CardsView {...props} />);
    await settle();
    await act(async () => { fireEvent.click(screen.getByText("Take a note…")); });
    const body = screen.getByLabelText("Note body");
    await act(async () => { fireEvent.change(body, { target: { value: "milk and eggs" } }); });
    await act(async () => { escape(body); });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Note body")).toBeNull(); // collapsed…
    expect(screen.getByText("milk and eggs")).toBeTruthy();  // …and the draft is shown, not lost

    view.unmount(); // the board closes…
    inOverlay(<CardsView {...props} />); // …and opens again later
    await settle();
    await act(async () => { fireEvent.click(screen.getByLabelText("Continue your draft note")); });
    expect(screen.getByLabelText("Note body").value).toBe("milk and eggs");
  });

  it("Cancel is the one thing that discards a draft", async () => {
    const { props } = rig();
    inOverlay(<CardsView {...props} />);
    await settle();
    await act(async () => { fireEvent.click(screen.getByText("Take a note…")); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "scratch" } }); });
    await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
    expect(screen.getByText("Take a note…")).toBeTruthy();
    expect(localStorage.getItem("pf:card-draft")).toBeNull();
  });
});

describe("the editor shell no longer force-closes overlays (A057)", () => {
  it("has no capture-phase Escape listener in the overlay effect", () => {
    // Source pin — PerssonifyEditor cannot be mounted here. That listener ran
    // before every other handler on the page and closed the overlay whenever
    // focus was OUTSIDE it: exactly where dialogs, menus and the library live.
    // The effect is useOverlayInert (src/editor/useWorkspaceViews.ts); the
    // editor runs it for the overlay shell.
    const codeOnly = (p) => readFileSync(join(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const views = codeOnly("src/editor/useWorkspaceViews.ts");
    const start = views.indexOf("export function useOverlayInert");
    const effect = views.slice(start, views.indexOf("}, [anyOverlayOpen]);", start));
    expect(start).toBeGreaterThan(-1);
    expect(effect.length).toBeGreaterThan(100);
    expect(effect).not.toMatch(/addEventListener\(\s*"keydown"/);
    expect(effect).toContain('setAttribute("inert", "")'); // the rest of the effect stays
    // …and it is the only overlay effect: the editor delegates to it rather
    // than keeping a second one (which could grow the listener back).
    const pe = codeOnly("src/PerssonifyEditor.tsx");
    expect(pe).toContain("useOverlayInert(overlayRef, anyOverlayOpen)");
    expect(pe).not.toMatch(/addEventListener\(\s*"keydown"/);
  });
});

describe("the map's Escape is scoped the same way (A057)", () => {
  const GRAPH = { nodes: [{ id: "a", title: "A" }, { id: "b", title: "B" }], edges: [{ source: "a", target: "b" }] };
  afterEach(() => { for (const el of [...document.body.children]) el.remove(); });

  it("leaves Escape in a rename box beside the map alone, and closes on its own", async () => {
    const shell = document.createElement("div");
    shell.setAttribute("data-workspace-overlay", "map");
    shell.tabIndex = -1;
    document.body.appendChild(shell);
    const onClose = vi.fn();
    render(<GraphView graph={GRAPH} onNavigate={vi.fn()} onClose={onClose} />, { container: shell });
    const rename = document.createElement("input");
    document.body.appendChild(rename);
    rename.focus();
    rename.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();

    shell.focus();
    shell.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
