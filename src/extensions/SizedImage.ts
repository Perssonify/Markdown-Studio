import { Image } from "@tiptap/extension-image";

/**
 * The stock TipTap Image node drops width/height, so there's no way to show an
 * image at a controlled size (e.g. a masthead logo). This keeps those attributes
 * on parse/render; the turndown `sizedImage` rule (turndown-rules.ts) serializes
 * a sized image back to an `<img …>` HTML tag so the dimensions survive the
 * Markdown round-trip (plain `![](…)` can't carry a size).
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
}).configure({ inline: true, allowBase64: true });
