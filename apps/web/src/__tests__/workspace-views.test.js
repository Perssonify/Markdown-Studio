import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the ONE-SURFACE-AT-A-TIME invariant for the workspace views.
 *
 * The Cards board and the relationship map are peers: two full-canvas views of
 * the whole library, each rendered as an overlay above the still-mounted
 * editor. They were once two independent booleans (`graphVisible` /
 * `cardsVisible`), which made an invalid state representable and reachable —
 * measured in a real browser against v1.65.0:
 *
 *     after Cards:                 1 dialog  ['Cards']
 *     after ALSO Relationship map: 2 dialogs ['Relationship map', 'Cards']
 *
 * Two `aria-modal` dialogs at the same z-index, the map mounted (and running
 * its force simulation) invisible beneath Cards — so choosing "Relationship
 * map" from the View menu looked like a dead menu item — and both sharing a
 * single `overlayRef`, so focus and the Escape ladder targeted whichever
 * mounted last.
 *
 * Static source assertions, like integration-parity.test.js: the regression is
 * "someone adds a second independent visibility flag / a second overlay block",
 * which a render test of the current, correct behavior would not catch.
 *
 * The selection and its handlers live in src/editor/useWorkspaceViews.ts; the
 * overlay shell and the wiring of those handlers into the chrome live in
 * PerssonifyEditor. Each assertion reads the file that holds its subject.
 */

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

const PE = read("src/PerssonifyEditor.tsx");
const VIEWS = read("src/editor/useWorkspaceViews.ts");
const STATUS_BAR = read("src/ui/chrome/statusBar/index.tsx");
const MENU_BAR = read("src/ui/chrome/menuBar/index.tsx");

describe("workspace views are mutually exclusive", () => {
  it("derives a single exclusive `workspaceView` selection", () => {
    expect(VIEWS).toMatch(/workspaceView:\s*"editor"\s*\|\s*"map"\s*\|\s*"cards"/);
    // …and the editor takes it from there rather than keeping its own copy.
    expect(PE).toMatch(/workspaceView,[\s\S]*?\} = useWorkspaceViews\(/);
    expect(PE).not.toMatch(/useState[^\n]*[cC]ardsVisible/);
  });

  it("routes every open/close through the one setter, which clears the other view", () => {
    // setWorkspaceView assigns BOTH flags from the same argument, so no caller
    // can raise one without lowering the other.
    expect(VIEWS).toMatch(/setCardsVisible\(view === "cards"\)/);
    expect(VIEWS).toMatch(/setGraphVisible\(view === "map"\)/);
  });

  it("renders exactly one overlay shell, keyed off that selection", () => {
    expect(PE).toMatch(/workspaceView !== "editor" && \(/);
    // ONE overlay container, whose label switches with the view — not two.
    // Counted on the `data-workspace-overlay` marker rather than on a role or
    // aria attribute: a structural marker survives an aria/role refactor, and
    // grepping for an attribute STRING cannot tell markup from a comment that
    // merely mentions it (this file's own accessibility rework changed the
    // overlay from a dialog to a labelled region while such a comment stood).
    const shells = (PE + VIEWS).match(/data-workspace-overlay=/g) || [];
    expect(shells).toHaveLength(1);
    expect(PE).toMatch(/aria-label=\{workspaceView === "map" \? t\("app\.overlayMap"\) : t\("app\.overlayCards"\)\}/);
  });

  it("does not claim to be a modal — the surface switcher stays usable beside it", () => {
    // The overlay covers <main> only; the menu bar, workspace panel and switcher
    // are deliberately still reachable, so aria-modal would be a lie to AT.
    const overlayBlock = PE.slice(
      PE.indexOf("data-workspace-overlay="),
      PE.indexOf("data-workspace-overlay=") + 400
    );
    expect(overlayBlock).not.toMatch(/aria-modal/);
    // …and the covered editor is made genuinely unreachable instead — by the
    // overlay effect, which the editor runs for that shell.
    expect(VIEWS).toMatch(/setAttribute\("inert", ""\)/);
    expect(PE).toMatch(/useOverlayInert\(overlayRef, anyOverlayOpen\)/);
  });

  it("keeps the graph on the controlled setter so the /graph route still drives it", () => {
    // setShowGraph writes uiStore directly and would desync the standalone
    // app's URL-controlled graph; setGraphVisible honors onGraphOpenChange.
    expect(PE + VIEWS).not.toMatch(/setShowGraph\(view === "map"\)/);
  });
});

describe("one control per surface, in one place", () => {
  it("offers all three surfaces as one radio-style group in the top bar", () => {
    expect(MENU_BAR).toMatch(/data-tour="workspace-views"/);
    // Editor is its OWN option, not "the other two are off" — a toggle you have
    // to un-press to escape reads as a trapdoor rather than a choice.
    expect(MENU_BAR).toMatch(/const SURFACES = \[/);
    expect(MENU_BAR).toMatch(/id: "editor"/);
    expect(MENU_BAR).toMatch(/id: "cards"/);
    expect(MENU_BAR).toMatch(/id: "map"/);
    expect(MENU_BAR).toMatch(/aria-pressed=\{active\}/);
  });

  it("mirrors the same three-way choice in the View menu", () => {
    expect(MENU_BAR).toMatch(/<DropdownMenuRadioItem value="editor">/);
    expect(MENU_BAR).toMatch(/<DropdownMenuRadioItem value="cards">/);
    expect(MENU_BAR).toMatch(/<DropdownMenuRadioItem value="map">/);
  });

  it("selects a surface outright from the switcher, and keeps the shortcuts as toggles", () => {
    // The button says "go here", so it must not un-toggle back to the editor.
    // The handlers are hoisted into stable useCallbacks (they are props of a
    // memoized MenuBar), so pin the definition and the wiring separately.
    expect(VIEWS).toMatch(/const showMapView = useCallback\(\(\) => setWorkspaceView\("map"\)/);
    expect(VIEWS).toMatch(/const showCardsView = useCallback\(\(\) => setWorkspaceView\("cards"\)/);
    expect(VIEWS).toMatch(/const showEditorView = useCallback\(\(\) => setWorkspaceView\("editor"\)/);
    expect(PE).toMatch(/onGraph=\{showMapView\}/);
    expect(PE).toMatch(/onCards=\{showCardsView\}/);
    expect(PE).toMatch(/onEditor=\{showEditorView\}/);
    // ⌘⇧K / ⌘⇧G pressed twice should still put you back. Hoisted for the same
    // reason as the switcher handlers: these are dependencies of the shortcut
    // hook's effect, which registers a capture-phase keydown listener on
    // `document` — as inline arrows it re-subscribed on every render.
    expect(VIEWS).toMatch(/const toggleGraphCb = useCallback\(\(\) => toggleWorkspaceView\("map"\)/);
    expect(VIEWS).toMatch(/const toggleCardsCb = useCallback\(\(\) => toggleWorkspaceView\("cards"\)/);
    expect(PE).toMatch(/toggleGraph: toggleGraphCb/);
    expect(PE).toMatch(/toggleCards: toggleCardsCb/);
  });

  it("treats picking a layout as picking the editor", () => {
    // MD/Rich/Split are invisible under an overlay; changing one there would be
    // a control that silently does nothing.
    expect(VIEWS).toMatch(/const handleSetMode = useCallback\(\(m: string\) => \{\s*setMode\(m\);\s*setWorkspaceView\("editor"\);/);
    expect(PE).toMatch(/setMode=\{handleSetMode\}/);
  });

  it("leaves no duplicate graph toggle in the status bar", () => {
    // The bar reports state; the same Network button also lived here, firing
    // the same action from the opposite corner of the screen.
    expect(STATUS_BAR).not.toMatch(/onToggleGraph/);
    expect(STATUS_BAR).not.toMatch(/<Network\b/);
    expect(PE).not.toMatch(/onToggleGraph=/);
  });

  it("moves the graph JSON export into the map's own header", () => {
    expect(STATUS_BAR).not.toMatch(/onGraphExport/);
    expect(PE).toMatch(/onExport=\{handleGraphExport\}/);
  });
});
