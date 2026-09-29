/**
 * Guards for the dual-pane sync performance work.
 *
 * These are BEHAVIOUR tests for optimisations, which means their job is to fail
 * when an optimisation changes what the app does — not to assert that it is
 * fast. The one exception is a small number of source pins, used where the
 * regression is "someone re-adds the expensive call" and there is no observable
 * output to assert on; the repo already uses that pattern in
 * graph-metrics.test.js.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { createRef } from "react";
import { renderHook, act, render } from "@testing-library/react";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";
import { useEditorStore } from "../store/editorStore";
import { useSyncEngine } from "../engine/useSyncEngine";
import { computeCounts, extractText } from "../store/document";
import { computeFidelity, computeCanonicalStats } from "../store/fidelity";
import { useDocumentStore } from "../store/documentStore";
import { normalizeMarkdown, preprocessMarkdown } from "../engine/preprocessor";
import { EditorLayout, MarkdownPane, HtmlPane } from "../ui/EditorPanes";
import { SettingsSheet } from "../ui/SettingsSheet";
import { MemorySheet } from "../ui/MemorySheet";
import { LinkBuilderDialog } from "../ui/LinkBuilderDialog";
import { VersionHistorySheet } from "../ui/VersionHistorySheet";
import { WorkspacePanel } from "../ui/WorkspacePanel";
import { useTickWhileActive } from "../hooks/useTickWhileActive";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
/** Source with comments removed, so a source pin asserts on code and not prose. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("editorStore.setActiveFormats — identity is stable across equal values", () => {
  beforeEach(() => {
    useEditorStore.setState({ activeFormats: {} });
  });

  it("keeps the previous object when every value is unchanged", () => {
    const { setActiveFormats } = useEditorStore.getState();
    const first = { bold: true, italic: false, heading: 2, color: null };
    setActiveFormats(first);
    const stored = useEditorStore.getState().activeFormats;
    expect(stored).toBe(first);

    // queryState() allocates a fresh object every frame; an equal one must not
    // become a new store reference, or every memoized consumer re-renders.
    setActiveFormats({ bold: true, italic: false, heading: 2, color: null });
    expect(useEditorStore.getState().activeFormats).toBe(stored);
  });

  it("replaces the object when any value changes", () => {
    const { setActiveFormats } = useEditorStore.getState();
    setActiveFormats({ bold: true, heading: 2 });
    const stored = useEditorStore.getState().activeFormats;
    setActiveFormats({ bold: false, heading: 2 });
    expect(useEditorStore.getState().activeFormats).not.toBe(stored);
    expect(useEditorStore.getState().activeFormats.bold).toBe(false);
  });

  it("replaces the object when a key appears or disappears", () => {
    const { setActiveFormats } = useEditorStore.getState();
    setActiveFormats({ bold: true });
    const a = useEditorStore.getState().activeFormats;
    setActiveFormats({ bold: true, italic: true });
    const b = useEditorStore.getState().activeFormats;
    expect(b).not.toBe(a);
    setActiveFormats({ bold: true });
    expect(useEditorStore.getState().activeFormats).not.toBe(b);
  });

  it("distinguishes an explicit undefined from a missing key", () => {
    const { setActiveFormats } = useEditorStore.getState();
    // Same key count, same value under `!==` — only `in` separates them.
    setActiveFormats({ bold: true, color: undefined });
    const a = useEditorStore.getState().activeFormats;
    setActiveFormats({ bold: true, highlight: undefined });
    expect(useEditorStore.getState().activeFormats).not.toBe(a);
  });

  it("notices a change from a falsy value to another falsy value", () => {
    const { setActiveFormats } = useEditorStore.getState();
    setActiveFormats({ heading: 0 });
    const a = useEditorStore.getState().activeFormats;
    setActiveFormats({ heading: false });
    expect(useEditorStore.getState().activeFormats).not.toBe(a);
  });
});

describe("per-keystroke work stays off the hot path", () => {
  it("useFormatDispatcher keeps no local React state for formatting", () => {
    // It used to hold `activeFormats` in a useState written on every keyup and
    // every selectionchange. Nothing read it — the Toolbar reads editorStore —
    // but the hook runs inside PerssonifyEditor, so the write re-rendered the
    // entire editor shell on every keystroke and caret move.
    const src = read("src/formatting/useFormatDispatcher.ts");
    expect(src).not.toMatch(/useState<\s*FormatState\s*>/);
    expect(src).not.toMatch(/setActiveFormats\s*\(/);
  });

  it("useFormatDispatcher publishes through an optional call so it can short-circuit", () => {
    // `onFormatsChange?.(queryState())` does not evaluate queryState() when the
    // callback is absent, which is how PerssonifyEditor skips ~18 isActive()
    // probes per frame while the toolbar is unmounted (read-only / minimal
    // chrome). Calling queryState() first and then testing the callback would
    // silently undo that.
    const src = read("src/formatting/useFormatDispatcher.ts");
    expect(src).toMatch(/onFormatsChange\?\.\(queryState\(\)\)/);
  });

  it("the scheduling policy cannot reach the document", () => {
    // The delay used to come from `getValue().length`, materialising the whole
    // document into a new string on every keystroke in either pane — the exact
    // cost both panes' onChange handlers were written to avoid. It now comes
    // from the measured cost of recent projections, so the module that decides
    // it has no way to read a document even by accident.
    //
    // An earlier version of this test sliced from `indexOf("const getSyncDelay")`
    // AFTER that function had been renamed away. indexOf returned -1, the slice
    // was "", and all three assertions passed against an empty string: the guard
    // could not fail. Assert against whole files, and prove the anchors exist.
    const policy = read("src/hooks/sync-schedule.ts");
    expect(policy).toMatch(/export function nextSyncWait/);
    // Comments stripped: the prose legitimately talks about documents and panes.
    const policyCode = stripComments(policy);
    expect(policyCode).not.toMatch(/getValue|getLength|cmRef|tiptapRef|editor|document/i);
    // ...and it imports only the clamp constants, nothing that could reach one.
    const imports = policyCode.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(['import {']);

    const src = read("src/hooks/useDocumentLifecycle.ts");
    const start = src.indexOf("const nextWaitFrom");
    expect(start, "nextWaitFrom not found — re-anchor this test").toBeGreaterThan(-1);
    const fn = stripComments(src.slice(start, src.indexOf(");", src.indexOf("nextSyncWait(", start))));
    expect(fn).not.toMatch(/getValue|getLength|cmRef|tiptapRef/);
  });
});

/**
 * A pair of pane handles that behave like the real ones in the way the sync
 * engine depends on: CodeMirror's setValue reports the text it settled on, and
 * the TipTap editor exposes an IMMUTABLE doc node whose identity changes only
 * when the document changes.
 */
function makeRefs({ md = "# Hello", html = "<h1>Hello</h1>" } = {}) {
  let mdContent = md;
  let htmlContent = html;
  let doc = { id: 0 }; // stands in for a ProseMirror doc node
  const calls = { getHTML: 0, getValue: 0, setValue: 0, setHTML: 0 };
  const cmRef = {
    current: {
      getValue: vi.fn(() => { calls.getValue++; return mdContent; }),
      setValue: vi.fn((v) => { calls.setValue++; mdContent = v; return v; }),
    },
  };
  const tiptapRef = {
    current: {
      getHTML: vi.fn(() => { calls.getHTML++; return htmlContent; }),
      setHTML: vi.fn((h) => { calls.setHTML++; htmlContent = h; doc = { id: doc.id + 1 }; }),
      getEditor: vi.fn(() => ({ state: { doc }, getJSON: () => ({ type: "doc" }) })),
    },
  };
  return {
    cmRef, tiptapRef, calls,
    /** Simulate a real edit in the rich pane. */
    editRich(nextHtml) { htmlContent = nextHtml; doc = { id: doc.id + 1 }; },
    md: () => mdContent,
  };
}

const engineOf = (overrides = {}) => ({
  mdToHtml: vi.fn(() => "<h1>Hello</h1>"),
  htmlToMd: vi.fn(() => "# Hello"),
  htmlToCleanMd: vi.fn(() => "# Hello"),
  ...overrides,
});

describe("sync engine — no serialization just to compute a hash", () => {
  it("syncMdToHtml does not serialize the rich pane back out", () => {
    const r = makeRefs();
    const { result } = renderHook(() =>
      useSyncEngine({ cmRef: r.cmRef, tiptapRef: r.tiptapRef, engine: engineOf(), syncMode: "clean" })
    );
    act(() => result.current.syncMdToHtml());
    expect(r.tiptapRef.current.setHTML).toHaveBeenCalledTimes(1);
    // It used to call getHTML() immediately after setHTML() purely to hash the
    // result — a full HTML serialization of the whole document, every sync.
    expect(r.calls.getHTML).toBe(0);
  });

  it("still blocks the echo: a projection is not projected straight back", () => {
    const r = makeRefs();
    const { result } = renderHook(() =>
      useSyncEngine({ cmRef: r.cmRef, tiptapRef: r.tiptapRef, engine: engineOf(), syncMode: "clean" })
    );
    act(() => result.current.syncMdToHtml());
    act(() => result.current.syncHtmlToMd());
    expect(r.cmRef.current.setValue).not.toHaveBeenCalled();
  });

  it("reports whether it actually projected, so the scheduler can measure it", () => {
    // Most calls are gated out by the hash / doc-identity checks and return in
    // microseconds; the scheduler must not fold those into its cost average.
    const r = makeRefs();
    const { result } = renderHook(() =>
      useSyncEngine({ cmRef: r.cmRef, tiptapRef: r.tiptapRef, engine: engineOf(), syncMode: "clean" })
    );
    let first, second, third;
    act(() => { first = result.current.syncMdToHtml(); });
    act(() => { second = result.current.syncMdToHtml(); }); // unchanged -> gated
    act(() => { third = result.current.syncHtmlToMd(); });  // echo -> gated
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(false);
  });

  it("a real rich-pane edit still projects", () => {
    const r = makeRefs();
    const { result } = renderHook(() =>
      useSyncEngine({
        cmRef: r.cmRef, tiptapRef: r.tiptapRef, syncMode: "clean",
        engine: engineOf({ htmlToCleanMd: () => "# Hello world" }),
      })
    );
    act(() => result.current.syncMdToHtml());
    act(() => r.editRich("<h1>Hello world</h1>"));
    act(() => result.current.syncHtmlToMd());
    expect(r.cmRef.current.setValue).toHaveBeenCalledWith("# Hello world");
    expect(r.md()).toBe("# Hello world");
  });

  it("forceSyncHtmlToMd still projects an unchanged document", () => {
    // The doc-identity gate would otherwise swallow a force, which is the one
    // thing a force exists to defeat.
    const r = makeRefs();
    const { result } = renderHook(() =>
      useSyncEngine({
        cmRef: r.cmRef, tiptapRef: r.tiptapRef, syncMode: "clean",
        engine: engineOf({ htmlToCleanMd: () => "# Forced" }),
      })
    );
    act(() => result.current.syncMdToHtml());
    act(() => result.current.forceSyncHtmlToMd());
    expect(r.cmRef.current.setValue).toHaveBeenCalledWith("# Forced");
  });

  it("records what the markdown pane settled on without reading it back", () => {
    const r = makeRefs();
    const { result } = renderHook(() =>
      useSyncEngine({
        cmRef: r.cmRef, tiptapRef: r.tiptapRef, syncMode: "clean",
        engine: engineOf({ htmlToCleanMd: () => "# Changed" }),
      })
    );
    act(() => r.editRich("<h1>Changed</h1>"));
    act(() => result.current.syncHtmlToMd());
    const readsAfterWrite = r.calls.getValue;
    // The md hash came from setValue's return value, so a second pass over the
    // same content must still be gated out.
    act(() => result.current.syncMdToHtml());
    expect(r.tiptapRef.current.setHTML).not.toHaveBeenCalled();
    expect(r.calls.getValue).toBe(readsAfterWrite + 1); // the projection's own read
  });

  it("falls back to hashing when the editor exposes no doc node", () => {
    // A handle with no `state` (editor not mounted yet) cannot use the identity
    // gate. The echo must still be blocked — by the hash, as before.
    //
    // The rich pane NORMALIZES what it is given, so this hash has to come from
    // reading the pane back, not from the HTML we handed it: those two strings
    // differ, and hashing the input would leave the gate permanently open.
    const r = makeRefs();
    r.tiptapRef.current.setHTML = vi.fn(() => {});
    r.tiptapRef.current.getHTML = vi.fn(() => '<h1 dir="auto">Hello</h1>'); // normalized
    r.tiptapRef.current.getEditor = vi.fn(() => ({ getJSON: () => ({ type: "doc" }) }));
    const { result } = renderHook(() =>
      useSyncEngine({ cmRef: r.cmRef, tiptapRef: r.tiptapRef, engine: engineOf(), syncMode: "clean" })
    );
    act(() => result.current.syncMdToHtml());
    act(() => result.current.syncHtmlToMd());
    expect(r.cmRef.current.setValue).not.toHaveBeenCalled();
  });
});

describe("the markdown pane reports what it settled on", () => {
  it("setValue returns the text the pane now holds, for every outcome", () => {
    const ref = createRef();
    render(React.createElement(CodeMirrorPane, { ref, defaultValue: "# One", isDark: false, onChange: () => {} }));
    expect(ref.current.setValue("# Two")).toBe("# Two");   // dispatched
    expect(ref.current.getValue()).toBe("# Two");
    expect(ref.current.setValue("# Two")).toBe("# Two");   // already equal
    expect(ref.current.getValue()).toBe("# Two");
  });

  it("reports the normalised text when CodeMirror rewrites what it was given", () => {
    // CRLF is the case that differs: CM6 stores "\n", so returning the caller's
    // string would describe text the pane does not hold, and the sync engine
    // hashes this to decide whether the panes agree.
    const ref = createRef();
    render(React.createElement(CodeMirrorPane, { ref, defaultValue: "a", isDark: false, onChange: () => {} }));
    const settled = ref.current.setValue("one\r\ntwo");
    expect(settled).toBe(ref.current.getValue());
    expect(settled).toBe("one\ntwo");
  });

  it("prime: the doc-identity gate is recorded even when the hash gate skips", () => {
    const r = makeRefs();
    const { result } = renderHook(() =>
      useSyncEngine({ cmRef: r.cmRef, tiptapRef: r.tiptapRef, engine: engineOf(), syncMode: "clean" })
    );
    act(() => r.editRich("<h1>Hello</h1>")); // new doc node, same html content
    act(() => result.current.syncHtmlToMd()); // runs, records both gates
    const serializationsAfterFirst = r.calls.getHTML;
    act(() => r.editRich("<h1>Hello</h1>")); // another new node, still same html
    act(() => result.current.syncHtmlToMd()); // hash-equal -> skips, primes the node
    act(() => result.current.syncHtmlToMd()); // must now hit the CHEAP gate
    expect(r.calls.getHTML).toBe(serializationsAfterFirst + 1);
  });

  it("setValue returns null once the pane has no live view", () => {
    // Nothing was written, so the sync engine must not record this text as the
    // pane's content — doing so would make the next projection skip a real
    // change and leave the panes disagreeing.
    const ref = createRef();
    const { unmount } = render(
      React.createElement(CodeMirrorPane, { ref, defaultValue: "# One", isDark: false, onChange: () => {} })
    );
    const handle = ref.current;
    unmount();
    expect(handle.setValue("# Two")).toBe(null);
  });

  it("does not project an empty markdown pane back over the rich pane", () => {
    // The pane could not write (no live CodeMirror view yet), so it still holds
    // "". If the engine records the "unset" sentinel instead of the hash of what
    // the pane actually holds, the very next md->html projection hashes "" to 0,
    // finds 0 !== null, passes the gate and pushes an EMPTY document into the
    // rich pane — a visible wipe, with only the persistence backstop between it
    // and disk. This is the test whose absence let that ship.
    const r = makeRefs();
    r.cmRef.current.setValue = vi.fn(() => null);
    r.cmRef.current.getValue = vi.fn(() => "");
    const { result } = renderHook(() =>
      useSyncEngine({
        cmRef: r.cmRef, tiptapRef: r.tiptapRef, syncMode: "clean",
        engine: engineOf({ htmlToCleanMd: () => "# Changed" }),
      })
    );
    act(() => r.editRich("<h1>Changed</h1>"));
    act(() => result.current.syncHtmlToMd());
    expect(r.cmRef.current.setValue).toHaveBeenCalledWith("# Changed");

    act(() => result.current.syncMdToHtml());
    expect(r.tiptapRef.current.setHTML).not.toHaveBeenCalled();
  });

  it("still projects once the markdown pane can actually hold content", () => {
    // The flip side: the guard above must not wedge the engine shut. As soon as
    // the pane reports real text, the md->html direction works normally.
    const r = makeRefs();
    const { result } = renderHook(() =>
      useSyncEngine({
        cmRef: r.cmRef, tiptapRef: r.tiptapRef, syncMode: "clean",
        engine: engineOf({ htmlToCleanMd: () => "# Changed" }),
      })
    );
    act(() => r.editRich("<h1>Changed</h1>"));
    act(() => result.current.syncHtmlToMd());
    act(() => result.current.forceSyncMdToHtml());
    expect(r.tiptapRef.current.setHTML).toHaveBeenCalled();
  });
});

// ── Corpus shared by the derived-value tests ─────────────────────────────────
const text = (t) => ({ type: "text", text: t });
const para = (...kids) => ({ type: "paragraph", content: kids });
const doc = (...kids) => ({ type: "doc", content: kids });

const CORPUS = {
  empty: doc(),
  plain: doc(para(text("hello world"))),
  // Adjacent text runs concatenate into ONE word — the classic off-by-one when
  // a counter works per node instead of per document.
  splitRun: doc(para(text("foo"), text("bar"), text(" baz"))),
  whitespace: doc(para(text("  leading\ttab\nnewline   trailing  "))),
  unicode: doc(para(text("caf\u00e9 na\u00efve \ud83d\ude80 rocket"))),
  // Each exotic separator gets its OWN case: mixing them in one string let two
  // opposite miscounts cancel out and hid a broken whitespace class.
  nbsp: doc(para(text("one\u00a0two"))),
  emSpace: doc(para(text("one\u2003two"))),
  lineSep: doc(para(text("one\u2028two"))),
  ideographic: doc(para(text("one\u3000two"))),
  verticalTab: doc(para(text("one\u000btwo\u000cthree"))),
  onlySpaces: doc(para(text("   \t\n  "))),
  nested: doc({
    type: "bulletList",
    content: [
      { type: "listItem", content: [para(text("one"))] },
      { type: "listItem", content: [para(text("two"), text("three"))] },
    ],
  }),
  marked: doc(
    para({ ...text("colored"), marks: [{ type: "textStyle", attrs: { color: "#f00" } }] }),
    para({ ...text("colored again"), marks: [{ type: "textStyle", attrs: { color: "#f00" } }] }),
    para({ ...text("other"), marks: [{ type: "textStyle", attrs: { color: "#0f0" } }] }),
    para({ ...text("bold"), marks: [{ type: "bold" }] }),
    para({ ...text("high"), marks: [{ type: "highlight", attrs: {} }] }),
    { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [text("Centered")] },
    { type: "paragraph", attrs: { textAlign: "right" }, content: [text("Right")] },
    { type: "image", attrs: { src: "a.png", width: 100, height: 50 } },
    { type: "image", attrs: { src: "b.png", width: 200, height: 80 } },
  ),
};

/** The implementation this replaced: build the whole text, then split it. */
const countsByString = (canonical) => {
  const t = extractText(canonical);
  return { chars: t.length, words: t.trim().split(/\s+/).filter(Boolean).length };
};

describe("word and character counts", () => {
  for (const [name, canonical] of Object.entries(CORPUS)) {
    it(`matches the string-building counter: ${name}`, () => {
      expect(computeCounts(canonical)).toEqual(countsByString(canonical));
    });
  }

  it("counts runs that span text nodes as one word", () => {
    expect(computeCounts(CORPUS.splitRun).words).toBe(2); // "foobar", "baz"
  });

  it("extractText still returns the concatenated document text", () => {
    expect(extractText(CORPUS.splitRun)).toBe("foobar baz");
    expect(extractText(CORPUS.nested)).toBe("onetwothree");
    expect(extractText(null)).toBe("");
  });
});

describe("one walk for fidelity and counts", () => {
  for (const [name, canonical] of Object.entries(CORPUS)) {
    for (const mode of ["clean", "styled"]) {
      it(`computeCanonicalStats equals the two separate walks: ${name} / ${mode}`, () => {
        const both = computeCanonicalStats(canonical, mode);
        expect(both.fidelity).toEqual(computeFidelity(canonical, mode));
        expect(both.counts).toEqual(computeCounts(canonical));
      });
    }
  }

  it("groups repeated losses into one entry with a count", () => {
    const r = computeFidelity(CORPUS.marked, "clean");
    const color = r.losses.filter((l) => l.type === "textStyle" && l.attrs?.color === "#f00");
    expect(color).toHaveLength(1);
    expect(color[0].count).toBe(2);
    // ...and keeps distinct attribute values apart: #f00 and #0f0 are two
    // buckets, not one, even though both are `textStyle`.
    expect(r.losses.filter((l) => l.type === "textStyle")).toHaveLength(2);
  });

  it("keeps each lossy attribute in its own bucket", () => {
    const r = computeFidelity(CORPUS.marked, "clean");
    const attrs = r.losses.filter((l) => l.kind === "attr");
    const key = (l) => `${l.node}.${l.attr}`;
    // Image width/height are deliberately NOT losses — the `sizedImage` turndown
    // rule carries them in both modes (see fidelity.ts / clean-vs-styled.test.js),
    // so the only attribute losses are the two alignments.
    expect(attrs.map(key).sort()).toEqual([
      "heading.textAlign", "paragraph.textAlign",
    ]);
    // Distinct values land in distinct buckets rather than being merged.
    expect(attrs.find((l) => key(l) === "heading.textAlign").value).toBe("center");
    expect(attrs.find((l) => key(l) === "paragraph.textAlign").value).toBe("right");
  });

  it("handles a null canonical", () => {
    expect(computeCanonicalStats(null).fidelity).toEqual(computeFidelity(null));
    expect(computeCanonicalStats(null).counts).toEqual({ chars: 0, words: 0 });
  });
});

describe("derived values are only republished when they change", () => {
  beforeEach(() => {
    useDocumentStore.setState({ fidelityReport: null, counts: { chars: 0, words: 0 } });
  });

  it("updateDerived keeps both object identities across an unchanged document", () => {
    const s = useDocumentStore.getState();
    s.updateDerived(CORPUS.marked);
    const f1 = useDocumentStore.getState().fidelityReport;
    const c1 = useDocumentStore.getState().counts;
    s.updateDerived(CORPUS.marked);
    expect(useDocumentStore.getState().fidelityReport).toBe(f1);
    expect(useDocumentStore.getState().counts).toBe(c1);
  });

  it("updateDerived publishes new values when the document changes", () => {
    const s = useDocumentStore.getState();
    s.updateDerived(CORPUS.plain);
    const c1 = useDocumentStore.getState().counts;
    s.updateDerived(CORPUS.marked);
    expect(useDocumentStore.getState().counts).not.toBe(c1);
    expect(useDocumentStore.getState().fidelityReport.lossless).toBe(false);
    expect(useDocumentStore.getState().counts).toEqual(computeCounts(CORPUS.marked));
  });

  it("updateFidelity and updateCounts hold their references too", () => {
    const s = useDocumentStore.getState();
    s.updateFidelity(CORPUS.marked);
    s.updateCounts(CORPUS.marked);
    const f1 = useDocumentStore.getState().fidelityReport;
    const c1 = useDocumentStore.getState().counts;
    s.updateFidelity(CORPUS.marked);
    s.updateCounts(CORPUS.marked);
    expect(useDocumentStore.getState().fidelityReport).toBe(f1);
    expect(useDocumentStore.getState().counts).toBe(c1);
  });

  it("updateFidelity returns the report either way", () => {
    const s = useDocumentStore.getState();
    const first = s.updateFidelity(CORPUS.marked);
    expect(s.updateFidelity(CORPUS.marked)).toBe(first);
  });
});

describe("guarded whole-document passes are equivalent", () => {
  const NORM_CASES = [
    "plain text\n",
    "a\n\n\n\nb\n",
    "trailing spaces   \nnext\n",
    "```js\n\n\nconst a = 1;   \n\n```\n\nafter\n",
    "~~~\ncode   \n\n\nblock\n~~~\n",
    "see \\[\\[Some Doc\\]\\] here\n",
    "fence ```js\ncode\n``` and \\[\\[Link\\]\\]\n",
    "",
  ];

  it("normalizeMarkdown protects fenced code and restores wiki links", () => {
    const out = normalizeMarkdown("```js\n\n\nconst a = 1;   \n```\n\n\n\nafter\n");
    expect(out).toContain("\n\n\nconst a = 1;   \n"); // blank runs + trailing space kept
    expect(out).not.toContain("\n\n\nafter"); // ...but collapsed outside the fence
    expect(normalizeMarkdown("a \\[\\[Doc\\]\\] b")).toContain("[[Doc]]");
  });

  it("normalizeMarkdown is idempotent on its own output", () => {
    for (const md of NORM_CASES) {
      const once = normalizeMarkdown(md);
      expect(normalizeMarkdown(once)).toBe(once);
    }
  });

  it("preprocessMarkdown leaves brace-free markdown alone and still handles braces", () => {
    const plain = "# Heading\n\nSome *text* here.\n";
    const withBrace = "# Heading {.lead}\n";
    const opts = { curlyBraceFormatting: true };
    expect(preprocessMarkdown(plain, opts)).toBe(preprocessMarkdown(plain, opts));
    expect(preprocessMarkdown(plain, opts)).not.toContain("{");
    expect(preprocessMarkdown(withBrace, opts)).not.toBe(withBrace);
  });
});

describe("the editor shell does not re-render its whole tree per keystroke", () => {
  const MEMO = Symbol.for("react.memo");
  const isMemo = (c) => c?.$$typeof === MEMO;

  it("the expensive children are memoized", () => {
    for (const [name, C] of Object.entries({
      EditorLayout, MarkdownPane, HtmlPane, WorkspacePanel,
      SettingsSheet, MemorySheet, LinkBuilderDialog, VersionHistorySheet,
    })) {
      expect(isMemo(C), `${name} must be memoized`).toBe(true);
    }
  });

  /** The JSX opening tag for `name` in PerssonifyEditor, props included. */
  function callSite(src, name) {
    const start = src.indexOf(`<${name}\n`);
    expect(start, `no <${name}> call site`).toBeGreaterThan(-1);
    const end = src.indexOf("\n", src.indexOf("/>", start));
    return src.slice(start, end);
  }

  it("passes no freshly-built function, array or object to a memoized child", () => {
    // A memo whose props are rebuilt every render never bails out — it costs a
    // shallow compare and then re-renders anyway. This is the guard that keeps
    // the memos above meaningful.
    const src = read("src/PerssonifyEditor.tsx");
    for (const name of ["MenuBar", "StatusBar", "BottomTray", "WorkspacePanel", "EditorLayout"]) {
      const site = callSite(src, name);
      expect(site, `${name}: inline arrow prop`).not.toMatch(/=\{\s*(async\s*)?\(/);
      expect(site, `${name}: inline object prop`).not.toMatch(/=\{\{/);
      expect(site, `${name}: inline array prop`).not.toMatch(/=\{\[/);
    }
  });

  it("onCanonicalChange has a stable identity", () => {
    // It is useSyncEngine's onCanonicalChange, and it is in that hook's dep
    // array: a new function per projection re-creates syncMdToHtml, then
    // handleMdChange, then every pane prop — on every sync.
    const src = read("src/PerssonifyEditor.tsx");
    expect(src).toMatch(
      /const handleCanonicalChange = useCallback\(\(pmJson: any\) => \{\s*canonicalChangeRef\.current\(pmJson\);\s*\}, \[\]\);/
    );
    // ...and the latest body is published from an effect, not during render,
    // so a render React never commits cannot leave the ref pointing at it.
    expect(src).toMatch(/useEffect\(\(\) => \{ canonicalChangeRef\.current = latestCanonicalChange; \}\);/);
  });

  it("the link index gets a stable toast adapter", () => {
    // It sits in the deps of the wiki-link click-listener effect, so an object
    // literal here detached and re-attached that listener on every render.
    const src = read("src/PerssonifyEditor.tsx");
    expect(src).toMatch(/toast: linkIndexToast,/);
    expect(src).toMatch(/const linkIndexToast = useMemo\(/);
  });
});

describe("panels that read a live value at render keep ticking", () => {
  // Memoizing the sheets was right — they stay mounted while closed so they can
  // animate out — but it removed the accident that kept them alive: they used to
  // re-render because the editor shell did, i.e. on every keystroke. Anything
  // they read at render (the JS heap, "2 min ago") froze at the moment the panel
  // opened, which is precisely when someone is watching it.
  it("re-renders on an interval while active, and stops when inactive", () => {
    vi.useFakeTimers();
    try {
      let renders = 0;
      const { rerender, unmount } = renderHook(
        ({ active }) => { renders++; useTickWhileActive(active, 1000); },
        { initialProps: { active: true } }
      );
      const afterMount = renders;
      // One tick per act(): React batches every update inside a single act()
      // into one render, so advancing 3s in one go would prove only that it
      // ticked at all, not that it keeps ticking.
      for (let i = 1; i <= 3; i++) {
        act(() => { vi.advanceTimersByTime(1000); });
        expect(renders).toBe(afterMount + i);
      }

      rerender({ active: false });
      const afterStop = renders;
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(renders).toBe(afterStop);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the two sheets that read live values actually use it", () => {
    for (const [file, ms] of [["src/ui/MemorySheet.tsx", "1000"], ["src/ui/VersionHistorySheet.tsx", "30_000"]]) {
      const src = read(file);
      expect(src, `${file} must tick while open`).toMatch(
        new RegExp(`useTickWhileActive\\(open, ${ms}\\)`)
      );
    }
  });
});

describe("the debounce refs are the pending-projection oracle", () => {
  // `flushAndCacheIfDirty` decides whether to force a markdown->rich projection
  // by reading `mdDebounceRef.current != null`. A site that clears the timer but
  // leaves the id parked makes that permanently true, and the next document
  // switch then projects a stale markdown pane over live rich-pane edits —
  // stripping inline styles in clean mode and losing the edit. Closing a tab and
  // deleting a document both did exactly that.
  it("every cancel site nulls the ref it cleared", () => {
    const src = read("src/hooks/useDocumentLifecycle.ts");
    const lines = src.split("\n");
    const offenders = [];
    let scanned = 0;
    lines.forEach((line, i) => {
      for (const ref of ["mdDebounceRef", "htmlDebounceRef"]) {
        if (!line.includes(`clearTimeout(${ref}.current)`)) continue;
        scanned++;
        if (line.includes(`${ref}.current = null`)) continue;
        // Exempt: an unmount cleanup — the hook goes away with the timer.
        const before = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
        if (/return \(\) =>|useEffect\(\(\) => \(\) =>/.test(before)) continue;
        // Exempt: a RESCHEDULE, where the same ref is re-armed just below. That
        // is not a cancel, and the ref is never observably null.
        const after = lines.slice(i + 1, i + 25).join("\n");
        if (after.includes(`${ref}.current = setTimeout`)) continue;
        offenders.push(`${i + 1}: ${line.trim()}`);
      }
    });
    // A scan with no floor passes when it matches nothing at all — rename the
    // refs or move the clears into a helper and this pin quietly stops
    // guarding anything. (composition-guards.test.js and residuals-dialog.js
    // both carry this floor; this one did not.)
    expect(scanned, "the scan found no clearTimeout sites at all").toBeGreaterThan(2);
    expect(offenders, "cleared without nulling").toEqual([]);
  });
});
