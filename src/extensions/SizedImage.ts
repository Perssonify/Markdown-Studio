import { Image } from "@tiptap/extension-image";
import { AssetImageView } from "./AssetImages";

/**
 * The stock TipTap Image node drops width/height, so there's no way to show an
 * image at a controlled size (e.g. a masthead logo). This keeps those attributes
 * on parse/render; the turndown `sizedImage` rule (turndown-rules.ts) serializes
 * a sized image back to an `<img …>` HTML tag so the dimensions survive the
 * Markdown round-trip (plain `![](…)` can't carry a size).
 *
 * The node view shows images stored as assets (`pf-asset:` sources, A086)
 * through an object URL — see AssetImages.ts. `renderHTML` is unchanged, so
 * the HTML and markdown the document serialises to still carry the reference.
 */
export const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute("width"),
        renderHTML: (attrs) => (attrs["width"] ? { width: attrs["width"] } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => el.getAttribute("height"),
        renderHTML: (attrs) => (attrs["height"] ? { height: attrs["height"] } : {}),
      },
    };
  },
  addNodeView() {
    if (typeof document === "undefined") return null;
    return ({ node }) => new AssetImageView(node);
  },
}).configure({ inline: true, allowBase64: true });
