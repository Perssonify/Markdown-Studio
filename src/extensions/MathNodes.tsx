import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { cachedImport } from "../utils/lazy-import";
import { useT } from "../i18n";

/**
 * TipTap nodes that render LaTeX with KaTeX (lazy-loaded). The LaTeX source is
 * carried on `data-math-inline` / `data-math-block` attributes so it round-trips
 * to Markdown `$…$` / `$$…$$` via the turndown rules in turndown-rules.ts.
 *
 * Math is an atom (no caret inside), so inline editing is done by double-clicking
 * the rendered math to reveal a small source input. Committing calls
 * `updateAttributes({ latex })`, which changes the node's `data-math-*` output;
 * the normal Tiptap `onUpdate` → hash-gated `syncHtmlToMd` path then regenerates
 * the Markdown for free — no sync-engine changes, no per-keystroke KaTeX re-parse
 * (KaTeX renders from the committed attribute, not the live draft).
 */

// Memoised while pending/fulfilled, forgotten if it rejects: a failed chunk
// (offline, a purged deploy) must not leave every formula unrendered for the
// rest of the session (A085; utils/lazy-import.ts explains what a retry can do).
export const getKatex = cachedImport(() => import("katex").then((m) => m.default)); // exported for its test

/**
 * KaTeX markup is heavy — a formula is dozens of elements — and a formula-heavy
 * note carries thousands of formulas (A083). Every one of them is work for
 * layout, paint and hit-testing on each keystroke, and for React: before every
 * commit, React DOM walks the WHOLE focused contenteditable to record the
 * selection (getSelectionInformation), and with the rich pane focused that is
 * every element of every rendered formula. So a formula is typeset only once
 * it comes within a screen of the rich pane's viewport; until then it holds its
 * LaTeX as one text node. Where there is no IntersectionObserver (jsdom, an old
 * WebView) it is typeset at once, as before, and printing typesets them all.
 */
const waiting = new Map<Element, () => void>();
const observers = new WeakMap<Element, IntersectionObserver>();
let printHook = false;

function typesetNearView(el: HTMLElement, typeset: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    typeset();
    return () => {};
  }
  // The rich pane's scroller (EditorPanes): its margin reaches a screen ahead.
  const root = el.closest(".tiptap-editor-content")?.parentElement ?? null;
  const key = root ?? document.documentElement;
  let io = observers.get(key);
  if (!io) {
    const observer: IntersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const run = waiting.get(entry.target);
        waiting.delete(entry.target);
        observer.unobserve(entry.target);
        run?.();
      }
    }, { root, rootMargin: "100% 0px" });
    io = observer;
    observers.set(key, io);
  }
  if (!printHook && typeof window !== "undefined") {
    printHook = true;
    // Print what is on paper, not what was near the screen.
    window.addEventListener("beforeprint", () => {
      const all = [...waiting.values()];
      waiting.clear();
      for (const run of all) run();
    });
  }
  waiting.set(el, typeset);
  io.observe(el);
  const observer = io;
  return () => {
    waiting.delete(el);
    observer.unobserve(el);
  };
}

function MathView({
  latex,
  inline,
  updateAttributes,
  editable = true,
}: {
  latex: string;
  inline: boolean;
  updateAttributes?: (attrs: Record<string, unknown>) => void;
  editable?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);

  useEffect(() => {
    if (editing) return; // don't re-render KaTeX while the source input is open
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    // The source until the formula is typeset (see typesetNearView).
    if (!el.firstChild) el.textContent = latex;
    const typeset = async () => {
      // A failed chunk load (offline, a purged deploy) shows the LaTeX source
      // instead of surfacing as an unhandled rejection; the memo forgets the
      // failure, so the next render tries again.
      const katex = await getKatex().catch(() => null);
      if (cancelled || !ref.current) return;
      if (!katex) {
        ref.current.textContent = latex;
        return;
      }
      try {
        katex.render(latex || "", ref.current, {
          throwOnError: false,
          displayMode: !inline,
        });
      } catch {
        if (ref.current) ref.current.textContent = latex;
      }
    };
    const stop = typesetNearView(el, () => { void typeset(); });
    return () => {
      cancelled = true;
      stop();
    };
  }, [latex, inline, editing]);

  const open = () => {
    if (!editable || !updateAttributes) return;
    setDraft(latex);
    setEditing(true);
  };
  const commit = () => {
    updateAttributes?.({ latex: draft });
    setEditing(false);
  };
  const cancel = () => {
    setDraft(latex);
    setEditing(false);
  };

  if (editing) {
    const Field = inline ? "input" : "textarea";
    return (
      <NodeViewWrapper
        as={inline ? "span" : "div"}
        className={inline ? "math-inline math-editing" : "math-block math-editing"}
        contentEditable={false}
      >
        <Field
          autoFocus
          value={draft}
          onChange={(e: any) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e: any) => {
            if (e.key === "Enter" && (inline || !e.shiftKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          spellCheck={false}
          rows={inline ? undefined : 2}
          className="math-source-input"
          placeholder={inline ? t("panes.latex") : t("panes.latexShiftEnterForNewline")}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={inline ? "span" : "div"}
      className={inline ? "math-inline" : "math-block"}
      contentEditable={false}
      onDoubleClick={open}
      onKeyDown={
        editable
          ? (e: any) => {
              // Keyboard parity for the double-click edit affordance.
              if (e.key === "Enter" || e.key === "F2") {
                e.preventDefault();
                open();
              }
            }
          : undefined
      }
      tabIndex={editable ? 0 : undefined}
      role={editable ? "button" : undefined}
      aria-label={editable ? (latex ? t("panes.mathLabel", { latex }) : t("panes.mathLabelEmpty")) : undefined}
      title={editable ? t("panes.doubleClickOrPressEnter") : undefined}
      style={editable ? { cursor: "pointer" } : undefined}
    >
      <span ref={ref} />
    </NodeViewWrapper>
  );
}

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-math-inline") || "",
        renderHTML: (attrs) => ({ "data-math-inline": attrs["latex"] }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Include the LaTeX as text so getHTML() → turndown stays non-blank.
    return ["span", mergeAttributes(HTMLAttributes), node.attrs["latex"] || ""];
  },

  addNodeView() {
    return ReactNodeViewRenderer((props: any) => (
      <MathView
        latex={props.node.attrs.latex}
        inline
        updateAttributes={props.updateAttributes}
        editable={props.editor?.isEditable ?? true}
      />
    ));
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-math-block") || "",
        renderHTML: (attrs) => ({ "data-math-block": attrs["latex"] }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), node.attrs["latex"] || ""];
  },

  addNodeView() {
    return ReactNodeViewRenderer((props: any) => (
      <MathView
        latex={props.node.attrs.latex}
        inline={false}
        updateAttributes={props.updateAttributes}
        editable={props.editor?.isEditable ?? true}
      />
    ));
  },
});
