import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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

/** Decorations for every unresolved wiki link in `doc` (pure; exported for tests). */
export function unresolvedLinkDecorations(doc: PMNode, resolve: Resolve | null): DecorationSet {
  if (!resolve) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.attrs["docLink"] != null);
    if (!mark) return;
    const docLink = String(mark.attrs["docLink"] ?? "").trim();
    // A same-document anchor ([[#Heading]]) has an empty target and resolves
    // within this document — never "broken" in this sense.
    if (!docLink) return;
    if (resolve(docLink, (mark.attrs["anchor"] as string | null) ?? null)) return;
    decos.push(
      Decoration.inline(pos, pos + node.nodeSize, { class: "wiki-link-unresolved", "data-unresolved": "" })
    );
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
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
            // Library changed (setWikiLinkLibrary), or the content did: an edit
            // can add, remove or retarget a link anywhere.
            if (tr.getMeta(unresolvedWikiLinksKey) || tr.docChanged) {
              return unresolvedLinkDecorations(tr.doc, currentResolve);
            }
            return prev;
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
