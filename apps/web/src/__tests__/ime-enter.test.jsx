/**
 * Enter during an IME composition (Japanese, Chinese, Korean) confirms the
 * input method's candidate — it must never submit, rename or close anything.
 * Every Enter handler on a text field guards with `isImeComposing()`.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { isImeComposing } from "../ui/shared/utils/ime";
import { PromptDialog } from "../ui/dialogs";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

describe("isImeComposing", () => {
  it("is true while the native event is composing (Chrome, Firefox)", () => {
    expect(isImeComposing(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }))).toBe(true);
  });

  it("is true for keyCode 229 — Safari's confirming keydown, after compositionend", () => {
    expect(isImeComposing(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }))).toBe(true);
  });

  it("is false for an ordinary Enter", () => {
    expect(isImeComposing(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13 }))).toBe(false);
  });

  it("reads React's synthetic event through nativeEvent", () => {
    const nativeEvent = new KeyboardEvent("keydown", { key: "Enter", isComposing: true });
    expect(isImeComposing({ key: "Enter", nativeEvent })).toBe(true);
  });
});

describe("a text field's Enter during composition", () => {
  function renderPrompt() {
    const onConfirm = vi.fn();
    render(
      <PromptDialog open title="Rename" defaultValue="にほん" onConfirm={onConfirm} onCancel={() => {}} />,
    );
    return { onConfirm, input: screen.getByRole("textbox") };
  }

  it("does not submit while the input method is composing", () => {
    const { onConfirm, input } = renderPrompt();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("still submits on Enter once the composition has ended", () => {
    const { onConfirm, input } = renderPrompt();
    fireEvent.change(input, { target: { value: "日本" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    expect(onConfirm).toHaveBeenCalledWith("日本");
  });
});

describe("every text-field Enter handler checks for composition", () => {
  // [file, number of guarded Enter handlers]. A new Enter handler on a text
  // field must call isImeComposing() too — or be added here once it does.
  const HANDLERS = [
    ["src/ui/workspace/folderTree/index.tsx", 2],
    ["src/ui/workspace/workspacePanel/index.tsx", 1],
    ["src/ui/dialogs/index.tsx", 1],
    ["src/ui/dialogs/confirmDialog/index.tsx", 1],
    ["src/ui/find/searchPanel/index.tsx", 1],
    ["src/ui/find/findReplace/index.tsx", 2],
    ["src/ui/importExport/urlImportDialog/index.tsx", 1],
    ["src/ui/graph/graphView/index.tsx", 1],
    ["src/ui/cards/cardsView/index.tsx", 1],
    ["src/extensions/MathNodes.tsx", 1],
    ["src/ui/diagnostics/consolePanel/index.tsx", 1],
  ];

  it.each(HANDLERS)("%s", (file, count) => {
    const src = read(file);
    expect(src).toMatch(/import \{ isImeComposing \} from "[^"]*ui\/shared\/utils\/ime"/);
    expect(src.match(/isImeComposing\(e\)/g)?.length ?? 0).toBe(count);
  });
});
