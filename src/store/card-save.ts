/**
 * Saving a card replaces the whole document with what the card's markdown
 * source parses back to. Markdown (even Styled, with its inline `<span
 * style>` carrier for colour, highlight and font) has NO carrier for text
 * alignment, so a card edit used to strip every paragraph's alignment from
 * the note — including the paragraphs the edit never touched.
 *
 * This re-applies the alignment the edit could not have meant to remove: onto
 * each paragraph/heading of the new content that is textually identical to
 * an aligned one in the document being replaced (matched in order, so
 * repeated text pairs up one-to-one). Blocks the edit changed cannot be
 * matched; `lost` counts them so the caller can say so.
 */

interface PMJson {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PMJson[];
}

const ALIGNABLE = new Set(["paragraph", "heading"]);

function textOf(n: PMJson): string {
  if (n.type === "text") return n.text ?? "";
  return (n.content ?? []).map(textOf).join("");
}

function keyOf(n: PMJson): string {
  const level = n.type === "heading" ? String(n.attrs?.["level"] ?? "") : "";
  return `${n.type}\u0000${level}\u0000${textOf(n)}`;
}

function alignmentOf(n: PMJson): string | null {
  const a = n.attrs?.["textAlign"];
  return typeof a === "string" && a && a !== "left" ? a : null;
}

export function carryBlockAttrs(prev: unknown, next: unknown): { doc: unknown; lost: number } {
  const queues = new Map<string, string[]>();
  let aligned = 0;
  const collect = (n: PMJson) => {
    if (!n || typeof n !== "object") return;
    if (n.type && ALIGNABLE.has(n.type)) {
      const align = alignmentOf(n);
      if (align) {
        aligned++;
        const k = keyOf(n);
        const q = queues.get(k);
        if (q) q.push(align); else queues.set(k, [align]);
      }
    }
    (n.content ?? []).forEach(collect);
  };
  collect(prev as PMJson);
  if (!aligned) return { doc: next, lost: 0 };

  let restored = 0;
  const apply = (n: PMJson): PMJson => {
    if (!n || typeof n !== "object") return n;
    let out = n;
    if (n.type && ALIGNABLE.has(n.type) && !alignmentOf(n)) {
      const q = queues.get(keyOf(n));
      if (q && q.length) {
        restored++;
        out = { ...n, attrs: { ...n.attrs, textAlign: q.shift() } };
      }
    }
    return out.content ? { ...out, content: out.content.map(apply) } : out;
  };
  return { doc: apply(next as PMJson), lost: aligned - restored };
}
