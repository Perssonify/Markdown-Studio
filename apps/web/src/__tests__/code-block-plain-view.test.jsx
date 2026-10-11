import { Editor as CoreEditor } from "@tiptap/core";
import { EditorContent, Editor as ReactEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Copy, Check } from "lucide-react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlockWithCopy } from "../ui/panes/codeBlockWithCopy";
import { lucideIcon } from "../ui/panes/codeBlockWithCopy/code-block-plain-view";
import { useUIStore } from "../store/preferences/uiStore";

/**
 * A083: an ordinary code block is a PLAIN DOM node view — a React node view per
 * block made opening a document quadratic in its code blocks. Diagrams and
 * scores stay React. What the React view did, the plain one must still do:
 * the same markup the stylesheet keys on, a working Copy button that is not
 * document content, and turning into a diagram card when it should.
 */

const extensions = () => [StarterKit.configure({ codeBlock: false }), CodeBlockWithCopy];
const CODE = '<pre><code class="language-js">const a = 1;</code></pre>';
const MERMAID = '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>';
const FEATURES = useUIStore.getState().markdownFeatures;
const setFeatures = (patch) => useUIStore.setState({ markdownFeatures: { ...useUIStore.getState().markdownFeatures, ...patch } });

let editor;
afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
  useUIStore.setState({ markdownFeatures: FEATURES });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("an ordinary code block", () => {
  beforeEach(() => {
    editor = new CoreEditor({ extensions: extensions(), content: `<p>before</p>${CODE}<p>after</p>` });
  });
  const q = (sel) => editor.view.dom.querySelector(sel);

  it("renders the markup the stylesheet keys on, without React", () => {
    const wrapper = q(".code-block-wrapper");
    expect(wrapper).not.toBeNull();
    expect(wrapper.closest(".react-renderer")).toBeNull();
    const copyWrapper = wrapper.querySelector(":scope > .code-block-copy-wrapper");
    expect(copyWrapper.getAttribute("contenteditable")).toBe("false");
    const button = copyWrapper.querySelector("button.code-block-copy-button");
    expect(button.getAttribute("aria-label")).toBe("Copy code");
    expect(button.title).toBe("Copy code");
    expect(wrapper.querySelector(":scope > pre > code").textContent).toBe("const a = 1;");
    // The document itself is untouched by the view.
    expect(editor.getHTML()).toContain('<pre class="perssonify-code-block"><code class="language-js">const a = 1;</code></pre>');
  });

  it("copies the CURRENT code, shows it was copied, then resets", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    // Edit the code first: the button must copy what is there now.
    const codeStart = editor.state.doc.child(0).nodeSize + 1;
    editor.commands.insertContentAt(codeStart, "let b = 2;\n");
    const button = q(".code-block-copy-button");
    button.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("let b = 2;\nconst a = 1;"));
    await vi.waitFor(() => expect(button.classList.contains("copied")).toBe(true));
    expect(button.querySelector("svg").getAttribute("class")).toBe("lucide lucide-check");
    vi.advanceTimersByTime(2000);
    expect(button.classList.contains("copied")).toBe(false);
    expect(button.querySelector("svg").getAttribute("class")).toBe("lucide lucide-copy");
  });

  it("the button's own changes are not document edits", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const updates = vi.fn();
    editor.on("update", updates);
    const html = editor.getHTML();
    q(".code-block-copy-button").click();
    await vi.waitFor(() => expect(q(".code-block-copy-button").classList.contains("copied")).toBe(true));
    // Let ProseMirror's DOM observer see the icon swap.
    await new Promise((r) => setTimeout(r, 30));
    editor.view.domObserver?.flush?.();
    expect(updates).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe(html);
  });

  it("ProseMirror leaves the button's events alone, but not the code's", () => {
    const button = q(".code-block-copy-button");
    const code = q(".code-block-wrapper pre > code");
    const ev = (target) => {
      const e = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(e, "target", { value: target });
      return e;
    };
    // The NodeViewDesc delegates stopEvent to our view.
    const desc = editor.view.docView.children.find((c) => c.dom?.classList?.contains("code-block-wrapper"));
    expect(desc.stopEvent(ev(button))).toBe(true);
    expect(desc.stopEvent(ev(code))).toBe(false);
  });
});

describe("becoming a diagram", () => {
  // The card is the first React node view of the file, and mounting it pulls in
  // the diagram preview's lazy imports cold: under a loaded full-suite run that
  // took longer than vitest's 5 s per test. Each test states its own budget.
  const CARD_BUDGET = { timeout: 15000 };
  const TEST_BUDGET = 20000;
  function mountReact(content) {
    editor = new ReactEditor({ extensions: extensions(), content });
    render(<EditorContent editor={editor} />);
    return (sel) => editor.view.dom.querySelector(sel);
  }

  it("a mermaid block is a React diagram card from the start", async () => {
    const q = mountReact(MERMAID);
    await vi.waitFor(() => expect(q(".diagram-frame")).not.toBeNull(), CARD_BUDGET);
    expect(q(".react-renderer")).not.toBeNull();
  }, TEST_BUDGET);

  it("changing the language to mermaid swaps the plain view for the card", async () => {
    const q = mountReact(CODE);
    expect(q(".diagram-frame")).toBeNull();
    // updateAttributes acts on the block holding the selection: put it there.
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.updateAttributes("codeBlock", { language: "mermaid" });
    });
    await vi.waitFor(() => expect(q(".diagram-frame")).not.toBeNull(), CARD_BUDGET);
  }, TEST_BUDGET);

  it("turning diagrams ON turns an existing mermaid block into its card — no edit, no undo step", async () => {
    setFeatures({ diagrams: false });
    // Ends in a paragraph, so StarterKit's trailing-node plugin has nothing to add.
    const q = mountReact(MERMAID + "<p>after</p>");
    expect(q(".diagram-frame")).toBeNull();
    expect(q(".code-block-wrapper")).not.toBeNull();
    const updates = vi.fn();
    editor.on("update", updates);
    const html = editor.getHTML();
    act(() => setFeatures({ diagrams: true }));
    await vi.waitFor(() => expect(q(".diagram-frame")).not.toBeNull(), CARD_BUDGET);
    expect(editor.getHTML()).toBe(html);
    expect(updates).not.toHaveBeenCalled();
    expect(editor.can().undo()).toBe(false);
  }, TEST_BUDGET);
});

describe("the icons match lucide-react's", () => {
  const shape = (el) => ({
    tag: el.tagName.toLowerCase(),
    attrs: Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]).sort()),
    children: [...el.children].map(shape),
  });
  it.each([["copy", Copy], ["check", Check]])("%s", (name, Icon) => {
    const { container } = render(<Icon size={14} />);
    expect(shape(lucideIcon(name))).toEqual(shape(container.querySelector("svg")));
  });
});
