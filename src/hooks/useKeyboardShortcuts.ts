import { RefObject, useEffect, useRef } from "react";
import { useUIStore } from "../store/uiStore";
import { isAltGraphInput } from "../utils/alt-graph";

/** The markdown pane's handle, as far as this hook needs it. */
interface MarkdownPaneLike {
  getView?: () => { dom?: HTMLElement | null } | null;
}

interface KeyboardShortcutsOptions {
  dispatch: (command: string, value?: any) => void;
  updateFormats: (forceImmediate: boolean) => void;
  save: () => void;
  newDoc: () => void;
  toast: any;
  toggleFind: () => void;
  /** Open Find & Replace with the replace row expanded (⌘H). */
  openReplace?: () => void;
  openSearch?: () => void;
  toggleSidebar: () => void;
  /** Toggle the relationship-graph overlay (⌘⇧G). */
  toggleGraph?: () => void;
  /** Toggle the Cards board overlay (⌘⇧K). */
  toggleCards?: () => void;
  cancelPendingSync: () => void;
  tiptapRef: RefObject<any>;
  /** The markdown pane. With the rich pane's view, this is how the hook tells
   *  "the caret is in the document" from "focus is in some other input". */
  cmRef?: RefObject<MarkdownPaneLike | null>;
  /** Which workspace surface is on screen. Formatting chords act only on
   *  "editor"; the map and Cards cover the document they would edit. */
  workspaceView?: "editor" | "map" | "cards";
  /** Prompt for a link URL via the app's styled dialog (falls back to
   *  window.prompt if not provided). */
  promptLink?: () => Promise<string | null>;
}

export function useKeyboardShortcuts(
  containerRef: RefObject<HTMLElement>,
  {
    dispatch,
    updateFormats,
    save,
    newDoc,
    toast,
    toggleFind,
    openReplace,
    openSearch,
    toggleSidebar,
    toggleGraph,
    toggleCards,
    cancelPendingSync,
    tiptapRef,
    cmRef,
    workspaceView = "editor",
    promptLink,
  }: KeyboardShortcutsOptions
) {
  // Read at EVENT time through a ref, like the container below: the view flips
  // on every overlay open/close, and making it an effect dependency would
  // re-subscribe the capture listener each time for no benefit.
  const workspaceViewRef = useRef(workspaceView);
  workspaceViewRef.current = workspaceView;

  useEffect(() => {
    // NOTE: this effect must NOT bail on a null container.
    //
    // PerssonifyEditor renders an "Initializing Engine…" branch before the
    // container exists, so the first run of this effect always sees null. It
    // used to `return` there and rely on a later run to attach the listener —
    // which happened only because every handler below was an inline arrow whose
    // identity changed on each render. Stabilising those handlers (a separate,
    // correct performance fix) removed the accidental re-run, and EVERY
    // keyboard shortcut in the app went dead: measured after a reload, ⌘F, ⌘⇧D,
    // ⌘⇧K and ⌘⇧G all did nothing, before and after clicking into the editor.
    //
    // The listener is on `document` and its scope check already runs per event,
    // so the container is resolved AT EVENT TIME instead. Nothing then depends
    // on the mount order.
    const handler = (e: KeyboardEvent) => {
      if (!useUIStore.getState().keyboardShortcutsEnabled) return; // disabled in Settings
      // AltGr is TYPING, not a chord. Windows reports it as Ctrl+Alt, so without
      // this every AltGr character met the `mod` test below: `[` and `]` (AltGr+8
      // / AltGr+9 on a German layout) were swallowed as outdent / indent in both
      // panes, and Hungarian AltGr+F — its `[` — opened Find & Replace through
      // the physical-key match in the ⌥⌘F branch. See isAltGraphInput for why a
      // plain Ctrl+Alt+F on a US layout still counts as a chord.
      if (isAltGraphInput(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // This listener is capture-phase on `document`, so it runs before
      // ProseMirror's own keymap. Pull the DOM selection into PM state first:
      // browsers fire `selectionchange` asynchronously, so a chord pressed
      // within a few milliseconds of a Shift+Arrow selection would otherwise be
      // handled — by PM's keymap as much as by the branches below — against a
      // stale, still-collapsed selection. ⌘B then sets a stored mark at the
      // caret instead of bolding the selected text. Gated on `mod`, so ordinary
      // typing never pays for it, and a no-op mid-composition.
      tiptapRef.current?.syncSelectionFromDom?.();
      const key = e.key.toLowerCase();
      const shift = e.shiftKey;

      const active = document.activeElement;
      const tiptapDom = tiptapRef.current?.getEditor?.()?.view?.dom;
      const tiptapHasFocus = !!tiptapDom && tiptapDom.contains(active);
      const cmDom = cmRef?.current?.getView?.()?.dom;
      const cmHasFocus = !!cmDom && cmDom.contains(active);
      // The caret is IN the document, and the document is what is on screen.
      // Everything below the global chords edits the document, so it needs both.
      const inDocument = (tiptapHasFocus || cmHasFocus) && workspaceViewRef.current === "editor";

      if (key === "f" && shift) { e.preventDefault(); (openSearch ?? toggleFind)(); return; }
      // ⌥⌘F — Find & Replace, and the ONLY keyboard route to Replace on macOS
      // (see the ⌘H note below). It must be tested BEFORE the bare "f" branch,
      // which used to swallow it: the documented shortcut silently opened plain
      // Find instead, so Replace had no working binding on a Mac at all.
      // macOS composes Option+F into "ƒ", so match the physical key as well.
      if (e.altKey && !shift && (key === "f" || key === "ƒ" || e.code === "KeyF")) {
        e.preventDefault();
        (openReplace ?? toggleFind)();
        return;
      }
      if (key === "f") { e.preventDefault(); toggleFind(); return; }
      // ⌘H opens Find & Replace with the replace row expanded (like Google Docs).
      // Handled before the tiptap-focus early return so it works in the rich pane
      // too; preventDefault suppresses the browser's history shortcut.
      // NOTE: on macOS AppKit consumes ⌘H (Hide Application) before it ever
      // reaches the page, so this binding is unreachable there and Replace had no
      // keyboard route at all. ⌥⌘F below is the Mac-reachable equivalent.
      if (key === "h" && !shift) { e.preventDefault(); (openReplace ?? toggleFind)(); return; }
      if (key === "s" && !shift) {
        e.preventDefault();
        save();
        return;
      }
      if (key === "n" && !shift) { e.preventDefault(); newDoc(); return; }
      if (key === "d" && shift) { e.preventDefault(); toggleSidebar(); return; }
      // ⌘⇧G toggles the relationship-graph overlay. Handled before the
      // tiptap-focus early return so it works from the rich pane too.
      if (key === "g" && shift && toggleGraph) { e.preventDefault(); toggleGraph(); return; }
      // ⌘⇧K toggles the Cards board (same overlay contract as the graph).
      if (key === "k" && shift && toggleCards) { e.preventDefault(); toggleCards(); return; }

      // ── Document chords: only with the caret in the document ─────────────
      //
      // The scope check below (`scoped`) admits ANY focus inside the editor
      // container, and the container holds a great deal that is not the
      // document: the Cards composer and card editor, the library's search and
      // rename boxes, the map's search, the Find panel. ⌘B / ⌘I / ⌘K pressed in
      // any of those used to format the document hidden UNDER the overlay —
      // whichever pane was last focused — and autosave it. The global chords
      // above keep working from anywhere; these do nothing outside a pane, and
      // leave the key to whatever has focus. ⌘Z included: `cancelPendingSync`
      // drops the pending cross-pane projection, which is only right when the
      // markdown pane is about to undo — from a text box it stranded the last
      // edit in one pane.
      if (!inDocument) return;

      // ⌘K (insert link) is handled here — before the tiptap-focus early return —
      // because it is not one of TipTap's own keymap shortcuts, so it would
      // otherwise be dead in the rich pane. Works in both panes via the dialog.
      if (key === "k" && !shift) {
        e.preventDefault();
        if (promptLink) {
          promptLink().then((url) => { if (url) dispatch("createLink", url); });
        } else {
          const url = prompt("Enter URL:");
          if (url) dispatch("createLink", url);
        }
        return;
      }

      // ── Formatting chords, for BOTH panes ────────────────────────────────
      //
      // These used to sit BELOW the rich-pane early return, on the assumption
      // that TipTap's own keymap covered them there. Checked against the
      // installed extensions, it does not: `⌘⇧X` is `Mod-Shift-s` in
      // extension-strike, `⌘⇧1–6` are `Mod-Alt-N` in extension-heading, `⌘⇧0`
      // is `Mod-Alt-0`, `⌘]`/`⌘[` are bound by nothing at all — and `⌘⇧9` is
      // `toggleTaskList` in extension-list, so the documented "Blockquote"
      // produced a task list in one pane and a blockquote in the other. Six of
      // the shortcuts on the Help page were dead or wrong in the rich pane.
      //
      // Every branch preventDefaults and dispatches, so TipTap's keymap never
      // also fires and the command applies exactly once, through the one choke
      // point that carries the read-only and composition guards. Handling them
      // above the early return is what makes the documentation true.
      const applied = () => {
        if (tiptapHasFocus) requestAnimationFrame(() => updateFormats(true));
        else updateFormats(true);
      };

      if (!shift) {
        const inlineMap: Record<string, string> = { b: "bold", i: "italic", u: "underline", e: "code" };
        if (inlineMap[key]) { e.preventDefault(); dispatch(inlineMap[key]); applied(); return; }
      }

      if (key === "x" && shift) { e.preventDefault(); dispatch("strikethrough"); applied(); return; }
      if (key === "h" && shift) { e.preventDefault(); dispatch("hiliteColor", "#f59e0b"); applied(); return; }

      if (shift) {
        const alignMap: Record<string, string> = { l: "alignLeft", e: "alignCenter", r: "alignRight", j: "alignJustify" };
        if (alignMap[key]) { e.preventDefault(); dispatch(alignMap[key]); applied(); return; }
      }

      if (key === "]" && !shift) { e.preventDefault(); dispatch("indent"); applied(); return; }
      if (key === "[" && !shift) { e.preventDefault(); dispatch("outdent"); applied(); return; }

      if (shift && e.code) {
        const code = e.code;
        const digitMap: Record<string, [string, number?]> = {
          Digit1: ["heading", 1], Digit2: ["heading", 2], Digit3: ["heading", 3],
          Digit4: ["heading", 4], Digit5: ["heading", 5], Digit6: ["heading", 6],
          Digit7: ["orderedList"], Digit8: ["bulletList"],
          // Deliberately blockquote, as documented — TipTap binds this to
          // toggleTaskList, which is why preventDefault above matters.
          Digit9: ["blockquote"], Digit0: ["heading", 0],
        };
        const entry = digitMap[code];
        if (entry) {
          e.preventDefault();
          const [cmd, arg] = entry;
          if (arg === undefined) dispatch(cmd); else dispatch(cmd, arg);
          applied();
          return;
        }
      }

      // Anything not handled above is TipTap's to interpret when the rich pane
      // has focus (its input rules, its own extras).
      if (tiptapHasFocus) {
        requestAnimationFrame(() => updateFormats(true));
        return;
      }

      if (key === "z") {
        cancelPendingSync();
        return;
      }
    };

    // Bound to the DOCUMENT, not the container. On a cold load (and after the
    // last document is deleted, or any overlay closes without restoring focus)
    // document.activeElement is BODY — an ANCESTOR of the container — so a
    // container-bound listener never fired in either phase and every shortcut
    // was dead until the user happened to click inside the editor first.
    // Scope is preserved by the guard: act only when focus is inside this
    // editor instance, or nowhere in particular (body).
    const scoped = (e: KeyboardEvent) => {
      const el = containerRef.current;
      const active = document.activeElement;
      const inThisEditor = !!el && !!active && el.contains(active);
      const unfocused = !active || active === document.body;
      // With no container yet there is nothing to scope to, and acting would
      // reach into whatever else is on the page.
      if (!el) return;
      if (!inThisEditor && !unfocused) return;
      handler(e);
    };
    document.addEventListener("keydown", scoped, true);
    return () => document.removeEventListener("keydown", scoped, true);
  }, [dispatch, updateFormats, save, newDoc, toast, toggleFind, openReplace, openSearch, toggleSidebar, toggleGraph, toggleCards, cancelPendingSync, tiptapRef, cmRef, containerRef, promptLink]);
}