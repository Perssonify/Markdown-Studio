import { type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { MAX_ASSET_BYTES, assetRef, bytesToDataUrl, isRasterMime } from "../store/asset-refs";
import { assetStore } from "../store/asset-store";
import { useDocumentStore } from "../store/documentStore";
import { markHandledImageDrop } from "./AssetImages";
import { t } from "../i18n/core";

/**
 * Images stored as assets, in the MARKDOWN pane (A086).
 *
 * The markdown for a stored image is `![alt](pf-asset:<64 hex digits>)` — it
 * round-trips through both panes exactly as written, and replaced what used to
 * be a wall of base64. This makes it read as short as it is meaningful: the
 * reference keeps its first eight digits and folds the rest into "…", unless
 * the caret or a selection touches it, when the whole reference shows (so it
 * can be edited or copied like any other text). Purely a view: the document
 * text is never changed.
 *
 * Also: an image FILE pasted or dropped here is stored as an asset and
 * inserted as that markdown — inline data when the store is unavailable.
 */

const REF = /pf-asset:([0-9a-f]{64})/gi;
const KEEP = "pf-asset:".length + 8;


class FoldedHash extends WidgetType {
  constructor(private readonly hash: string) { super(); }
  override eq(other: FoldedHash) { return other.hash === this.hash; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-pf-asset-fold";
    span.textContent = "…";
    span.title = t("panes.imageStoredWithRef", { hash: this.hash });
    return span;
  }
  override ignoreEvent() { return false; }
}

// Built per decoration pass rather than once at load, so the title follows the
// interface language (A099).
const assetMark = () => Decoration.mark({ class: "cm-pf-asset", attributes: { title: t("panes.imageStored") } });

function build(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const mark = assetMark();
  const sel = view.state.selection.ranges;
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const m of text.matchAll(REF)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      out.push(mark.range(start, end));
      const touched = sel.some((r) => r.from <= end && r.to >= start);
      if (!touched) {
        out.push(Decoration.replace({ widget: new FoldedHash(m[1]!.toLowerCase()) }).range(start + KEEP, end));
      }
    }
  }
  return Decoration.set(out, true);
}

const foldAssetRefs = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

function imageFiles(data: DataTransfer | null | undefined): File[] {
  const files = Array.from(data?.files ?? []);
  return files.length && files.every((f) => isRasterMime(f.type)) ? files : [];
}

function escapeAlt(s: string): string {
  return s.replace(/([\\[\]])/g, "\\$1");
}

async function markdownFor(files: File[]): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await assetStore.put(bytes, file.type);
      const src = hash
        ? assetRef(hash)
        : bytes.byteLength && bytes.byteLength <= MAX_ASSET_BYTES ? bytesToDataUrl(bytes, file.type) : null;
      if (!src) continue;
      const stem = (file.name || "").replace(/\.[^.]+$/, "").trim();
      parts.push(`![${escapeAlt(/^image$/i.test(stem) ? "" : stem)}](${src})`);
    } catch { /* unreadable file: skipped */ }
  }
  return parts.join("\n\n");
}

const editable = (view: EditorView) => view.state.facet(EditorView.editable) && !view.state.readOnly;

/**
 * Still the document the file was pasted or dropped into? Storing the image
 * takes a moment, and a document switch in that moment re-hydrates this pane
 * with ANOTHER document — which must not receive the picture.
 */
function sameDocument(docId: string | null): boolean {
  return useDocumentStore.getState().activeDocId === docId;
}

const fileHandlers = EditorView.domEventHandlers({
  paste(event, view) {
    const files = imageFiles(event.clipboardData);
    // Text on the clipboard is pasted as text; this is for a bare image.
    if (!files.length || event.clipboardData?.getData("text/plain") || !editable(view)) return false;
    event.preventDefault();
    const docId = useDocumentStore.getState().activeDocId;
    void markdownFor(files).then((md) => {
      if (!md || !editable(view) || !sameDocument(docId)) return;
      view.dispatch(view.state.replaceSelection(md));
    });
    return true;
  },
  drop(event, view) {
    const files = imageFiles(event.dataTransfer);
    if (!files.length || !editable(view)) return false;
    event.preventDefault();
    markHandledImageDrop(event);
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const startDoc = view.state.doc;
    const docId = useDocumentStore.getState().activeDocId;
    void markdownFor(files).then((md) => {
      if (!md || !editable(view) || !sameDocument(docId)) return;
      if (pos != null && view.state.doc === startDoc) {
        view.dispatch({ changes: { from: pos, insert: md }, selection: { anchor: pos + md.length } });
      } else {
        view.dispatch(view.state.replaceSelection(md));
      }
    });
    return true;
  },
});

const theme = EditorView.baseTheme({
  ".cm-pf-asset": { opacity: "0.75" },
  ".cm-pf-asset-fold": { opacity: "0.75", padding: "0 1px" },
});

export const assetRefsInMarkdown: Extension = [foldAssetRefs, fileHandlers, theme];
