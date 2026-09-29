import { Extension } from "@tiptap/core";
import "@tiptap/extension-text-style";

export interface BackgroundColorOptions {
  /** Node/mark types the backgroundColor attribute is applied to. */
  types: string[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    backgroundColor: {
      /** Set a text background color (rendered as `<span style="background-color: …">`). */
      setBackgroundColor: (backgroundColor: string) => ReturnType;
      /** Remove the text background color. */
      unsetBackgroundColor: () => ReturnType;
    };
  }
}

/**
 * BackgroundColor — adds a `backgroundColor` attribute to the `textStyle` mark,
 * mirroring the official `Color` extension (which does the same for `color`).
 *
 * This is the canonical representation for text highlighting in this editor:
 * both panes serialize to `<span style="background-color: …">`, which the
 * existing `styledElementsInline` Turndown rule preserves through the
 * HTML→Markdown round-trip. (The `<mark>`-based Highlight extension had no
 * matching Turndown rule, so highlights were silently dropped on save.)
 */
export const BackgroundColor = Extension.create<BackgroundColorOptions>({
  name: "backgroundColor",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element) =>
              element.style.backgroundColor?.replace(/['"]+/g, "") || null,
            renderHTML: (attributes) => {
              if (!attributes["backgroundColor"]) return {};
              return {
                style: `background-color: ${attributes["backgroundColor"]}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBackgroundColor:
        (backgroundColor) =>
        ({ chain }) =>
          chain().setMark("textStyle", { backgroundColor }).run(),
      unsetBackgroundColor:
        () =>
        ({ chain }) =>
          chain()
            .setMark("textStyle", { backgroundColor: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});
