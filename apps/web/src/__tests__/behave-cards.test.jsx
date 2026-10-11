/**
 * A108 — the Cards board (`ui/cards/cardsView/index.tsx`) as a user drives it: quick
 * capture as text and as a checklist, the draft kept and discarded, search,
 * what a card's face shows, pin and colour, the card editor's Preview · Split ·
 * Write views and when it saves, read-only, the Escape ladder, and the board's
 * columns.
 *
 * cards-board-sync.test.jsx pins the incremental reload and Escape scoping
 * (A087, A056, A057); this file covers the rest.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardsView } from "../ui/cards/cardsView";

const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const text = (t, marks) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const p = (...c) => ({ type: "paragraph", content: c });
const h = (level, t) => ({ type: "heading", attrs: { level }, content: [text(t)] });
const task = (t, checked) => ({ type: "taskItem", attrs: { checked }, content: [p(text(t))] });
const doc = (...blocks) => ({ type: "doc", content: blocks });

function rig(records, extra = {}) {
  const store = new Map(records.map((r) => [r.id, r]));
  const props = {
    docs: records.map(({ id, title, updated, created }) => ({ id, title, updated, created })),
    activeDocId: null,
    loadDoc: vi.fn(async (id) => (store.has(id) ? { metadata: {}, ...store.get(id) } : null)),
    // The host's serializer, reduced to what these cases need.
    toMarkdown: vi.fn((c) => (c?.content ?? []).map((b) => (b.type === "heading" ? "#".repeat(b.attrs.level) + " " : "") + (b.content ?? []).map((x) => x.text ?? "").join("")).join("\n\n")),
    renderMarkdown: vi.fn((md) => md.split("\n\n").map((l) => l.startsWith("# ") ? `<h1>${l.slice(2)}</h1>` : `<p>${l.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')}</p>`).join("")),
    onCreate: vi.fn(async () => {}),
    onSaveCard: vi.fn(async () => {}),
    onPatchMeta: vi.fn(async () => {}),
    onDelete: vi.fn(),
    onOpenInEditor: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  };
  return props;
}
const rec = (id, title, canonical, updated = ago(2 * MIN), metadata = {}) => ({ id, title, canonical, updated, created: ago(DAY), metadata });

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
async function mount(props) {
  // The overlay shell the editor puts the board in (Escape is scoped to it).
  const shell = document.createElement("div");
  shell.setAttribute("data-workspace-overlay", "cards");
  shell.tabIndex = -1;
  document.body.appendChild(shell);
  const view = render(<CardsView {...props} />, { container: shell });
  await settle();
  return { ...view, shell };
}
const titles = () => [...document.querySelectorAll("h3.line-clamp-2")].map((x) => x.textContent);
const cardOf = (title) => screen.getByLabelText(`Edit note: ${title}`).closest("div.group");
const escape = (target = document.body) => act(async () => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
});

let mql;
beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  mql = { matches: false };
  window.matchMedia = (q) => ({ matches: mql.matches, media: q, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  for (const el of [...document.body.children]) el.remove();
});

describe("quick capture", () => {
  it("a titled note is composed as markdown with the title as its heading", async () => {
    const props = rig([]);
    await mount(props);
    expect(screen.getByText("No notes yet")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("Take a note…")); });
    const body = screen.getByLabelText("Note body");
    expect(document.activeElement).toBe(body);
    await act(async () => { fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Groceries" } }); });
    // Enter in the title moves on to the body rather than saving a title-only note.
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Note title"), { key: "Enter" }); });
    expect(document.activeElement).toBe(body);
    await act(async () => { fireEvent.change(body, { target: { value: "milk\n\n\n\neggs" } }); });
    await act(async () => { fireEvent.click(screen.getByText("Add note")); });
    expect(props.onCreate).toHaveBeenCalledWith("# Groceries\n\nmilk\n\neggs");
    // The composer is reset — and so is the stored draft.
    expect(screen.getByText("Take a note…")).toBeTruthy();
    expect(localStorage.getItem("pf:card-draft")).toBeNull();
  });

  it("a checklist note turns each line into an open task; Ctrl+Enter saves", async () => {
    const props = rig([]);
    await mount(props);
    await act(async () => { fireEvent.click(screen.getByLabelText("Take a checklist note")); });
    const body = screen.getByLabelText("Note body");
    expect(body.getAttribute("placeholder")).toBe("One item per line…");
    expect(screen.getByTitle("Turn the body into a checklist").getAttribute("aria-pressed")).toBe("true");
    await act(async () => { fireEvent.change(body, { target: { value: "bread\n\n- [x] butter\njam" } }); });
    await act(async () => { fireEvent.keyDown(body, { key: "Enter", ctrlKey: true }); });
    expect(props.onCreate).toHaveBeenCalledWith("- [ ] bread\n- [x] butter\n- [ ] jam");
  });

  it("an empty note is never created", async () => {
    const props = rig([]);
    await mount(props);
    await act(async () => { fireEvent.click(screen.getByText("Take a note…")); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "   " } }); });
    await act(async () => { fireEvent.click(screen.getByText("Add note")); });
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("a draft survives closing the board, shows on the capture bar, and Cancel discards it", async () => {
    const props = rig([]);
    const first = await mount(props);
    await act(async () => { fireEvent.click(screen.getByText("Take a note…")); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Half a thought" } }); });
    expect(JSON.parse(localStorage.getItem("pf:card-draft"))).toMatchObject({ title: "Half a thought" });
    first.unmount();
    await mount(props);
    const resume = screen.getByLabelText("Continue your draft note");
    expect(resume.textContent).toContain("Draft");
    expect(resume.textContent).toContain("Half a thought");
    await act(async () => { fireEvent.click(resume); });
    expect(screen.getByLabelText("Note title").value).toBe("Half a thought");
    await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
    expect(localStorage.getItem("pf:card-draft")).toBeNull();
    expect(screen.getByText("Take a note…")).toBeTruthy();
  });

  it("an unreadable stored draft starts empty rather than breaking the board", async () => {
    localStorage.setItem("pf:card-draft", "{not json");
    await mount(rig([]));
    expect(screen.getByText("Take a note…")).toBeTruthy();
  });
});

describe("what a card shows", () => {
  it("rendered previews, checklists with progress, folders, times, and empty notes", async () => {
    const tasks = doc(p(text("shopping")), { type: "taskList", content: [task("a", true), task("b", false), task("c", false), task("d", false), task("e", false), task("f", false), task("g", true)] });
    const props = rig(
      [
        rec("rich", "Rich", doc(h(2, "Plan"), p(text("do "), text("this", [{ type: "bold" }]))), ago(10 * 1000)),
        rec("list", "List", tasks, ago(5 * MIN)),
        rec("empty", "Empty", doc(), ago(3 * HOUR)),
        rec("old", "Old", doc(p(text("old words"))), ago(2 * DAY)),
        rec("ancient", "Ancient", doc(p(text("ancient"))), ago(40 * DAY)),
      ],
      { folderNameFor: (id) => (id === "rich" ? "Projects" : null) },
    );
    await mount(props);
    const rich = cardOf("Rich");
    expect(rich.querySelector("[data-md-preview]").innerHTML).toContain("<strong>this</strong>");
    expect(rich.textContent).toContain("Projects");
    expect(rich.textContent).toContain("just now");
    const list = cardOf("List");
    expect(list.textContent).toContain("2/7 done");
    expect(list.textContent).toContain("+1 more");
    expect(list.querySelectorAll("li .line-through")).toHaveLength(1); // the one checked item shown
    expect(list.textContent).toContain("5m ago");
    expect(cardOf("Empty").textContent).toContain("Empty note");
    expect(cardOf("Empty").textContent).toContain("3h ago");
    expect(cardOf("Old").textContent).toContain("2d ago");
    expect(cardOf("Ancient").textContent).toContain(new Date(NOW - 40 * DAY).toLocaleDateString());
    // Newest first.
    expect(titles()).toEqual(["Rich", "List", "Empty", "Old", "Ancient"]);
  });

  it("the open document's card is marked", async () => {
    await mount(rig([rec("a", "A", doc(p(text("a")))), rec("b", "B", doc(p(text("b"))))], { activeDocId: "b" }));
    expect(cardOf("B").className).toContain("ring-primary");
    expect(cardOf("A").className).not.toContain("ring-2 ring-primary");
  });

  it("deals cards into as many columns as the BOARD is wide, keeping reading order", async () => {
    const RealRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} };
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 900; } });
    try {
      const recs = ["a", "b", "c", "d", "e"].map((id, i) => rec(id, id.toUpperCase(), doc(p(text(id))), ago(i * MIN)));
      await mount(rig(recs));
      const columns = [...document.querySelector("div.flex.items-start.gap-3").children];
      expect(columns).toHaveLength(3);
      expect([...columns[0].querySelectorAll("h3")].map((x) => x.textContent)).toEqual(["A", "D"]);
      expect([...columns[1].querySelectorAll("h3")].map((x) => x.textContent)).toEqual(["B", "E"]);
    } finally {
      globalThis.ResizeObserver = RealRO;
      if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    }
  });
});

describe("search", () => {
  it("matches body text, says when nothing matches, and clears", async () => {
    await mount(rig([rec("a", "Alpha", doc(p(text("the quick fox")))), rec("b", "Beta", doc(p(text("lazy dog"))))]));
    const box = screen.getByLabelText("Search notes");
    await act(async () => { fireEvent.change(box, { target: { value: "FOX" } }); });
    expect(titles()).toEqual(["Alpha"]);
    await act(async () => { fireEvent.change(box, { target: { value: "zebra" } }); });
    expect(screen.getByText("No notes match your search")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("Clear search", { selector: "button" })); });
    expect(titles()).toHaveLength(2);
    await act(async () => { fireEvent.change(box, { target: { value: "dog" } }); });
    await act(async () => { fireEvent.click(screen.getByLabelText("Clear search")); });
    expect(box.value).toBe("");
  });
});

describe("pin, colour, open, delete", () => {
  it("pinning moves a card under Pinned, and unpinning moves it back", async () => {
    const props = rig([rec("a", "A", doc(p(text("a"))), ago(MIN)), rec("b", "B", doc(p(text("b"))), ago(2 * MIN))]);
    await mount(props);
    await act(async () => { fireEvent.click(cardOf("B").querySelector('[aria-label="Pin note to top"]')); });
    expect(props.onPatchMeta).toHaveBeenLastCalledWith("b", { cardPinned: true });
    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(screen.getByText("Others")).toBeTruthy();
    expect(titles()).toEqual(["B", "A"]);
    await act(async () => { fireEvent.click(cardOf("B").querySelector('[aria-label="Unpin note"]')); });
    expect(props.onPatchMeta).toHaveBeenLastCalledWith("b", { cardPinned: false });
    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("the colour menu marks the current colour and closes on a click outside or Escape", async () => {
    const props = rig([rec("a", "A", doc(p(text("a"))), ago(MIN), { cardColor: "teal" })]);
    const { shell } = await mount(props);
    const open = () => act(async () => { fireEvent.click(cardOf("A").querySelector('[aria-label="Change note colour"]')); });
    await open();
    expect(screen.getByLabelText("Mint").getAttribute("aria-checked")).toBe("true");
    await act(async () => { fireEvent.pointerDown(document.body); });
    expect(screen.queryByRole("menu", { name: "Note colour" })).toBeNull();
    await open();
    await escape(shell);
    expect(screen.queryByRole("menu", { name: "Note colour" })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled(); // Escape closed the MENU, not the board
    await open();
    await act(async () => { fireEvent.click(screen.getByLabelText("Default")); });
    expect(props.onPatchMeta).toHaveBeenLastCalledWith("a", { cardColor: "default" });
  });

  it("Open in editor and Delete hand the card's id to the host", async () => {
    const props = rig([rec("a", "A", doc(p(text("a"))))]);
    await mount(props);
    await act(async () => { fireEvent.click(cardOf("A").querySelector('[aria-label="Open note in the editor"]')); });
    expect(props.onOpenInEditor).toHaveBeenCalledWith("a");
    await act(async () => { fireEvent.click(cardOf("A").querySelector('[aria-label="Delete note"]')); });
    expect(props.onDelete).toHaveBeenCalledWith("a");
  });
});

describe("the card editor", () => {
  const openCard = async (title) => {
    await act(async () => { fireEvent.click(screen.getByLabelText(`Edit note: ${title}`)); });
    return screen.getByRole("dialog", { name: `Edit note: ${title}` });
  };
  const note = () => rec("n", "Note", doc(h(1, "Note"), p(text("see [docs](https://example.com)"))));

  it("opens RENDERED on a narrow screen and SPLIT on a wide one, and remembers the choice", async () => {
    mql.matches = true; // narrow
    const props = rig([note()]);
    const first = await mount(props);
    let dialog = await openCard("Note");
    expect(dialog.querySelector("textarea")).toBeNull();
    expect(dialog.querySelector(".pf-card-render h1").textContent).toBe("Note");
    await act(async () => { fireEvent.click(screen.getByText("Write")); });
    expect(dialog.querySelector("textarea")).not.toBeNull();
    expect(dialog.querySelector(".pf-card-render")).toBeNull();
    expect(localStorage.getItem("pf:card-view")).toBe("write");
    first.unmount();
    mql.matches = false;
    await mount(props);
    dialog = await openCard("Note");
    expect(dialog.querySelector("textarea")).not.toBeNull(); // the remembered "write"
    localStorage.removeItem("pf:card-view");
  });

  it("split shows the source and a live render; a link in the render does not navigate", async () => {
    const props = rig([note()]);
    await mount(props);
    const dialog = await openCard("Note");
    const area = dialog.querySelector('textarea[aria-label="Note content (markdown)"]');
    expect(area.value).toBe("# Note\n\nsee [docs](https://example.com)");
    await act(async () => { fireEvent.change(area, { target: { value: area.value + "\n\nlive line" } }); });
    expect(dialog.querySelector(".pf-card-render").textContent).toContain("live line");
    const link = dialog.querySelector(".pf-card-render a");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("closing without a change saves nothing; Done after a change saves the markdown", async () => {
    const props = rig([note()]);
    await mount(props);
    await openCard("Note");
    await act(async () => { fireEvent.click(screen.getByText("Done")); });
    expect(props.onSaveCard).not.toHaveBeenCalled();
    const dialog = await openCard("Note");
    const area = dialog.querySelector("textarea");
    await act(async () => { fireEvent.change(area, { target: { value: "# Note\n\nrewritten" } }); });
    await act(async () => { fireEvent.click(screen.getByText("Done")); });
    expect(props.onSaveCard).toHaveBeenCalledWith("n", "# Note\n\nrewritten");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Ctrl+Enter, the backdrop and Escape all save through the same path", async () => {
    const props = rig([note()]);
    const { shell } = await mount(props);
    const edit = async (suffix) => {
      const dialog = await openCard("Note");
      const area = dialog.querySelector("textarea");
      await act(async () => { fireEvent.change(area, { target: { value: `# Note\n\n${suffix}` } }); });
      return { dialog, area };
    };
    const { area } = await edit("one");
    await act(async () => { fireEvent.keyDown(area, { key: "Enter", ctrlKey: true }); });
    expect(props.onSaveCard).toHaveBeenLastCalledWith("n", "# Note\n\none");
    const { dialog } = await edit("two");
    await act(async () => { fireEvent.pointerDown(dialog); }); // the backdrop itself
    expect(props.onSaveCard).toHaveBeenLastCalledWith("n", "# Note\n\ntwo");
    await edit("three");
    await escape(shell);
    expect(props.onSaveCard).toHaveBeenLastCalledWith("n", "# Note\n\nthree");
    expect(props.onClose).not.toHaveBeenCalled(); // the editor closed, the board stayed
  });

  it("Open in editor saves the pending edit FIRST, then opens the note", async () => {
    const order = [];
    const props = rig([note()], {
      onSaveCard: vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); order.push("saved"); }),
      onOpenInEditor: vi.fn(() => order.push("opened")),
    });
    await mount(props);
    const dialog = await openCard("Note");
    await act(async () => { fireEvent.change(dialog.querySelector("textarea"), { target: { value: "# Note\n\nedited" } }); });
    await act(async () => {
      fireEvent.click(screen.getByTitle("Open this note in the full editor"));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(order).toEqual(["saved", "opened"]);
  });

  it("without a renderer it is write-only", async () => {
    const props = rig([note()], { renderMarkdown: undefined });
    await mount(props);
    const dialog = await openCard("Note");
    expect(screen.queryByRole("group", { name: "Note view" })).toBeNull();
    expect(dialog.querySelector("textarea")).not.toBeNull();
  });
});

describe("read-only", () => {
  it("shows the notes but offers nothing that would change them", async () => {
    const props = rig([rec("a", "A", doc(h(1, "A"), p(text("body"))))], { readOnly: true });
    await mount(props);
    expect(screen.queryByText("Take a note…")).toBeNull();
    const card = cardOf("A");
    for (const label of ["Pin note to top", "Change note colour", "Delete note"]) {
      expect(card.querySelector(`[aria-label="${label}"]`).disabled).toBe(true);
    }
    await act(async () => { fireEvent.click(screen.getByLabelText("Edit note: A")); });
    await act(async () => { fireEvent.click(screen.getByText("Source")); });
    const area = screen.getByLabelText("Note content (markdown)");
    expect(area.readOnly).toBe(true);
    await act(async () => { fireEvent.change(area, { target: { value: "changed" } }); });
    await act(async () => { fireEvent.click(screen.getByText("Close", { selector: "button" })); });
    expect(props.onSaveCard).not.toHaveBeenCalled();
  });
});

describe("the Escape ladder", () => {
  it("closes the most specific thing first: composer, then search, then the board", async () => {
    const props = rig([rec("a", "Alpha", doc(p(text("a"))))]);
    const { shell } = await mount(props);
    await act(async () => { fireEvent.click(screen.getByText("Take a note…")); });
    await escape(shell);
    expect(screen.queryByLabelText("Note body")).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "alp" } }); });
    await escape(shell);
    expect(screen.getByLabelText("Search notes").value).toBe("");
    expect(props.onClose).not.toHaveBeenCalled();
    await escape(shell);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Back to editor closes the board", async () => {
    const props = rig([]);
    await mount(props);
    await act(async () => { fireEvent.click(screen.getByLabelText("Back to the editor")); });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
