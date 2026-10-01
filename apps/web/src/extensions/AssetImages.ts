import { Extension, type Editor } from "@tiptap/core";
import { DOMSerializer, type Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import {
  IMAGE_SRC_ATTRS,
  MAX_ASSET_BYTES,
  assetRef,
  bytesToDataUrl,
  isExternalizableDataUrl,
  isRasterMime,
  parseAssetRef,
} from "../store/asset-refs";
import { assetStore } from "../store/asset-store";
import { t } from "../i18n/core";

/**
 * Images stored as binary assets, in the live rich pane (A086).
 *
 * A document refers to a stored image as `pf-asset:<sha256>`. No browser can
 * load that scheme — and an `<img>` given it in the live document is a CSP
 * violation under the app's `img-src` — so the reference never reaches a live
 * element: `AssetImageView` shows the asset through a shared object URL and a
 * visible "image unavailable" placeholder when it is missing. Serialisation
 * (`getHTML`, the markdown projection, exports) still writes the reference,
 * because ProseMirror builds that HTML in an inert document.
 *
 * `AssetImages` (live editor only — no schema, so it stays out of
 * SERIALIZE_EXTENSIONS) does the rest:
 *  - a `data:` image that arrives through a USER transaction (paste, drop,
 *    undo) is stored as an asset and its node re-pointed at the reference once
 *    the bytes have committed. Document loads and cross-pane projections are
 *    `preventUpdate` transactions and are left alone, so opening an old
 *    document never rewrites it;
 *  - an image FILE pasted (a screenshot) or dropped is stored and inserted as a
 *    reference; with the store unavailable it is inserted inline, as before;
 *  - copying rich content puts the image DATA on the clipboard, not a
 *    reference another application could never resolve.
 */

// ─── Placeholder ─────────────────────────────────────────────────────────────

/** The title a stored image that cannot be shown carries (the rich pane, theme
 *  images and rendered markdown all use it). Read at call time: it follows the
 *  interface language (A099). */
export function missingImageTitle(): string {
  return t("panes.imageUnavailableTitle");
}

/** The alt text a missing image is shown with. */
export function missingImageAlt(alt: string | null | undefined): string {
  return alt ? t("panes.imageUnavailableWithAlt", { alt }) : t("panes.imageUnavailable");
}

const xmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A constant raster-free placeholder. Ours, not document content, so the
 *  `data:image/svg+xml` refusal in isDangerousUrl (about DOCUMENT urls) does not
 *  apply; it is only ever assigned to a live `<img>` by the node view below. */
export function missingSvg(): string {
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72">' +
        '<rect x="1" y="1" width="238" height="70" rx="4" fill="#8881" stroke="#888" stroke-dasharray="5 4"/>' +
        `<text x="120" y="42" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="#777">${xmlText(t("panes.imageUnavailable"))}</text>` +
        "</svg>"
    )
  );
}

// ─── Node view ───────────────────────────────────────────────────────────────

/**
 * The `<img>` for an `image` node. Plain DOM (not React): a document can hold
 * many images and this re-renders nothing but the element itself. Attributes
 * mirror SizedImage's renderHTML so every stylesheet rule keyed on `img` —
 * sizing, the #gh-*-mode-only fragments, "hide images" — applies unchanged.
 */
export class AssetImageView implements NodeView {
  dom: HTMLImageElement;
  private node: PMNode;
  /** The asset this view currently holds an object URL reference for. */
  private held: string | null = null;
  private generation = 0;
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement("img");
    this.render();
  }

  private setAttr(name: string, value: unknown): void {
    if (value == null || value === "") this.dom.removeAttribute(name);
    else this.dom.setAttribute(name, String(value));
  }

  private render(): void {
    const { src, alt, title, width, height } = this.node.attrs as Record<string, unknown>;
    this.setAttr("width", width);
    this.setAttr("height", height);
    const ref = parseAssetRef(src);
    if (!ref) {
      this.releaseHeld();
      this.clearMissing();
      this.dom.removeAttribute("data-pf-asset");
      this.setAttr("alt", alt);
      this.setAttr("title", title);
      this.setAttr("src", src);
      return;
    }
    this.dom.setAttribute("data-pf-asset", ref.hash);
    if (ref.hash === this.held) {
      if (!this.dom.hasAttribute("data-pf-asset-missing")) {
        this.setAttr("alt", alt);
        this.setAttr("title", title);
      }
      return;
    }
    this.releaseHeld();
    this.clearMissing();
    this.setAttr("alt", alt);
    this.setAttr("title", title);
    // Whatever is showing (nothing, or the data: URL a paste arrived as —
    // the same picture) stays until the object URL is ready: re-pointing a
    // pasted image at its stored copy must not blink it.
    this.held = ref.hash;
    const gen = ++this.generation;
    void assetStore.acquireUrl(ref.hash).then((url) => {
      if (this.destroyed || gen !== this.generation) return;
      if (url) {
        this.clearMissing();
        this.dom.src = url + ref.fragment;
      } else {
        this.showMissing(ref.hash);
      }
    });
  }

  private showMissing(hash: string): void {
    const { alt } = this.node.attrs as { alt?: string | null };
    this.dom.setAttribute("data-pf-asset-missing", "");
    this.dom.setAttribute("alt", missingImageAlt(alt));
    this.dom.setAttribute("title", missingImageTitle());
    this.dom.src = missingSvg();
    // A backup restored while this document is open brings the asset back:
    // look again whenever the store changes.
    this.unsubscribe ??= assetStore.subscribe(() => {
      if (this.destroyed || this.held !== hash) return;
      const gen = ++this.generation;
      assetStore.releaseUrl(hash);
      void assetStore.acquireUrl(hash).then((url) => {
        if (this.destroyed || gen !== this.generation || !url) return;
        this.clearMissing();
        const ref = parseAssetRef(this.node.attrs["src"]);
        this.setAttr("alt", this.node.attrs["alt"]);
        this.setAttr("title", this.node.attrs["title"]);
        this.dom.src = url + (ref?.fragment ?? "");
      });
    });
  }

  private clearMissing(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.dom.removeAttribute("data-pf-asset-missing");
  }

  private releaseHeld(): void {
    if (this.held) assetStore.releaseUrl(this.held);
    this.held = null;
    this.generation++;
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** The element's own src/alt changes are ours, not content edits. */
  ignoreMutation(mutation: MutationRecord | { type: "selection" }): boolean {
    return mutation.type !== "selection";
  }

  destroy(): void {
    this.destroyed = true;
    this.clearMissing();
    this.releaseHeld();
  }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

interface AssetPluginState {
  /** Identity of the document state this editor holds. A hydration re-creates
   *  the EditorState (resetHistory / restoreEditorState), which re-inits this,
   *  so an asynchronous rewrite can tell that the document it was started for
   *  is no longer the one in the editor. */
  token: object;
  /** Big `data:` image URLs the latest user transaction brought in. */
  found: string[];
}

export const assetImagesKey = new PluginKey<AssetPluginState>("assetImages");

/** Every big raster `data:` URL a transaction introduced. */
function dataUrlsIntroducedBy(tr: Transaction): string[] {
  const out = new Set<string>();
  const consider = (v: unknown) => { if (isExternalizableDataUrl(v)) out.add(v); };
  for (const step of tr.steps) {
    const s = step as unknown as { slice?: { content: Fragment }; attr?: string; value?: unknown };
    if (s.slice?.content) {
      s.slice.content.descendants((node) => {
        const attrs = IMAGE_SRC_ATTRS[node.type.name];
        if (attrs) for (const a of attrs) consider(node.attrs[a]);
        return true;
      });
    }
    if (typeof s.attr === "string" && ["src", "lightSrc", "darkSrc"].includes(s.attr)) consider(s.value);
  }
  return [...out];
}

/** Image files carried by a paste or a drop — only when EVERY file is one. */
function imageFiles(data: DataTransfer | null | undefined): File[] {
  const files = Array.from(data?.files ?? []);
  if (!files.length || !files.every((f) => isRasterMime(f.type))) return [];
  return files;
}

/** Drops this plugin took over, so the editor container's file-import handler
 *  (EditorPanes) leaves them alone. */
const handledDrops = new WeakSet<Event>();
export function isHandledImageDrop(event: Event): boolean {
  return handledDrops.has(event);
}
export function markHandledImageDrop(event: Event): void {
  handledDrops.add(event);
}

/** Alt text for an inserted file: its name, unless it is the generic name a
 *  clipboard screenshot carries — "image" describes nothing. */
function altFor(file: File): string {
  const stem = (file.name || "").replace(/\.[^.]+$/, "").trim();
  return !stem || /^image$/i.test(stem) ? "" : stem;
}

/** Bytes → a source: a committed asset reference, or inline data (fallback). */
async function sourceFor(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await assetStore.put(bytes, file.type);
  if (hash) return assetRef(hash);
  if (!bytes.byteLength || bytes.byteLength > MAX_ASSET_BYTES) return null;
  return bytesToDataUrl(bytes, file.type);
}

async function insertImageFiles(editor: Editor, files: File[], pos: number | null): Promise<void> {
  const token = assetImagesKey.getState(editor.state)?.token;
  const startDoc = editor.state.doc;
  const nodes: { type: string; attrs: Record<string, unknown> }[] = [];
  for (const file of files) {
    try {
      const src = await sourceFor(file);
      if (src) nodes.push({ type: "image", attrs: { src, alt: altFor(file) } });
    } catch { /* an unreadable file is skipped */ }
  }
  if (!nodes.length || editor.isDestroyed || !editor.isEditable) return;
  // The document this was dropped into is no longer the one in the editor.
  if (assetImagesKey.getState(editor.state)?.token !== token) return;
  const at = pos != null && editor.state.doc === startDoc ? pos : null;
  if (at != null) editor.chain().insertContentAt(at, nodes).run();
  else editor.chain().insertContent(nodes).run();
}

/** A copy of `fragment`'s serialised DOM with asset references swapped for the
 *  image data (warmed while the selection was made — see `warmSelection`). */
function inlineCopiedImages(dom: DocumentFragment | HTMLElement): void {
  const els = (dom as ParentNode).querySelectorAll?.("img[src], source[srcset]") ?? [];
  for (const el of Array.from(els)) {
    const attr = el.tagName === "SOURCE" ? "srcset" : "src";
    const ref = parseAssetRef(el.getAttribute(attr));
    if (!ref) continue;
    const url = assetStore.peekDataUrl(ref.hash);
    if (url) el.setAttribute(attr, url + ref.fragment);
  }
}

/** Load the data of the images a selection holds, so a copy right after
 *  selecting can put them on the clipboard synchronously. */
function warmSelection(view: EditorView): void {
  const { from, to, empty } = view.state.selection;
  if (empty) return;
  const hashes: string[] = [];
  view.state.doc.nodesBetween(from, to, (node) => {
    const attrs = IMAGE_SRC_ATTRS[node.type.name];
    if (attrs) for (const a of attrs) {
      const ref = parseAssetRef(node.attrs[a]);
      if (ref) hashes.push(ref.hash);
    }
    return true;
  });
  if (hashes.length) assetStore.warmDataUrls(hashes);
}

/** How long a rewrite waits out an IME composition before giving up (the
 *  image then simply stays inline — nothing is lost). */
const COMPOSITION_RETRY_MS = 250;
const COMPOSITION_RETRIES = 40;

/** How long a selection must hold still before its images are pre-loaded for
 *  a copy. Short: ⌘A then ⌘C is a quick gesture. */
const WARM_DELAY_MS = 60;

export const AssetImages = Extension.create({
  name: "assetImages",

  addProseMirrorPlugins() {
    const editor = this.editor;
    const schema = editor.schema;
    const base = DOMSerializer.fromSchema(schema);
    const clipboardSerializer = {
      serializeFragment(fragment: Fragment, options?: { document?: Document }, target?: HTMLElement | DocumentFragment) {
        const out = base.serializeFragment(fragment, options, target);
        inlineCopiedImages(out);
        return out;
      },
    } as unknown as DOMSerializer;

    return [
      new Plugin<AssetPluginState>({
        key: assetImagesKey,
        state: {
          init: () => ({ token: {}, found: [] }),
          apply: (tr, prev) => {
            const skip = !tr.docChanged || tr.getMeta("preventUpdate") || tr.getMeta(assetImagesKey);
            const found = skip ? [] : dataUrlsIntroducedBy(tr);
            if (!found.length && !prev.found.length) return prev;
            return { token: prev.token, found };
          },
        },
        props: {
          clipboardSerializer,
          handlePaste: (view, event) => {
            const files = imageFiles(event.clipboardData);
            // HTML alongside the file is handled as HTML (TiptapPane's own
            // paste path) — this is for a bare image: a screenshot.
            if (!files.length || event.clipboardData?.getData("text/html") || !view.editable) return false;
            void insertImageFiles(editor, files, null);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved || !view.editable) return false;
            const files = imageFiles((event as DragEvent).dataTransfer);
            if (!files.length) return false;
            let pos: number | null = null;
            try {
              pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos ?? null;
            } catch { /* no layout to hit-test against: insert at the selection */ }
            event.preventDefault();
            handledDrops.add(event);
            void insertImageFiles(editor, files, pos);
            return true;
          },
        },
        view: () => {
          const inflight = new Set<string>();
          let lastFound: string[] | null = null;
          let destroyed = false;
          // A drag-select changes the selection on every mouse move; look at
          // what it holds once it settles, not each time.
          let warmTimer: ReturnType<typeof setTimeout> | null = null;

          const rewrite = (view: EditorView, map: Map<string, string>, token: object, attempt: number) => {
            // Two guards against writing into a document other than the one
            // the image came in with. Every hydration today builds a NEW
            // EditorState (resetHistory / restoreEditorState), which makes
            // ProseMirror destroy this plugin view — so `destroyed` alone
            // catches it, and the token check below is not independently
            // observable (mutation-tested: removing it alone stays green,
            // removing both goes red). It stays because it states the rule
            // itself rather than relying on how ProseMirror recycles views.
            if (destroyed || (view as unknown as { isDestroyed?: boolean }).isDestroyed) return;
            if (assetImagesKey.getState(view.state)?.token !== token) return; // another document
            if (!view.editable) return;
            if (view.composing) {
              if (attempt < COMPOSITION_RETRIES) {
                setTimeout(() => rewrite(view, map, token, attempt + 1), COMPOSITION_RETRY_MS);
              }
              return;
            }
            const tr = view.state.tr;
            view.state.doc.descendants((node, pos) => {
              const attrs = IMAGE_SRC_ATTRS[node.type.name];
              if (!attrs) return true;
              for (const a of attrs) {
                const ref = map.get(node.attrs[a] as string);
                if (ref) tr.setNodeAttribute(pos, a, ref);
              }
              return true;
            });
            if (!tr.docChanged) return;
            // Not an undo step of its own: ⌘Z after a paste should undo the
            // PASTE, not silently swap the picture's storage back to base64.
            tr.setMeta(assetImagesKey, true).setMeta("addToHistory", false);
            view.dispatch(tr);
          };

          return {
            update: (view, prevState) => {
              const st = assetImagesKey.getState(view.state);
              if (st && st.found.length && st.found !== lastFound) {
                lastFound = st.found;
                const todo = st.found.filter((u) => !inflight.has(u));
                const token = st.token;
                if (todo.length) {
                  todo.forEach((u) => inflight.add(u));
                  void (async () => {
                    const map = new Map<string, string>();
                    try {
                      if (await assetStore.available()) {
                        for (const url of todo) {
                          const hash = await assetStore.putDataUrl(url);
                          if (hash) map.set(url, assetRef(hash));
                        }
                      }
                    } finally {
                      todo.forEach((u) => inflight.delete(u));
                    }
                    if (map.size) rewrite(view, map, token, 0);
                  })();
                }
              }
              if (!view.state.selection.eq(prevState.selection) && !view.state.selection.empty) {
                if (warmTimer) clearTimeout(warmTimer);
                warmTimer = setTimeout(() => {
                  warmTimer = null;
                  if (!destroyed) warmSelection(view);
                }, WARM_DELAY_MS);
              }
            },
            destroy: () => {
              destroyed = true;
              if (warmTimer) clearTimeout(warmTimer);
            },
          };
        },
      }),
    ];
  },
});
