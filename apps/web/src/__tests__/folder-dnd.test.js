import { describe, it, expect } from "vitest";
import {
  DND_MIME,
  getDragPayload,
  hasDragItem,
} from "../ui/workspace/folderTree/folder-dnd.ts";

/**
 * Regression guard for the folder-tree drag-and-drop.
 *
 * The bug: drop targets decided whether to accept a drop by trying to read the
 * payload with `getData()` inside `onDragOver`. But during `dragover` the browser
 * runs the DataTransfer in "protected mode" — `getData()` returns "" and only
 * `types` is readable — so `preventDefault()` was never called and no drop ever
 * fired in a real browser. The fix inspects `types` via `hasDragItem`.
 */
describe("folder drag-and-drop acceptance", () => {
  it("accepts our items during dragover even in protected mode (getData returns '')", () => {
    const protectedDragover = {
      dataTransfer: { types: [DND_MIME], getData: () => "" },
    };
    expect(hasDragItem(protectedDragover)).toBe(true);
  });

  it("does not rely on getData during dragover", () => {
    let getDataCalled = false;
    const e = {
      dataTransfer: {
        types: [DND_MIME],
        getData: () => {
          getDataCalled = true;
          return "";
        },
      },
    };
    hasDragItem(e);
    expect(getDataCalled).toBe(false);
  });

  it("ignores foreign drags (files, plain text)", () => {
    expect(
      hasDragItem({ dataTransfer: { types: ["text/plain", "Files"], getData: () => "x" } })
    ).toBe(false);
  });

  it("reads the real payload on drop, where getData works", () => {
    const payload = { kind: "doc", id: "doc-123" };
    const dropEvent = {
      dataTransfer: {
        types: [DND_MIME],
        getData: (t) => (t === DND_MIME ? JSON.stringify(payload) : ""),
      },
    };
    expect(getDragPayload(dropEvent)).toEqual(payload);
  });

  it("returns null for an unreadable/empty payload", () => {
    expect(getDragPayload({ dataTransfer: { getData: () => "" } })).toBeNull();
  });
});
