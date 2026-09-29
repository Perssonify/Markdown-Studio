import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface CodeBlockCopyButtonProps {
  code: string;
}

export function CodeBlockCopyButton({ code }: CodeBlockCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  return (
    <div className="code-block-copy-wrapper" contentEditable={false}>
      <button
        type="button"
        className={`code-block-copy-button ${copied ? "copied" : ""}`}
        onClick={handleCopy}
        aria-label="Copy code"
        title="Copy code"
      >
        <span className="code-block-copy-icon">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </span>
      </button>
    </div>
  );
}
