import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createWikiResolver, type DocRecord, type WikiResolution } from "../store/link-index";

/**
 * Marks wiki links whose target does not exist, as a ProseMirror DECORATION.
 *
 * A `[[link]]` to a missing document rendered exactly like one that works, so a
 * broken link could only be discovered by clicking it. The previous attempt set
 * `data-unresolved` on the rendered `<a>` elements from `useLinkIndex`, and never
 * once worked: it compared `String(entry)` of `{ target, displayText }` objects
 * — "[object Object]" — against the link targets. It was also only ever as
 * fresh as the last re-index: it re-ran when the INDEX changed, which happens
 * after a save, so a link typed (or fixed) since then kept its old state — and
 * it wrote into DOM that ProseMirror owns and is free to rebuild.
 *
 * A decoration is owned by ProseMirror, recomputed with every edit, and it is
 * not part of the document: the answer depends on OTHER documents existing,
 * which must never be written into this one's stored content (or dirty every
 * note that points at a renamed one). PM renders an inline decoration as a
 * `<span class="wiki-link-unresolved" data-unresolved>` INSIDE the link, which
 * styles.css styles (and styles the link through `:has()`).
 *
 * Resolution is THE wiki-link resolver (store/link-index), so the marking always
 * agrees with the click handler, the graph and the backlinks. It is judged
 * live, against the current content: a link typed a second ago is marked now,
 * not after the next save and re-index.
 *
 * Adds a plugin only — no node or mark — so SERIALIZE_EXTENSIONS (which must
 * mirror the schema) does not need it.
 */

type Resolve = (docLink: string, anchor?: string | null) => WikiResolution | null;

/** Module-level on purpose. The library is documentStore's — one per page,
 *  shared by every editor instance — and an editor that REMOUNTS (closing the
 *  last document, then opening another) must start from it rather than from
 *  nothing. Null until a library has actually been loaded, so a cold start does
 *  not flash every link as broken against an empty list. */
let currentResolve: Resolve | null = null;

export const unresolvedWikiLinksKey = new PluginKey<DecorationSet>("unresolvedWikiLinks");

/** Push a decoration for every unresolved wiki link inside `node`, whose
 *  content starts at document position `base`. */
function collectUnresolved(node: PMNode, base: number, resolve: Resolve, out: Decoration[]): void {
  node.descendants((child, pos) => {
    if (!child.isText) return;
    const mark = child.marks.find((m) => m.attrs["docLink"] != null);
    if (!mark) return;
    const docLink = String(mark.attrs["docLink"] ?? "").trim();
    // A same-document anchor ([[#Heading]]) has an empty target and resolves
    // within this document — never "broken" in this sense.
    if (!docLink) return;
    if (resolve(docLink, (mark.attrs["anchor"] as string | null) ?? null)) return;
    const from = base + pos;
    out.push(Decoration.inline(from, from + child.nodeSize, { class: "wiki-link-unresolved", "data-unresolved": "" }));
  });
}

/** Decorations for every unresolved wiki link in `doc` (pure; exported for tests). */
export function unresolvedLinkDecorations(doc: PMNode, resolve: Resolve | null): DecorationSet {
  if (!resolve) return DecorationSet.empty;
  const decos: Decoration[] = [];
  collectUnresolved(doc, 0, resolve, decos);
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * The ranges of `tr.doc` an edit touched, or null when a step's shape is not
 * one this knows (the caller then rescans everything). Taken from the STEPS,
 * not the step maps: a mark step — making text a link, retargeting one — maps
 * no positions at all, so a map-only reading would never see it.
 */
function changedRanges(tr: Transaction): Array<[number, number]> | null {
  // Many steps (Replace All, a projection with many stretches): their union,
  // carried forward through each step's map. One range per step, each mapped
  // through every later step, is quadratic in the steps (A083) — and with that
  // many, the blocks between them are about all there is anyway.
  if (tr.steps.length > MANY_STEPS) {
    let from = Infinity;
    let to = -Infinity;
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i] as unknown as { from?: unknown; to?: unknown; pos?: unknown };
      const map = tr.mapping.maps[i]!;
      if (from <= to) {
        from = map.map(from, -1);
        to = map.map(to, 1);
      }
      if (typeof step.from === "number" && typeof step.to === "number") {
        from = Math.min(from, map.map(step.from, -1));
        to = Math.max(to, map.map(step.to, 1));
      } else if (typeof step.pos === "number") {
        from = Math.min(from, map.map(step.pos, -1));
        to = Math.max(to, map.map(step.pos + 1, 1));
      } else {
        return null;
      }
    }
    return [[from, to]];
  }
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i] as unknown as { from?: unknown; to?: unknown; pos?: unknown };
    // Positions are in the document BEFORE step i: map them through step i
    // itself and every step after it.
    const after = tr.mapping.slice(i);
    if (typeof step.from === "number" && typeof step.to === "number") {
      ranges.push([after.map(step.from, -1), after.map(step.to, 1)]);
    } else if (typeof step.pos === "number") {
      ranges.push([after.map(step.pos, -1), after.map(step.pos + 1, 1)]);
    } else {
      return null;
    }
  }
  return ranges;
}

/** Above this many steps, changedRanges reports their union (see there). */
const MANY_STEPS = 32;

/**
 * The previous decorations carried through `tr`, with only the top-level
 * blocks the edit touched rescanned. Rescanning the whole document on every
 * keystroke cost ~57 ms at 1.6 MB under a 4× CPU slowdown (A083). A link's
 * state depends on nothing but its own mark and the library, so a block the
 * edit did not touch cannot change; `links-resolution.test.js` compares this
 * with a full rescan after every step of random edit walks.
 */
function updateDecorations(tr: Transaction, prev: DecorationSet, resolve: Resolve): DecorationSet {
  const ranges = changedRanges(tr);
  if (!ranges) return unresolvedLinkDecorations(tr.doc, resolve);
  let set = prev.map(tr.mapping, tr.doc);
  const stale: Decoration[] = [];
  const fresh: Decoration[] = [];
  tr.doc.forEach((block, offset) => {
    const end = offset + block.nodeSize;
    if (!ranges.some(([from, to]) => from <= end && to >= offset)) return;
    stale.push(...set.find(offset, end));
    collectUnresolved(block, offset + 1, resolve, fresh);
  });
  if (stale.length) set = set.remove(stale);
  if (fresh.length) set = set.add(tr.doc, fresh);
  return set;
}

export const UnresolvedWikiLinks = Extension.create({
  name: "unresolvedWikiLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: unresolvedWikiLinksKey,
        state: {
          init: (_config, state) => unresolvedLinkDecorations(state.doc, currentResolve),
          apply: (tr, prev) => {
            // The library changed (setWikiLinkLibrary): every link may have.
            if (tr.getMeta(unresolvedWikiLinksKey)) return unresolvedLinkDecorations(tr.doc, currentResolve);
            if (!tr.docChanged) return prev;
            // The content changed: an edit can add, remove or retarget a link
            // only inside the blocks it touched.
            return currentResolve ? updateDecorations(tr, prev, currentResolve) : DecorationSet.empty;
          },
        },
        props: {
          decorations: (state) => unresolvedWikiLinksKey.getState(state) ?? null,
        },
      }),
    ];
  },
});

interface EditorLike {
  isDestroyed?: boolean;
  state?: { tr?: { setMeta: (key: PluginKey, value: unknown) => unknown } };
  view?: { dispatch?: (tr: never) => void; composing?: boolean };
}

/**
 * Point broken-link marking at `documents` (null: not loaded yet — mark
 * nothing), and redraw `editor` now. Skipped mid-composition: a decoration
 * redraw next to a live IME composition can abort it, and the next edit
 * rebuilds against the new library anyway.
 */
export function setWikiLinkLibrary(documents: DocRecord[] | null, editor?: EditorLike | null): void {
  currentResolve = documents ? createWikiResolver(documents) : null;
  const tr = editor?.state?.tr;
  const view = editor?.view;
  if (!editor || editor.isDestroyed || !tr || !view?.dispatch || view.composing) return;
  view.dispatch(tr.setMeta(unresolvedWikiLinksKey, true) as never);
}
