/**
 * The library's public surface: what is deprecated says so, and the
 * integration wrapper is the element the published stylesheet themes.
 *
 * `fieldSchemas`, `linkResolver` and `setFieldSchemas()` were accepted and did
 * nothing — setFieldSchemas wrote a window global nothing reads — and
 * BlockId / FieldBlock / TransclusionBlock were exported although the editor
 * registers none of them. README and features.md described all of it as
 * working. Removing any of it would break hosts at compile time, so each is
 * `@deprecated` and warns once, in development, when actually used.
 *
 * Harness (as bridge-open-completion.test.jsx): the REAL integration wrapper,
 * with the core editor and presentation shells faked.
 */
import { createRef } from "react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDeprecationWarnings, warnDeprecated } from "../integration/deprecation";
import { PerssonifyEditorIntegration } from "../integration/PerssonifyEditorIntegration";

vi.mock("../PerssonifyEditor", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    PerssonifyEditor: function CoreStub({ _integrationRef }) {
      useImperativeHandle(_integrationRef, () => ({ setFieldSchemas: () => {} }), []);
      return <div data-testid="core" />;
    },
  };
});
vi.mock("next-themes", () => ({ ThemeProvider: ({ children }) => children }));
vi.mock("../ui/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }) => <div data-testid="error-boundary">{children}</div>,
}));

let warn;
beforeEach(() => {
  resetDeprecationWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  warn.mockRestore();
});
const warnings = () => warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("[@perssonify/editor]"));

describe("warnDeprecated", () => {
  it("warns once per API per page load", () => {
    warnDeprecated("`x()`", "it has no effect.");
    warnDeprecated("`x()`", "it has no effect.");
    warnDeprecated("`y()`", "it has no effect.");
    expect(warnings()).toEqual([
      "[@perssonify/editor] `x()` is deprecated: it has no effect.",
      "[@perssonify/editor] `y()` is deprecated: it has no effect.",
    ]);
  });

  it("is silent in a production build", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      warnDeprecated("`x()`", "it has no effect.");
    } finally {
      process.env.NODE_ENV = previous;
    }
    expect(warnings()).toEqual([]);
  });
});

describe("deprecated integration API", () => {
  it("says nothing when the deprecated props are not passed", async () => {
    await act(async () => { render(<PerssonifyEditorIntegration />); });
    expect(warnings()).toEqual([]);
  });

  it("warns about each deprecated prop a host passes — once, however often it re-renders", async () => {
    const view = (n) => (
      <PerssonifyEditorIntegration
        fieldSchemas={[]}
        linkResolver={() => `x${n}`}
        documents={[]}
        onFieldChange={() => n}
        onExport={() => n}
      />
    );
    let rerender;
    await act(async () => { ({ rerender } = render(view(1))); });
    await act(async () => { rerender(view(2)); }); // fresh callback identities
    const out = warnings();
    for (const prop of ["fieldSchemas", "linkResolver", "documents", "onFieldChange", "onExport"]) {
      expect(out.filter((m) => m.includes(`\`${prop}\` prop`)), prop).toHaveLength(1);
    }
    expect(out.find((m) => m.includes("`linkResolver` prop"))).toContain("onLinkClick");
  });

  it("warns when the handle's setFieldSchemas() is called", async () => {
    const ref = createRef();
    await act(async () => { render(<PerssonifyEditorIntegration ref={ref} />); });
    ref.current.setFieldSchemas([{ name: "x" }]);
    expect(warnings().some((m) => m.includes("`setFieldSchemas()`"))).toBe(true);
  });

  it("exposes clearLocalData() for a host's logout (A103)", async () => {
    // The core editor handle had it; the integration wrapper did not forward it.
    const ref = createRef();
    await act(async () => { render(<PerssonifyEditorIntegration ref={ref} />); });
    expect(typeof ref.current.clearLocalData).toBe("function");
  });
});

describe("deprecated extension exports", () => {
  it("warn only when an editor is created with them, and still work", async () => {
    const { BlockId, FieldBlock, TransclusionBlock } = await import("../index");
    expect(warnings()).toEqual([]); // importing the package must stay silent
    const editor = new Editor({ extensions: [StarterKit, BlockId, FieldBlock, TransclusionBlock], content: "<p>x</p>" });
    try {
      // The parent hooks still run: the extensions keep their own behaviour.
      expect(editor.schema.nodes.fieldBlock).toBeTruthy();
      const out = warnings();
      for (const name of ["BlockId", "FieldBlock", "TransclusionBlock"]) {
        expect(out.some((m) => m.includes(`\`${name}\` export`)), name).toBe(true);
      }
    } finally {
      editor.destroy();
    }
  });
});

describe("the integration wrapper", () => {
  it("is the token root, and encloses the error boundary so the crash card is themed", async () => {
    const { container } = render(<PerssonifyEditorIntegration isDark accentColor="#7c3aed" />);
    const root = container.querySelector("[data-pf-root]");
    expect(root).toBeTruthy();
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--primary")).toBe("#7c3aed");
    expect(root.querySelector("[data-testid=error-boundary] [data-testid=core]")).toBeTruthy();
  });
});
