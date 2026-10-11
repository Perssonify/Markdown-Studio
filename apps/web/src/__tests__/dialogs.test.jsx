import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useConfirm, useUnsavedChangesConfirm } from "../ui/dialogs/confirmDialog/index.tsx";
import { useDialog, DialogProvider } from "../ui/dialogs/dialogProvider/index.tsx";
import { useDialogs } from "../hooks/useDialogs.ts";

/**
 * Covers the consolidated dialog surface: the underlying hooks resolve correctly,
 * and the useDialog() context requires a provider. These paths were previously
 * only exercised by manual/browser testing.
 */

function ConfirmHarness({ onResult }) {
  const { confirm, ConfirmDialog } = useConfirm();
  return (
    <>
      <button onClick={async () => onResult(await confirm({ title: "Delete this?", description: "d", destructive: true }))}>
        open
      </button>
      {ConfirmDialog}
    </>
  );
}

describe("useConfirm", () => {
  it("resolves true when confirmed and false when cancelled", async () => {
    const results = [];
    render(<ConfirmHarness onResult={(r) => results.push(r)} />);

    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByText("Delete this?"));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(results).toEqual([true]));

    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByText("Delete this?"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(results).toEqual([true, false]));
  });
});

function UnsavedHarness({ onResult }) {
  const { confirmUnsaved, UnsavedChangesDialog } = useUnsavedChangesConfirm();
  return (
    <>
      <button onClick={async () => onResult(await confirmUnsaved())}>ask</button>
      {UnsavedChangesDialog}
    </>
  );
}

describe("useUnsavedChangesConfirm", () => {
  it("resolves 'discard' / 'save'", async () => {
    const results = [];
    render(<UnsavedHarness onResult={(r) => results.push(r)} />);

    fireEvent.click(screen.getByText("ask"));
    await waitFor(() => screen.getByText(/unsaved changes/i));
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    await waitFor(() => expect(results).toEqual(["discard"]));

    fireEvent.click(screen.getByText("ask"));
    await waitFor(() => screen.getByText(/unsaved changes/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(results).toEqual(["discard", "save"]));
  });
});

function EquationHooksHarness({ onResult }) {
  const { equation, equationState, handleEquationClose } = useDialogs();
  return (
    <>
      <button onClick={async () => onResult(await equation("Insert Formula", { display: "block" }))}>eq</button>
      <span data-testid="eq-open">{String(equationState.open)}</span>
      <span data-testid="eq-display">{equationState.display}</span>
      <button onClick={() => handleEquationClose("E=mc^2")}>resolve</button>
      <button onClick={() => handleEquationClose(null)}>cancel</button>
    </>
  );
}

describe("useDialogs equation", () => {
  it("opens with the requested display and resolves the LaTeX or null", async () => {
    const results = [];
    render(<EquationHooksHarness onResult={(r) => results.push(r)} />);

    fireEvent.click(screen.getByText("eq"));
    await waitFor(() => expect(screen.getByTestId("eq-open").textContent).toBe("true"));
    expect(screen.getByTestId("eq-display").textContent).toBe("block");
    fireEvent.click(screen.getByText("resolve"));
    await waitFor(() => expect(results).toEqual(["E=mc^2"]));

    fireEvent.click(screen.getByText("eq"));
    await waitFor(() => expect(screen.getByTestId("eq-open").textContent).toBe("true"));
    fireEvent.click(screen.getByText("cancel"));
    await waitFor(() => expect(results).toEqual(["E=mc^2", null]));
  });
});

describe("useDialog context", () => {
  it("throws when used outside a DialogProvider", () => {
    const Bad = () => {
      useDialog();
      return null;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/DialogContext/);
    spy.mockRestore();
  });

  it("provides the api value to consumers", () => {
    const api = { confirm: vi.fn(), prompt: vi.fn(), equation: vi.fn(), confirmUnsaved: vi.fn() };
    let received = null;
    const Consumer = () => {
      received = useDialog();
      return null;
    };
    act(() => {
      render(
        <DialogProvider value={api}>
          <Consumer />
        </DialogProvider>
      );
    });
    expect(received).toBe(api);
  });
});
