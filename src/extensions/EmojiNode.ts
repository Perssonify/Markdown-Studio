import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { EMOJI_MAP } from "../engine/emoji-map";
import { emojiSuggestionPlugin } from "./emoji-suggestion";

/**
 * Inline emoji node. Preserves the `:shortcode:` across the canonical round-trip
 * (the glyph is displayed, but `data-emoji` carries the name so turndown restores
 * `:name:`). Without this node, marked's `<span data-emoji>` would be flattened
 * to a bare unicode glyph by the ProseMirror schema. An input rule also converts
 * `:name:` typed directly in the rich pane.
 */
export const EmojiNode = Node.create({
  name: "emoji",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-emoji") || "",
        renderHTML: (attrs) => ({ "data-emoji": attrs["name"] }),
      },
      char: {
        default: "",
        parseHTML: (el) => el.textContent || "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-emoji]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes),
      node.attrs["char"] || `:${node.attrs["name"]}:`,
    ];
  },

  addProseMirrorPlugins() {
    return [emojiSuggestionPlugin(() => this.type)];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /:([a-zA-Z0-9_+-]+):$/,
        handler: ({ state, range, match }) => {
          const name = match[1] ?? "";
          const char = EMOJI_MAP[name];
          if (!char) return null;
          state.tr.replaceRangeWith(
            range.from,
            range.to,
            this.type.create({ name, char })
          );
          return undefined;
        },
      }),
    ];
  },
});
