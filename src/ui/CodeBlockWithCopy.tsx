import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Check, Pencil } from "lucide-react";
import { useState } from "react";
import { useUIStore } from "../store/uiStore";
import { CodeBlockCopyButton } from "./CodeBlockCopyButton";
import { DiagramPreview } from "./DiagramPreview";
import { common, createLowlight } from "lowlight";
import { useT } from "../i18n";

interface CodeBlockComponentProps {
  node: {
    textContent: string;
    attrs: {
      language?: string;
    };
  };
  editor?: { isEditable?: boolean };
  updateAttributes: (attrs: Record<string, any>) => void;
  extension: {
    options: {
      lowlight: any;
    };
  };
}

function CodeBlockComponent({ node, editor }: CodeBlockComponentProps) {
  const t = useT();
  const features = useUIStore((s) => s.markdownFeatures);
  const language = node.attrs.language;
  const showDiagram =
    (language === "mermaid" && features.diagrams) ||
    (language === "abc" && features.music);
  const editable = editor?.isEditable ?? true;
  const [editing, setEditing] = useState(false);

  // Plain code block (or diagram feature off) — unchanged: source + copy.
  if (!showDiagram) {
    return (
      <NodeViewWrapper className="code-block-wrapper">
        <CodeBlockCopyButton code={node.textContent} />
        <pre>
          <NodeViewContent as={"code" as "div"} />
        </pre>
      </NodeViewWrapper>
    );
  }

  // Diagram / music — one cohesive framed card (like the LaTeX nodes): a header
  // with a label + Edit/Copy, the rendered output, and — while editing — the
  // source right above a live "Preview" so both read as a single surface. The
  // <pre> (ProseMirror-managed content) always stays MOUNTED, only hidden via a
  // class, so the fenced-code round-trip to Markdown is untouched; the preview
  // reads the live node text and re-renders as you type.
  const label = language === "abc" ? t("panes.musicScore") : t("panes.diagram");
  return (
    <NodeViewWrapper
      className={`code-block-wrapper diagram-block${editing ? " is-editing" : ""}`}
      data-editing={editing || undefined}
    >
      <div className="diagram-frame">
        <div className="diagram-header" contentEditable={false}>
          <span className="diagram-label">
            {label} · <span className="diagram-lang">{language}</span>
          </span>
          <span className="diagram-actions">
            {editable && (
              <button
                type="button"
                className={`diagram-edit-toggle ${editing ? "active" : ""}`}
                onClick={() => setEditing((v) => !v)}
                aria-pressed={editing}
                title={editing ? t("panes.finishEditing") : t("panes.editSource")}
              >
                {editing ? <Check size={13} /> : <Pencil size={13} />}
                <span>{editing ? t("common.done") : t("common.edit")}</span>
              </button>
            )}
            <CodeBlockCopyButton code={node.textContent} />
          </span>
        </div>
        <pre className={editing ? "diagram-source" : "diagram-source is-hidden"}>
          <NodeViewContent as={"code" as "div"} />
        </pre>
        <div
          className="diagram-render"
          onDoubleClick={editable && !editing ? () => setEditing(true) : undefined}
          title={editable && !editing ? t("panes.doubleClickToEditSource") : undefined}
        >
          {editing && <div className="diagram-preview-label" contentEditable={false}>{t("panes.livePreview")}</div>}
          <DiagramPreview code={node.textContent} language={language!} />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// Create lowlight instance
const lowlight = createLowlight(common);

export const CodeBlockWithCopy = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent);
  },
}).configure({
  lowlight,
  HTMLAttributes: {
    class: "perssonify-code-block",
  },
});
