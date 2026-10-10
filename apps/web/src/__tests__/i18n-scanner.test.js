import { describe, expect, it } from "vitest";
import { scanFiles, scanSource, sourceFiles } from "./i18n-scan";

/**
 * A099: every string the interface shows goes through the translation layer
 * (src/i18n). This scanner is what keeps it that way — a new hard-coded label,
 * tooltip, aria-label, placeholder, toast or dialog title under the scanned
 * roots fails here with its file and line. See i18n-scan.js for exactly what
 * counts, and docs/i18n.md for how to add the string properly.
 */

const ROOT = process.cwd();
// Every client module that renders, toasts or asks: the UI and editor, the
// hooks and formatting commands behind them, node views, the integration
// wrapper, the PWA prompts and the three entry shells.
const ROOTS = [
  "src/ui", "src/editor", "src/hooks", "src/formatting", "src/extensions", "src/integration", "src/pwa",
  "src/App.tsx", "src/PerssonifyEditor.tsx", "src/EditorHeader.tsx", "src/embed.tsx",
];

/**
 * Literals that stay literal. Each is [file, exact text, reason]; an entry
 * that no longer matches anything fails the stale-entry test below, so the
 * list cannot quietly outlive its reasons.
 */
const ALLOWLIST = [
  // Shown in the hint and as the input's placeholder: it is the admin console's
  // COMMAND, typed exactly as written — the registry matches the English word.
  ["src/ui/diagnostics/consolePanel/index.tsx", "help", "a console command name the command registry matches literally, not prose"],
];

const allowed = (hit) => ALLOWLIST.some(([file, text]) => file === hit.file && text === hit.text);
const fmt = (h) => `${h.file}:${h.line} ${h.kind} ${JSON.stringify(h.text)}`;

describe("the scanner can fail", () => {
  // Each of these is a real regression shape; if the scanner stops seeing one,
  // the repository test below would pass for the wrong reason.
  const kinds = (src, file) => scanSource(src, file).map((h) => `${h.kind}:${h.text}`);

  it("flags JSX text", () => {
    expect(kinds(`const A = () => <button>Save changes</button>;`)).toEqual(["jsx-text:Save changes"]);
  });

  it("flags the attributes a user reads or hears", () => {
    expect(kinds(`const A = () => <input aria-label="Search" title={"Find"} placeholder={x ? "Type…" : "Paste"} alt="Logo" />;`))
      .toEqual(["attr:aria-label:Search", "attr:title:Find", "attr:placeholder:Type…", "attr:placeholder:Paste", "attr:alt:Logo"]);
  });

  it("flags literals and templates rendered as children", () => {
    expect(kinds("const A = () => <p>{open ? \"Close\" : `Open ${n} notes`}</p>;"))
      .toEqual(["jsx-expression:Close", "jsx-expression:Open … notes"]);
  });

  it("flags toast messages and dialog texts", () => {
    expect(kinds(`toast.show("Saved", "success"); toastSonner.error("Failed", { description: "Try again" });`, "x.ts"))
      .toEqual(["toast:Saved", "toast:Failed", "toast:Try again"]);
    expect(kinds(`confirm({ title: "Delete it?", confirmLabel: "Delete" }); prompt("Rename", { placeholder: "Title" });`, "x.ts"))
      .toEqual(["dialog:Delete it?", "dialog:Delete", "dialog:Rename", "dialog:Title"]);
    // The wrappers around the dialog API, and the browser's own prompt — but a
    // command id in front of the title is not text.
    expect(kinds(`promptText("Edit link", {}); insertWithPrompt("createLink", "Insert link"); window.prompt("Enter URL:");`, "x.ts"))
      .toEqual(["dialog:Edit link", "dialog:Insert link", "dialog:Enter URL:"]);
  });

  it("ignores translated text, glyphs, code and non-visible attributes", () => {
    expect(kinds(`const A = () => <div className="flex gap-2" data-tour="menubar" aria-keyshortcuts="Meta+B">
      {t("menu.file")} ⌘⇧K · B <kbd>Ctrl</kbd> <code>pf:admin</code>
      <span title={t("x")} aria-label={label} />
    </div>;`)).toEqual([]);
  });
});

describe("no hard-coded interface strings (A099)", () => {
  const hits = scanFiles(ROOT, sourceFiles(ROOT, ROOTS));

  it("routes every user-visible literal through t()", () => {
    expect(hits.filter((h) => !allowed(h)).map(fmt)).toEqual([]);
  });

  it("keeps no allowlist entry that matches nothing", () => {
    const stale = ALLOWLIST.filter(([file, text]) => !hits.some((h) => h.file === file && h.text === text));
    expect(stale).toEqual([]);
  });

  it("gives every allowlist entry a reason", () => {
    for (const entry of ALLOWLIST) expect(entry[2], entry.join(" | ")).toMatch(/\w{3,}.*\w{3,}/);
  });
});
