/**
 * The toolbar's Save button after "Storage full" (A086).
 *
 * A save refused for lack of space parks the terminal `full` status, so
 * autosave stops retrying. The Save button is how a user retries once they have
 * made room; it used to be enabled only for `editing`/`error`, which left no way
 * to try again from the toolbar at the one moment it mattered.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DialogProvider } from "../ui/dialogs/dialogProvider";
import { EditorToolbar } from "../ui/chrome/toolbar";

const dialogApi = { confirm: async () => true, prompt: async () => null, equation: async () => null, confirmUnsaved: async () => "cancel" };

async function saveButton(saveStatus) {
  await act(async () => {
    render(
      <DialogProvider value={dialogApi}>
        <TooltipProvider>
          <EditorToolbar
            toast={{ show: vi.fn() }} dispatch={vi.fn()} updateFormats={vi.fn()} setFocusedPane={vi.fn()}
            toggleFindReplace={vi.fn()} saveStatus={saveStatus} onSave={vi.fn()} mode="split"
          />
        </TooltipProvider>
      </DialogProvider>
    );
    await Promise.resolve();
  });
  return screen.getByRole("button", { name: "Save" });
}

afterEach(cleanup);

describe("toolbar Save", () => {
  it("can retry a save refused because storage was full", async () => {
    expect((await saveButton("full")).disabled).toBe(false);
  });

  it.each(["saved", "conflict", "blocked"])("stays disabled while %s", async (status) => {
    expect((await saveButton(status)).disabled).toBe(true);
  });
});
