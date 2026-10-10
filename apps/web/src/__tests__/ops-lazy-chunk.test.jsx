/**
 * LazyChunkBoundary must not swallow render errors or reload blindly (A009,
 * A085).
 *
 * It treated every error in a lazy subtree as a stale chunk: it reloaded the
 * page (online or not, unsaved work or not) and rendered nothing, so a real bug
 * in Find & Replace vanished without a trace and ⌘F offline reloaded the tab.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LazyChunkBoundary } from "../ui/shared/lazyChunkBoundary";
import { pageActions } from "../utils/app-health";
import { _resetDiagnosticsForTests, getDiagnostics } from "../utils/diagnostics";
import { useDocumentStore } from "../store/documents/documentStore";

const realReload = pageActions.reload;
let onLine = true;
let shouldThrow = null;

function Panel() {
  if (shouldThrow) throw shouldThrow;
  return <div>panel content</div>;
}

const chunkError = () => new TypeError("Failed to fetch dynamically imported module: https://markdownstudio.com/assets/FindReplace-x.js");
// React rethrows caught render errors for the dev overlay; cancelling the
// window error event keeps jsdom from printing each one as uncaught.
const quiet = (e) => e.preventDefault();

beforeEach(() => {
  window.addEventListener("error", quiet);
  sessionStorage.clear();
  localStorage.clear();
  _resetDiagnosticsForTests();
  onLine = true;
  shouldThrow = null;
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

describe("a genuine render error", () => {
  it("is shown and recorded — never answered with a reload", () => {
    shouldThrow = new TypeError("Cannot read properties of null (reading 'view')");
    render(
      <LazyChunkBoundary label="Find & Replace">
        <Panel />
      </LazyChunkBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Find & Replace ran into an error");
    expect(alert).toHaveTextContent("Cannot read properties of null");
    expect(pageActions.reload).not.toHaveBeenCalled();
    expect(getDiagnostics()[0]).toMatchObject({ kind: "render", name: "TypeError" });
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();
  });

  it("Try again remounts the panel", () => {
    shouldThrow = new Error("transient");
    render(
      <LazyChunkBoundary>
        <Panel />
      </LazyChunkBoundary>,
    );
    shouldThrow = null;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(screen.getByText("panel content")).toBeInTheDocument();
  });
});

describe("a chunk that could not be downloaded", () => {
  it("offline: explains, and does not reload", () => {
    onLine = false;
    shouldThrow = chunkError();
    render(
      <LazyChunkBoundary label="Find & Replace">
        <Panel />
      </LazyChunkBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Find & Replace couldn't be loaded");
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
    expect(pageActions.reload).not.toHaveBeenCalled();
  });

  it("online with unsaved typing: offers Reload instead of taking it", () => {
    useDocumentStore.setState({ saveStatus: "editing" });
    shouldThrow = chunkError();
    render(
      <LazyChunkBoundary>
        <Panel />
      </LazyChunkBoundary>,
    );
    expect(pageActions.reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Reload$/ }));
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
  });

  it("online and clean: reloads by itself, once — a second failure does not loop", () => {
    shouldThrow = chunkError();
    const { unmount } = render(
      <LazyChunkBoundary>
        <Panel />
      </LazyChunkBoundary>,
    );
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
    unmount();
    render(
      <LazyChunkBoundary>
        <Panel />
      </LazyChunkBoundary>,
    );
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
  });

  it("still uses a caller's fallback for chunk failures", () => {
    onLine = false;
    shouldThrow = chunkError();
    render(
      <LazyChunkBoundary fallback={() => <p>custom fallback</p>}>
        <Panel />
      </LazyChunkBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeInTheDocument();
  });

  it("the rest of the tree keeps rendering", () => {
    shouldThrow = new Error("panel bug");
    function Shell() {
      const [n] = useState(1);
      return (
        <div>
          <p>editor {n}</p>
          <LazyChunkBoundary>
            <Panel />
          </LazyChunkBoundary>
        </div>
      );
    }
    render(<Shell />);
    expect(screen.getByText("editor 1")).toBeInTheDocument();
  });
});
