/**
 * The crash screen must leave the user a way out (A009) and must not reload
 * blindly (A008 / A085).
 *
 * It used to offer one button ("Recover Editor") and console.error the crash:
 * nothing a user could send, no way to get their documents out if recovery kept
 * failing, and a lazy chunk that could not be downloaded looked like a bug.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/emergency-backup", () => ({ exportEmergencyBackup: vi.fn(async () => 3) }));

import { ErrorBoundary } from "../ui/ErrorBoundary";
import { exportEmergencyBackup } from "../utils/emergency-backup";
import { CHUNK_RELOAD_KEY, pageActions } from "../utils/app-health";
import { _resetDiagnosticsForTests, getDiagnostics } from "../utils/diagnostics";
import { useDocumentStore } from "../store/documents/documentStore";

const realReload = pageActions.reload;
let onLine = true;

function Boom({ error }) {
  throw error;
}
// React rethrows caught render errors for the dev overlay; cancelling the
// window error event keeps jsdom from printing each one as uncaught.
const quiet = (e) => e.preventDefault();

beforeEach(() => {
  window.addEventListener("error", quiet);
  sessionStorage.clear();
  localStorage.clear();
  _resetDiagnosticsForTests();
  onLine = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
  vi.spyOn(console, "error").mockImplementation(() => {});
  pageActions.reload = vi.fn();
  useDocumentStore.setState({ saveStatus: "ready", _unsavedEdits: new Map() });
});
afterEach(() => {
  window.removeEventListener("error", quiet);
  vi.restoreAllMocks();
  pageActions.reload = realReload;
});

describe("ErrorBoundary — a render crash", () => {
  it("shows the way out: recover, export my documents, copy diagnostics", () => {
    render(
      <ErrorBoundary>
        <Boom error={new TypeError("Cannot read properties of undefined (reading 'type')")} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Editor Crashed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recover Editor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export my documents/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();
    expect(pageActions.reload).not.toHaveBeenCalled();
  });

  it("records the crash and hands the redacted entry to onError", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom error={new TypeError('Bad node in "Private journal"')} />
      </ErrorBoundary>,
    );
    const [entry] = getDiagnostics();
    expect(entry).toMatchObject({ kind: "render", name: "TypeError" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).not.toMatch(/Private journal/);
    expect(onError.mock.calls[0][1]).toBeInstanceOf(TypeError);
  });

  it("Export my documents builds the backup and says how many", async () => {
    render(
      <ErrorBoundary>
        <Boom error={new Error("x")} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Export my documents/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Exported 3 documents"));
    expect(exportEmergencyBackup).toHaveBeenCalledTimes(1);
  });

  it("Copy diagnostics copies a redacted report", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <ErrorBoundary>
        <Boom error={new Error('Parse failed on "Salary negotiation notes"')} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy diagnostics/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const report = writeText.mock.calls[0][0];
    expect(report).toContain("Markdown Studio diagnostics");
    expect(report).toContain("[render] Error");
    expect(report).not.toContain("Salary negotiation notes");
  });
});

describe("ErrorBoundary — a chunk that could not be downloaded", () => {
  const chunkError = () => new TypeError("Failed to fetch dynamically imported module: https://markdownstudio.com/assets/GraphView-x.js");

  it("offline: says so, does not reload, offers Reload (not Recover)", () => {
    onLine = false;
    render(
      <ErrorBoundary>
        <Boom error={chunkError()} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Part of the app couldn't load")).toBeInTheDocument();
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
    expect(pageActions.reload).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Recover Editor/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Reload$/ }));
    expect(pageActions.reload).not.toHaveBeenCalled(); // still offline
  });

  it("online with unsaved work: waits for the user", () => {
    useDocumentStore.setState({ saveStatus: "editing" });
    render(
      <ErrorBoundary>
        <Boom error={chunkError()} />
      </ErrorBoundary>,
    );
    expect(pageActions.reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Reload$/ }));
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
  });

  it("online and clean: reloads once by itself", () => {
    render(
      <ErrorBoundary>
        <Boom error={chunkError()} />
      </ErrorBoundary>,
    );
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    expect(getDiagnostics()[0]).toMatchObject({ kind: "chunk" });
  });
});
