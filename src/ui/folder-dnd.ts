import type { DragEvent as ReactDragEvent } from "react";

/** Custom MIME used to carry a folder-tree item through an HTML5 drag. */
export const DND_MIME = "application/x-perssonify-item";

export type DragPayload = { kind: "doc" | "folder"; id: string };

export function setDragPayload(e: ReactDragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}

/** Read the payload — only valid in `drop`/`dragstart`, not `dragover`. */
export function getDragPayload(e: ReactDragEvent): DragPayload | null {
  try {
    return JSON.parse(e.dataTransfer.getData(DND_MIME)) as DragPayload;
  } catch {
    return null;
  }
}

/**
 * Whether the current drag carries one of our items. During `dragover`/`dragenter`
 * the browser runs the DataTransfer in "protected mode": `getData()` returns an
 * empty string and only `types` is readable. So drop targets must decide whether
 * to `preventDefault()` (i.e. accept the drop) by inspecting `types` — reading the
 * payload here would always fail and the element would never become a valid drop
 * target. The real payload is read in `onDrop`, where `getData()` works again.
 */
export function hasDragItem(e: ReactDragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DND_MIME);
}

export type DropZone = "before" | "after" | "into";

/**
 * Classify where a drop would land on a row from the pointer's vertical position.
 * When `allowInto` (folders), the middle band means "move into"; the top/bottom
 * quarters mean reorder before/after. Otherwise (docs) the row splits in half.
 */
export function computeDropZone(
  e: ReactDragEvent,
  el: HTMLElement,
  allowInto: boolean
): DropZone {
  const r = el.getBoundingClientRect();
  const y = e.clientY - r.top;
  const h = r.height || 1;
  if (allowInto) {
    if (y < h * 0.28) return "before";
    if (y > h * 0.72) return "after";
    return "into";
  }
  return y < h / 2 ? "before" : "after";
}

/** Reinsert `draggedId` relative to `targetId` within an ordered id list. */
export function spliceOrder(
  ids: string[],
  draggedId: string,
  targetId: string,
  pos: "before" | "after"
): string[] {
  const without = ids.filter((id) => id !== draggedId);
  const ti = without.indexOf(targetId);
  if (ti < 0) return [...without, draggedId];
  without.splice(pos === "before" ? ti : ti + 1, 0, draggedId);
  return without;
}
