/**
 * "Link to heading" inserts the heading's words, not markup made of them.
 *
 * The rich-pane `[[#Heading]]` link was built by interpolating the raw heading
 * text into HTML, so a heading such as `Use <b> tags` inserted bold text (and
 * `<img …>` an image) instead of a link reading exactly that.
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { WikiLink } from "../extensions/WikiLink";
import { headingLinkHtml } from "../formatting/heading-link";

describe("headingLinkHtml", () => {
  it("links to the heading with its text as text", () => {
    const heading = 'Use <b> & "quotes" <img src=x>';
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), WikiLink],
      content: "<p></p>",
    });
    editor.chain().focus().insertContent(headingLinkHtml(heading)).run();
    const para = editor.getJSON().content[0];
    expect(para.content).toHaveLength(1);
    const [node] = para.content;
    expect(node.type).toBe("text");
    expect(node.text).toBe(heading);
    const link = node.marks.find((m) => m.type === "link");
    expect(link).toBeTruthy();
    // The anchor attribute carries the exact heading text too.
    expect(Object.values(link.attrs)).toContain(heading);
    editor.destroy();
  });
});
