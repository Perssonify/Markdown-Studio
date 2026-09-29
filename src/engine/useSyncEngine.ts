import { useRef, useCallback, RefObject } from "react";
import { quickHash } from "../utils/index";
import { MarkdownEngine } from "./useMarkdownEngine";

interface SyncEngineParams {
  cmRef: RefObject<any>;
  tiptapRef: RefObject<any>;
  engine: MarkdownEngine | null;
  syncMode: "styled" | "clean" | string;
  onCanonicalChange?: (pmJson: any) => void;
}

export function useSyncEngine({
  cmRef,
  tiptapRef,
  engine,
  syncMode,
  onCanonicalChange,
}: SyncEngineParams) {
  // null = "no sync yet" sentinel, distinct from quickHash("") === 0, so genuine
  // empty content still triggers the first sync instead of being mistaken for unset.
  const lastMdHash = useRef<number | null>(null);
  const lastHtmlHash = useRef<number | null>(null);
  // The ProseMirror doc node this engine last saw. PM nodes are immutable, so
  // reference equality answers "has the rich pane changed?" for free — where
  // hashing the answer costs a full HTML serialization of the whole document.
  const lastHtmlDoc = useRef<unknown>(null);
  const syncing = useRef<boolean>(false);

  /** The live PM doc node, or null when the editor is not mounted. */
  const currentHtmlDoc = (): unknown =>
    tiptapRef.current?.getEditor?.()?.state?.doc ?? null;

  const syncMdToHtmlRef = useRef<(() => boolean) | null>(null);
  const syncHtmlToMdRef = useRef<(() => boolean) | null>(null);

  /**
   * MD pane changed → parse → update Tiptap (canonical).
   * Tiptap converts our HTML into PM JSON internally.
   */
  const syncMdToHtml = useCallback((): boolean => {
    if (!engine || !cmRef.current || !tiptapRef.current || syncing.current) return false;

    // Never re-project into a pane that is mid-composition: this path calls
    // tiptap.setHTML() (a setContent dispatch), and dispatching into an editor
    // during an IME / voice-dictation composition ABORTS it and drops the
    // streamed text (the Windows-dictation "input not accepted" bug). Return
    // BEFORE touching lastMdHash so the caller (or the debounce's own retry)
    // re-runs this once the composition settles.
    //
    // Only the RICH pane is checked, because only the rich pane is written
    // here — the markdown pane is read (`getValue`) and CodeMirrorPane is
    // uncontrolled, so nothing in this path can dispatch into it. This used to
    // check BOTH panes, which meant dictating into the markdown pane froze the
    // rich pane for the whole utterance for no reason, and (measured) a
    // CodeMirror composition flag that got stuck on wedged the projection
    // permanently. `isComposing` now also expires a stuck flag; these are the
    // belt and the braces.
    if (tiptapRef.current.isComposing?.()) return false;

    const md = cmRef.current.getValue();
    const hash = quickHash(md);
    if (hash === lastMdHash.current) return false;

    syncing.current = true;

    try {
      // The conversion runs BEFORE the gate is committed. Recording "I have
      // projected this content" first meant that a throw out of marked left the
      // gate claiming the panes agree when they do not — and the debounced path
      // can never retry the same content, so the mirror stayed silently frozen
      // until a force-sync (a doc switch, a sync-mode change, a toolbar
      // command). The finally below restores the previous value on a throw.
      const html = engine.mdToHtml(md);
      lastMdHash.current = hash;
      tiptapRef.current.setHTML(html);

      // Remember the doc node we just produced instead of serializing it back
      // out to hash it. ProseMirror normalizes the HTML it parses, so the input
      // string's hash is NOT the hash `syncHtmlToMd` would compute — but the
      // doc node it built is exactly what that side compares against, and
      // comparing nodes is free. The hash is then cleared (not guessed), so it
      // can never wrongly suppress a real rich-pane change.
      //
      // The echo gate must not DEPEND on that fast path, though: with no doc
      // node to compare against (editor not mounted, or a handle that exposes
      // no state) the doc check can never match, and an unset hash would let
      // the very next syncHtmlToMd project an empty rich pane back over the
      // markdown. So when there is no node, pay for the hash exactly as before.
      const projected = currentHtmlDoc();
      lastHtmlDoc.current = projected;
      lastHtmlHash.current =
        projected === null ? quickHash(tiptapRef.current.getHTML()) : null;

      if (onCanonicalChange) {
        const editor = tiptapRef.current.getEditor?.();
        if (editor) onCanonicalChange(editor.getJSON());
      }
    } finally {
      syncing.current = false;
    }
    return true;
  }, [engine, cmRef, tiptapRef, onCanonicalChange]);

  /**
   * HTML pane changed → extract PM JSON → format to MD for CM6.
   */
  const syncHtmlToMd = useCallback((): boolean => {
    if (!engine || !cmRef.current || !tiptapRef.current || syncing.current) return false;

    // Composition guard (see syncMdToHtml): this path calls cm.setValue() (a CM
    // dispatch), which would abort an active IME/dictation composition. Defer.
    // Mirror image of the guard above — the markdown pane is the one written
    // here, so it is the only one whose composition can be aborted.
    if (cmRef.current.isComposing?.()) return false;

    // Cheap gate first: an untouched doc node means nothing to project, and
    // this is the common case on the forced/flush paths (focus changes, toolbar
    // commands) where the rich pane has not been edited at all.
    const doc = currentHtmlDoc();
    if (doc !== null && doc === lastHtmlDoc.current) return false;

    const html = tiptapRef.current.getHTML();
    const hash = quickHash(html);
    if (hash === lastHtmlHash.current) {
      // Record the node as seen before bailing. The content is identical to what
      // was last projected, so this is correct — and without it the cheap gate
      // above stays stale after every hash-equal skip, making each later call
      // pay for the very serialization the gate exists to avoid.
      lastHtmlDoc.current = doc;
      return false;
    }

    // An empty rich pane here is a GENUINE clear: this path fires only from a real
    // rich-pane edit (Tiptap onUpdate) or a post-mutation force — document loads
    // use setContent({emitUpdate:false}) and never reach here — so both panes
    // should agree with the clear. (A focus-based "is this spurious?" heuristic was
    // tried and REMOVED: it silently reverted real deletions when the user blurred
    // the rich pane before the debounce fired. The catastrophic-loss protection now
    // lives at the persistence boundary — documentStore.saveActiveDoc refuses to
    // persist a blank canonical over a stored non-empty doc unless the clear is
    // explicit — so an accidental blank is always recoverable from disk on reload.)
    syncing.current = true;

    try {
      // Committed AFTER the conversion — see syncMdToHtml. Recording the gate
      // first meant a throw out of turndown left both sentinels saying the panes
      // agree, and nothing retried.
      const convert = syncMode === "styled" ? engine.htmlToMd : engine.htmlToCleanMd;
      const md = convert(html);
      lastHtmlHash.current = hash;
      lastHtmlDoc.current = doc;
      // `setValue` reports the text the pane settled on, so there is no need to
      // read the whole rope back out just to hash it.
      //
      // null means it wrote NOTHING — there is no live CodeMirror view yet (the
      // imperative handle attaches in the layout phase, the view is created in a
      // passive effect). Record the hash of what the pane ACTUALLY holds, which
      // is what reading it back used to do. Recording the "unset" sentinel here
      // instead was a document-wipe: the pane holds "", so the next
      // syncMdToHtml hashes "" to 0, finds 0 !== null, passes the gate, and
      // projects an EMPTY markdown document into the rich pane. The hazard on
      // this line is not trusting content the pane lacks — it is projecting the
      // pane's emptiness into the other pane.
      const settled = cmRef.current.setValue(md);
      lastMdHash.current = quickHash(
        typeof settled === "string" ? settled : cmRef.current.getValue?.() ?? ""
      );

      if (onCanonicalChange) {
        const editor = tiptapRef.current.getEditor?.();
        if (editor) onCanonicalChange(editor.getJSON());
      }
    } finally {
      syncing.current = false;
    }
    return true;
  }, [engine, cmRef, tiptapRef, syncMode, onCanonicalChange]);

  syncMdToHtmlRef.current = syncMdToHtml;
  syncHtmlToMdRef.current = syncHtmlToMd;

  /**
   * Force sync — invalidates hash then calls sync via ref.
   *
   * CRITICAL INVARIANT: These callbacks have EMPTY dependency arrays.
   * They call through refs to access the current sync function.
   * Adding any dependency would cause React re-render cascades → infinite sync loops.
   */
  const forceSyncMdToHtml = useCallback(() => {
    // null (not 0!) — quickHash("") === 0, so a 0 sentinel made force-flushing
    // an EMPTY pane a silent no-op: select-all-delete then a quick doc switch
    // reverted the deletion because the flush never propagated it.
    lastMdHash.current = null;
    syncMdToHtmlRef.current?.();
  }, []);

  const forceSyncHtmlToMd = useCallback(() => {
    lastHtmlHash.current = null;
    lastHtmlDoc.current = null; // both gates must open, or the force is a no-op
    syncHtmlToMdRef.current?.();
  }, []);

  /** Reset hashes — used when loading new content */
  const resetHashes = useCallback(() => {
    lastMdHash.current = null;
    lastHtmlHash.current = null;
    lastHtmlDoc.current = null;
  }, []);

  /** Get current canonical PM JSON from Tiptap. */
  const getCanonical = useCallback(() => {
    const editor = tiptapRef.current?.getEditor?.();
    return editor ? editor.getJSON() : null;
  }, [tiptapRef]);

  /**
   * Set canonical content from PM JSON (e.g., loading a document).
   *
   * By default this also DROPS both panes' undo histories: hydration is how
   * documents are switched, and a surviving history means ⌘Z right after a
   * switch undoes the hydration itself — resurrecting the PREVIOUS document's
   * content under the new document's id, which autosave would then persist.
   * Pass { resetHistory: false } only for same-document content updates
   * (e.g. the host append API), where keeping undo is desirable.
   */
  const setCanonical = useCallback((pmJson: any, opts?: { resetHistory?: boolean }) => {
    if (!tiptapRef.current || !engine) return;

    syncing.current = true;
    try {
      const editor = tiptapRef.current.getEditor?.();
      if (editor) {
        editor.commands.setContent(pmJson, { emitUpdate: false });
      }

      if (cmRef.current) {
        const html = tiptapRef.current.getHTML();
        const convert = syncMode === "styled" ? engine.htmlToMd : engine.htmlToCleanMd;
        const md = convert(html);

        lastMdHash.current = quickHash(md);
        lastHtmlHash.current = quickHash(html);
        lastHtmlDoc.current = currentHtmlDoc();

        cmRef.current.setValue(md);
      }

      if (opts?.resetHistory !== false) {
        tiptapRef.current.resetHistory?.();
        cmRef.current?.resetHistory?.();
      }
    } finally {
      syncing.current = false;
    }
  }, [engine, cmRef, tiptapRef, syncMode]);

  /** Set content from HTML string (e.g., after ingest). */
  const setFromHtml = useCallback((html: string) => {
    if (!tiptapRef.current || !engine) return;

    syncing.current = true;
    try {
      tiptapRef.current.setHTML(html);

      if (cmRef.current) {
        // One serialization, used for both the conversion and the hash — this
        // called getHTML() twice, i.e. serialized the whole document twice.
        const actualHtml = tiptapRef.current.getHTML();
        const convert = syncMode === "styled" ? engine.htmlToMd : engine.htmlToCleanMd;
        const md = convert(actualHtml);

        lastMdHash.current = quickHash(md);
        lastHtmlHash.current = quickHash(actualHtml);
        lastHtmlDoc.current = currentHtmlDoc();

        cmRef.current.setValue(md);
      }

      // setFromHtml loads a document's content wholesale — always drop stale
      // undo history (see setCanonical for the rationale).
      tiptapRef.current.resetHistory?.();
      cmRef.current?.resetHistory?.();

      if (onCanonicalChange) {
        const editor = tiptapRef.current.getEditor?.();
        if (editor) onCanonicalChange(editor.getJSON());
      }
    } finally {
      syncing.current = false;
    }
  }, [engine, cmRef, tiptapRef, syncMode, onCanonicalChange]);

  return {
    syncMdToHtml,
    syncHtmlToMd,
    forceSyncMdToHtml,
    forceSyncHtmlToMd,
    resetHashes,
    getCanonical,
    setCanonical,
    setFromHtml,
  };
}