/**
 * A108 — the bottom tray's diagnostics Console, the library's body search,
 * and same-document heading links, through the real editor.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react/pure";
import {
  act, click, fireEvent, heading, installBrowserStubs, key, mountEditor, para, scrolledTo, seededAdapter,
  storedDoc, toastText, typeMd, until, untilHydrated,
} from "./behave-harness";
import { useUIStore } from "../store/uiStore";

vi.setConfig({ testTimeout: 30000 });

let warn;
let err;

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  // The admin-gated Console tab (Settings ▸ Admin in a development build).
  useUIStore.setState({ consoleEnabled: true });
  const adapter = await seededAdapter([
    storedDoc("home", "Home", [heading(1, "Home"), heading(2, "Setup"), para("home body"), heading(2, "Usage"), para("usage body")],
      { updated: "2026-09-05T10:00:00.000Z" }),
    storedDoc("other", "Other", [heading(1, "Other"), para("a rare zebracorn appears")], { updated: "2026-09-01T10:00:00.000Z" }),
  ]);
  await mountEditor({ storageAdapter: adapter });
  await until(() => document.querySelector(".ProseMirror"), "the editor");
  if ((await until(() => document.querySelector('[role="tree"] [data-key="d:home"]'), "the library")).getAttribute("aria-current") !== "true") {
    await click(document.querySelector('[role="tree"] [data-key="d:home"] button'));
  }
  await untilHydrated("home");
}, 30000);

afterAll(() => { cleanup(); warn.mockRestore(); err.mockRestore(); useUIStore.setState({ consoleEnabled: false }); });

const pm = () => document.querySelector(".ProseMirror");

describe("the diagnostics Console", () => {
  it("runs read-only commands against the live editor", async () => {
    Object.defineProperty(document.querySelector(".pf-tray-region"), "clientHeight", { value: 900, configurable: true });
    await click(document.querySelector('button[aria-label="Panel tray"]'));
    const tab = await until(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes("Console")), "the Console tab");
    await click(tab);
    const input = await until(() => screen.queryByLabelText("Console command input"), "the console input");
    const run = async (cmd) => {
      await act(async () => { fireEvent.change(input, { target: { value: cmd } }); });
      await key(input, "Enter");
    };
    const panel = () => document.querySelector('[role="tabpanel"]').textContent;
    await run("docs.list");
    await until(() => panel().includes("Other") && panel().includes("Home"), "the document list");
    await run("doc.outline");
    await until(() => panel().includes("Setup") && panel().includes("Usage"), "the outline");
    await run("diag.lifecycle");
    await until(() => /hydrated/i.test(panel()), "the lifecycle state");
    await run("no.such.command");
    await until(() => /unknown|not a command|help/i.test(panel()), "the unknown-command answer");
    await click(document.querySelector('button[aria-label="Panel tray"]'));
  });
});

describe("the library's search reads document BODIES", () => {
  it("finds a word that only appears in another document's text", async () => {
    const box = screen.getByLabelText("Search documents");
    await act(async () => { fireEvent.change(box, { target: { value: "zebracorn" } }); });
    const hit = await until(() => document.querySelector('[role="listbox"] [role="option"][data-key="other"]'), "the body match");
    expect(document.querySelectorAll('[role="listbox"] [role="option"]')).toHaveLength(1);
    await click(hit);
    await untilHydrated("other");
    await act(async () => { fireEvent.change(box, { target: { value: "" } }); });
  });
});

describe("same-document heading links", () => {
  it("[[#Heading]] scrolls within the document; a missing heading says so", async () => {
    await click(document.querySelector('[role="tree"] [data-key="d:home"] button'));
    await untilHydrated("home");
    await typeMd("\n\njump to [[#Usage]] or [[#Nowhere]]");
    const good = await until(() => pm().querySelector('a[data-anchor="Usage"]'), "the Usage link");
    scrolledTo.length = 0;
    await click(good);
    await until(() => scrolledTo.at(-1)?.textContent === "Usage", "the scroll to Usage");
    const bad = pm().querySelector('a[data-anchor="Nowhere"]');
    await click(bad);
    await until(() => /Heading not found: "Nowhere"/.test(toastText()), "the not-found toast");
  });
});
