/**
 * A108 — the surfaces around the document, through the real editor: the
 * Outline and heading navigation, wiki links between documents, the links
 * tray, global search, the Cards board (capture, edit, pin, colour, open) and
 * the relationship map as an overlay — entered and left by the switcher, the
 * shortcuts and a layout choice, with the editor underneath intact.
 *
 * GraphView itself is not exercised here (its own suite owns it); only the
 * overlay the editor puts it in.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react/pure";
import {
  act, click, fireEvent, heading, installBrowserStubs, key, menuClick, mountEditor, onDisk, para, richEditor,
  scrolledTo, seededAdapter, store, storedDoc, textOf, typeMd, until, untilHydrated, untilRichHas,
} from "./behave-harness";
import { useUIStore } from "../store/preferences/uiStore";

vi.setConfig({ testTimeout: 30000 });

let adapter;
let warn;
let err;

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  adapter = await seededAdapter([
    storedDoc("guide", "Guide", [heading(1, "Guide"), heading(2, "Install"), para("install body"), heading(2, "Usage"), para("usage body")],
      { updated: "2026-09-05T10:00:00.000Z" }),
    storedDoc("reference", "Reference", [heading(1, "Reference"), heading(2, "Options"), para("options body"), heading(2, "Limits"), para("limits body")],
      { updated: "2026-09-01T10:00:00.000Z" }),
  ]);
  await mountEditor({ storageAdapter: adapter });
  await until(() => store().hydratedDocId, "a document to open");
  // Boot opens the newest document (Guide, by the fixture dates). Should it
  // ever open another, open Guide the way a user would — once its row exists.
  if (store().activeDocId !== "guide") {
    await click(await until(() => document.querySelector('[role="tree"] [data-key="d:guide"] button'), "Guide in the library"));
  }
  await untilHydrated("guide");
}, 30000);

afterAll(() => { cleanup(); warn.mockRestore(); err.mockRestore(); });

const pm = () => document.querySelector(".ProseMirror");
const chord = (k, opts = {}) => key(pm(), k, { ctrlKey: true, ...opts });
const overlay = () => document.querySelector("[data-workspace-overlay]");
const lastScrolled = () => scrolledTo[scrolledTo.length - 1];

describe("the Outline and heading navigation", () => {
  it("View ▸ Outline lists the headings, and a click scrolls the rich pane to one", async () => {
    await menuClick("View", "Outline");
    const usage = await until(() => [...document.querySelectorAll('[aria-label="Workspace"] button')].find((b) => b.textContent.trim() === "Usage"), "the Usage heading in the Outline");
    expect([...document.querySelectorAll('[aria-label="Workspace"] button')].some((b) => b.textContent.trim() === "Install")).toBe(true);
    scrolledTo.length = 0;
    await click(usage);
    await until(() => lastScrolled()?.textContent === "Usage", "the scroll to Usage");
    expect(lastScrolled().tagName).toBe("H2");
    expect(pm().contains(lastScrolled())).toBe(true);
    // Back to the library for the rest of the journey.
    await click(screen.getByTitle("Files"));
  });

  it("a [[Doc#Heading]] link typed in the markdown pane opens that document AT the heading", async () => {
    await typeMd("\n\nsee [[Reference#Limits]]");
    const link = await until(() => pm().querySelector('a[data-doc-link="Reference"]'), "the rendered wiki link");
    expect(link.getAttribute("data-anchor")).toBe("Limits");
    scrolledTo.length = 0;
    await click(link);
    await untilHydrated("reference");
    await untilRichHas("limits body");
    await until(() => lastScrolled()?.textContent === "Limits", "the scroll to Limits");
    // The link was saved with the document it was typed in.
    await until(async () => textOf((await onDisk(adapter, "guide")).canonical).includes("Reference"), "the typed link on disk");
  });
});

describe("links and search", () => {
  it("the links tray lists what links here, and a row opens it", async () => {
    // jsdom lays nothing out; give the tray's region a real height, or the
    // toggle (rightly) refuses to open into zero pixels.
    Object.defineProperty(document.querySelector(".pf-tray-region"), "clientHeight", { value: 900, configurable: true });
    const trayButton = () => document.querySelector('button[aria-label="Panel tray"]');
    await click(trayButton());
    const tray = await until(() => document.querySelector('[role="tabpanel"]'), "the tray");
    const guideRow = await until(() => [...tray.querySelectorAll("button")].find((b) => b.textContent.includes("Guide")), "Guide as a backlink");
    await click(guideRow);
    await untilHydrated("guide");
    await click(trayButton()); // and collapse it again
    expect(trayButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("Search all notes finds text in another document and opens it with Find seeded", async () => {
    await menuClick("Edit", "Search all notes");
    const box = await until(() => document.querySelector('input[aria-label="Search all notes"]'), "the search box");
    await act(async () => { fireEvent.change(box, { target: { value: "options body" } }); });
    await until(() => document.querySelector('[aria-label="Search results"] [role="option"]'), "a result");
    await key(box, "Enter");
    await untilHydrated("reference");
    const find = await until(() => document.querySelector('[role="dialog"][aria-label="Find and replace"] input[aria-label^="Find in"]'), "the Find panel");
    expect(find.value).toBe("options body");
    await key(find, "Escape");
    await until(() => !document.querySelector('[aria-label="Find and replace"]'), "Find to close");
  });
});

describe("the Cards board", () => {
  it("the switcher opens it over the editor, with a card per document — saving what was just typed first", async () => {
    const open = store().activeDocId;
    await typeMd("\n\ntyped just before opening the board");
    await until(() => store().saveStatus === "editing", "unsaved typing");
    await click(screen.getByLabelText("Cards"));
    // The board reads the library, so opening it persists the open document at
    // once — well inside the 5s autosave it would otherwise wait for.
    await until(async () => textOf((await onDisk(adapter, open)).canonical).includes("typed just before opening the board"),
      "the flush on opening Cards", { timeout: 2500 });
    await until(() => overlay()?.getAttribute("data-workspace-overlay") === "cards", "the Cards overlay");
    expect(overlay().getAttribute("aria-label")).toBe("Cards");
    const titles = await until(() => {
      const t = [...overlay().querySelectorAll("h3")].map((h) => h.textContent);
      return t.includes("Guide") && t.includes("Reference") ? t : null;
    }, "a card per document");
    expect(titles).toEqual(expect.arrayContaining(["Guide", "Reference"]));
    // The editor stays mounted underneath, made inert.
    expect(richEditor()).not.toBeNull();
    expect(pm().closest("[inert]")).not.toBeNull();
  });

  it("quick capture saves a new note and leaves the open document open", async () => {
    const open = store().activeDocId;
    const before = new Set((await adapter.list()).map((d) => d.id));
    await click(screen.getByText("Take a note…"));
    const body = await until(() => screen.queryByLabelText("Note body"), "the composer");
    expect(document.activeElement).toBe(body); // the BODY takes focus, not the title
    await act(async () => { fireEvent.change(body, { target: { value: "Buy milk\nand bread" } }); });
    await click(screen.getByText("Add note"));
    const id = await until(async () => (await adapter.list()).find((d) => !before.has(d.id))?.id, "the captured note on disk");
    expect(textOf((await onDisk(adapter, id)).canonical)).toContain("Buy milk");
    await until(() => [...overlay().querySelectorAll("h3")].some((h) => h.textContent.startsWith("Buy milk")), "the new card");
    await until(() => store().activeDocId === open && store().hydratedDocId === open, "the open document to be open again");
  });

  it("editing the OPEN document's card saves it and updates the editor underneath", async () => {
    const open = store().activeDocId; // reference
    const card = await until(() => screen.queryByLabelText("Edit note: Reference"), "the Reference card");
    await click(card);
    const dialog = await until(() => document.querySelector('[role="dialog"][aria-label="Edit note: Reference"]'), "the card editor");
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Write"));
    const area = await until(() => dialog.querySelector('textarea[aria-label="Note content (markdown)"]'), "the source box");
    expect(area.value).toContain("## Options");
    await act(async () => { fireEvent.change(area, { target: { value: area.value + "\n\nadded from a card" } }); });
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Done"));
    await until(async () => textOf((await onDisk(adapter, open)).canonical).includes("added from a card"), "the card edit on disk");
    // The editor — still holding this document under the board — shows it too,
    // so its next autosave cannot put the old text back.
    await untilRichHas("added from a card");
  });

  it("pin and colour are saved without making the note look edited", async () => {
    const before = await onDisk(adapter, "guide");
    const card = () => screen.getByLabelText("Edit note: Guide").closest("div.group");
    await click(card().querySelector('button[aria-label="Pin note to top"]'));
    await until(async () => (await onDisk(adapter, "guide")).metadata?.cardPinned === true, "the pin on disk");
    await until(() => screen.queryByText("Pinned"), "the Pinned section");
    // Pinned cards render in their own section — a fresh element.
    await click(card().querySelector('button[aria-label="Change note colour"]'));
    await click(await until(() => document.querySelector('button[aria-label="Coral"]'), "the colour swatches"));
    await until(async () => (await onDisk(adapter, "guide")).metadata?.cardColor === "red", "the colour on disk");
    expect((await onDisk(adapter, "guide")).updated).toBe(before.updated);
  });

  it("Open in editor leaves the board on that document", async () => {
    const card = screen.getByLabelText("Edit note: Guide").closest("div.group");
    await click(card.querySelector('button[aria-label="Open note in the editor"]'));
    await until(() => !overlay(), "the board to close");
    await untilHydrated("guide");
    expect(pm().closest("[inert]")).toBeNull();
  });

  it("⌘⇧K opens and closes the board; Escape closes it too", async () => {
    await act(async () => { pm().focus(); });
    await chord("K", { shiftKey: true });
    await until(() => overlay()?.getAttribute("data-workspace-overlay") === "cards", "⌘⇧K to open Cards");
    await act(async () => { pm().focus(); }); // inert, so focus stays on the overlay
    await key(overlay(), "K", { ctrlKey: true, shiftKey: true });
    await until(() => !overlay(), "⌘⇧K again to close it");
    await act(async () => { pm().focus(); });
    await chord("K", { shiftKey: true });
    await until(() => overlay(), "Cards again");
    await key(overlay(), "Escape");
    await until(() => !overlay(), "Escape to close it");
  });
});

describe("the relationship map as an overlay", () => {
  it("opens from the switcher over <main>, and Editor brings the document back intact", async () => {
    const before = richEditor().getText();
    await click(screen.getByLabelText("Map"));
    await until(() => overlay()?.getAttribute("data-workspace-overlay") === "map", "the map overlay");
    expect(overlay().getAttribute("aria-label")).toBe("Relationship map");
    expect(overlay().getAttribute("role")).toBe("region");
    expect(pm().closest("[inert]")).not.toBeNull();
    // The switcher outside the overlay stays usable — Editor is its own option.
    expect(screen.getByLabelText("Map").getAttribute("aria-pressed")).toBe("true");
    await click(screen.getByLabelText("Editor"));
    await until(() => !overlay(), "the map to close");
    expect(pm().closest("[inert]")).toBeNull();
    expect(richEditor().getText()).toBe(before);
  });

  it("⌘⇧G toggles it, and choosing a layout returns to the editor", async () => {
    await act(async () => { pm().focus(); });
    await chord("G", { shiftKey: true });
    await until(() => overlay()?.getAttribute("data-workspace-overlay") === "map", "⌘⇧G to open the map");
    // A layout choice means "show me the editor": MD, from the mode switcher.
    await click(screen.getByRole("button", { name: "MD (Markdown)" }));
    await until(() => !overlay(), "the layout choice to close the map");
    expect(useUIStore.getState().mode).toBe("md");
    await click(screen.getByRole("button", { name: "Split view" }));
    expect(useUIStore.getState().mode).toBe("split");
  });
});
