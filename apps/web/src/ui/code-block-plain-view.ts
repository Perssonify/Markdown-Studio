import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from "@tiptap/pm/view";
import { subscribeLocale, t } from "../i18n/core";
import { useUIStore } from "../store/preferences/uiStore";

/**
 * An ordinary code block's node view, in plain DOM (A083).
 *
 * Every code block used to be a React node view. TipTap mounts each one with a
 * synchronous React render once the editor is live, and each mount re-renders
 * the one list of portals that holds EVERY node view — so opening a document
 * cost time quadratic in its code blocks (P measured ~77 s at 1.6 MB with one
 * every 12 blocks, 4× CPU). A plain block needs no React: a Copy button and the
 * code. Diagram and sheet-music blocks, which do, stay React (CodeBlockWithCopy).
 *
 * The markup is the React view's, minus TipTap's wrapper elements: the same
 * `code-block-*` classes and `pre > code`, which is all styles.css keys on.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** lucide's `copy` and `check` icon nodes (lucide-react 0.577), which the React
 *  Copy button draws; `code-block-plain-view.test.jsx` pins them to lucide-react's
 *  own output so an icon update cannot drift unnoticed. */
const ICONS: Record<"copy" | "check", Array<[string, Record<string, string>]>> = {
  copy: [
    ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }],
    ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
  ],
  check: [["path", { d: "M20 6 9 17l-5-5" }]],
};

export function lucideIcon(name: "copy" | "check", size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const attrs: Record<string, string> = {
    xmlns: SVG_NS,
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: `lucide lucide-${name}`,
    "aria-hidden": "true",
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of ICONS[name]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/**
 * The node decoration a plain view uses to get itself replaced (see
 * `PlainCodeBlockView.rebuild`): a transaction carrying this meta with a block's
 * position gives that block a fresh `data-pf-view` decoration.
 */
export const codeBlockRebuildKey = new PluginKey<DecorationSet>("codeBlockViewRebuild");
let rebuildSeq = 0;

export function codeBlockRebuildPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: codeBlockRebuildKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set.map(tr.mapping, tr.doc);
        const pos = tr.getMeta(codeBlockRebuildKey) as number | undefined;
        if (typeof pos !== "number") return next;
        const node = tr.doc.nodeAt(pos);
        if (!node) return next;
        const end = pos + node.nodeSize;
        next = next.remove(next.find(pos, end, (spec) => spec["pfRebuild"] === true).filter((d) => d.from === pos));
        return next.add(tr.doc, [Decoration.node(pos, end, { "data-pf-view": String(++rebuildSeq) }, { pfRebuild: true })]);
      },
    },
    props: { decorations: (state) => codeBlockRebuildKey.getState(state) ?? null },
  });
}

/** Whether a code block renders as a diagram or score — the React card. */
export function isDiagramBlock(node: PMNode): boolean {
  const language = node.attrs["language"];
  const features = useUIStore.getState().markdownFeatures;
  return (language === "mermaid" && !!features.diagrams) || (language === "abc" && !!features.music);
}

export class PlainCodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private node: PMNode;
  private readonly button: HTMLButtonElement;
  private readonly icon: HTMLSpanElement;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.node = node;

    this.dom = document.createElement("div");
    this.dom.className = "code-block-wrapper";
    this.dom.style.whiteSpace = "normal";

    const copyWrapper = document.createElement("div");
    copyWrapper.className = "code-block-copy-wrapper";
    copyWrapper.setAttribute("contenteditable", "false");
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "code-block-copy-button";
    this.icon = document.createElement("span");
    this.icon.className = "code-block-copy-icon";
    this.icon.appendChild(lucideIcon("copy"));
    this.button.appendChild(this.icon);
    this.button.addEventListener("click", () => void this.copy());
    copyWrapper.appendChild(this.button);

    const pre = document.createElement("pre");
    this.contentDOM = document.createElement("code");
    this.contentDOM.style.whiteSpace = "pre-wrap";
    pre.appendChild(this.contentDOM);
    this.dom.append(copyWrapper, pre);

    this.label();
    this.unsubscribe.push(subscribeLocale(() => this.label()));
    // Turning diagrams or music ON must turn an existing mermaid/abc block into
    // its card, as the React view did by re-rendering. A node view cannot swap
    // itself, so it asks ProseMirror for a new one (see rebuild).
    this.unsubscribe.push(
      useUIStore.subscribe((state, prev) => {
        if (state.markdownFeatures !== prev.markdownFeatures && isDiagramBlock(this.node)) this.rebuild();
      }),
    );
  }

  private label(): void {
    const label = t("panes.copyCode");
    this.button.setAttribute("aria-label", label);
    this.button.title = label;
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.node.textContent);
      this.showCopied(true);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.showCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  }

  private showCopied(copied: boolean): void {
    this.button.classList.toggle("copied", copied);
    this.icon.replaceChildren(lucideIcon(copied ? "check" : "copy"));
  }

  /**
   * Ask ProseMirror for a new view. Re-setting the node's attributes does not
   * work: an identical node matches this view structurally and `update` is
   * never called. A changed node DECORATION does call it — `update` then
   * declines a block that is now a diagram, and ProseMirror comes back to the
   * factory. The transaction changes no content: no edit, no undo step, no sync.
   */
  private rebuild(): void {
    if (this.view.composing) return;
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    this.view.dispatch(this.view.state.tr.setMeta(codeBlockRebuildKey, pos));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || isDiagramBlock(node)) return false;
    this.node = node;
    return true;
  }

  /** The Copy button handles its own events; ProseMirror must not move the
   *  selection for them. */
  stopEvent(event: Event): boolean {
    const target = event.target as Node | null;
    return !!target && this.dom.contains(target) && !this.contentDOM.contains(target);
  }

  /** Only the code is document content; the button's icon swap and its label
   *  are not, and ProseMirror must not re-read them as an edit. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    for (const off of this.unsubscribe) off();
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
  }
}
