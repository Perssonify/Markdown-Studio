/**
 * A078 / A081 — surfaces that must not reach production users.
 *
 * The placeholder ad slots ("Your Ad Here") could be switched on by anyone: the
 * View menu, Settings, the share-link builder and a crafted `?ads=1` link all
 * turned them on in the shipped build. The Settings "Admin" section (console,
 * context-menu switch, ads) was likewise visible to every user.
 *
 * `buildFlags.dev` stands in for `import.meta.env.DEV`, which Vite replaces at
 * build time; vitest runs as a development build, so the production branch is
 * exercised by flipping it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { _setDevBuildForTests, adminSettingsAvailable, sessionAdsFromParam } from "../utils/build-gates";
import { useUIStore } from "../store/uiStore";
import { AdUnit } from "../ui/AdUnit";
import { DialogProvider } from "../ui/DialogProvider";
import { LinkBuilder } from "../ui/LinkBuilder";
import { MenuBar } from "../ui/MenuBar";
import { SettingsSheet } from "../ui/SettingsSheet";

beforeAll(() => {
  // jsdom has no matchMedia; next-themes and the sheet primitives probe it.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    });
  }
});

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({ showAds: false });
});

afterEach(() => {
  cleanup();
  _setDevBuildForTests(true);
  localStorage.clear();
});

describe("the ?ads= parameter", () => {
  it("is honoured in a development build", () => {
    _setDevBuildForTests(true);
    expect(sessionAdsFromParam("1")).toBe(true);
    expect(sessionAdsFromParam("true")).toBe(true);
    expect(sessionAdsFromParam("0")).toBe(false);
    expect(sessionAdsFromParam(null)).toBe(null);
  });

  it("is ignored in a production build — a crafted link cannot switch ads on", () => {
    _setDevBuildForTests(false);
    expect(sessionAdsFromParam("1")).toBe(null);
    expect(sessionAdsFromParam("true")).toBe(null);
  });
});

describe("AdUnit renders only in a development build", () => {
  it("renders the slot in development when ads are on", () => {
    _setDevBuildForTests(true);
    useUIStore.setState({ showAds: true });
    render(<AdUnit variant="sidebar-inline" />);
    expect(screen.getByText("Your Ad Here")).toBeInTheDocument();
  });

  it("renders NOTHING in production even with showAds already true", () => {
    // What a `pf:show-ads=true` stored by an earlier version (or the embed's
    // own ?ads= handling) leaves behind: the preference is set, and the slot
    // must still stay dark.
    _setDevBuildForTests(false);
    useUIStore.setState({ showAds: true });
    for (const variant of ["sidebar-inline", "floating-bar", "right-rail"]) {
      const { container, unmount } = render(<AdUnit variant={variant} />);
      expect(container.innerHTML, variant).toBe("");
      unmount();
    }
  });
});

describe("View menu", () => {
  const noop = () => {};
  const dialogApi = {
    confirm: async () => true,
    prompt: async () => null,
    equation: async () => null,
    confirmUnsaved: async () => "cancel",
  };
  async function openViewMenu() {
    render(
      <DialogProvider value={dialogApi}>
        <TooltipProvider>
          <MenuBar
            activeDocId="a" docTitle="T" mode="split" setMode={noop} onAction={noop} dispatch={noop}
            onNew={noop} onSave={noop} onRevert={noop} onClose={noop} onToggleSidebar={noop}
            onFindReplace={noop} onSearch={noop} onSettings={noop} onGraph={noop}
          />
        </TooltipProvider>
      </DialogProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    // A neighbouring item proves the menu actually opened, so the absence
    // asserted below is not just a closed menu.
    await waitFor(() => expect(screen.getByText("Focus mode")).toBeInTheDocument());
  }

  it("has no Show ads item in production", async () => {
    _setDevBuildForTests(false);
    await openViewMenu();
    expect(screen.queryByText("Show ads")).toBeNull();
  });

  it("keeps it in development", async () => {
    _setDevBuildForTests(true);
    await openViewMenu();
    expect(screen.getByText("Show ads")).toBeInTheDocument();
  });
});

describe("the share-link builder", () => {
  it("offers no ads parameter in production, and never writes one", () => {
    _setDevBuildForTests(false);
    render(<LinkBuilder variant="page" />);
    expect(screen.queryByText("Ads")).toBeNull();
    const outputs = [...document.querySelectorAll("code")].map((c) => c.textContent).join("\n");
    expect(outputs).not.toMatch(/[?&]ads=/);
  });

  it("still offers it in development", () => {
    _setDevBuildForTests(true);
    render(<LinkBuilder variant="page" />);
    expect(screen.getByText("Ads")).toBeInTheDocument();
  });
});

describe("Settings ▸ Admin (A081)", () => {
  const renderOpen = () => render(<SettingsSheet open onOpenChange={() => {}} />);

  it("is hidden in production without the opt-in flag", () => {
    _setDevBuildForTests(false);
    expect(adminSettingsAvailable()).toBe(false);
    renderOpen();
    expect(screen.getByText("Settings")).toBeInTheDocument(); // the sheet did render
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Diagnostics console")).toBeNull();
    expect(screen.queryByText("Enable right-click menu")).toBeNull();
    expect(screen.queryByText("Show ads")).toBeNull();
  });

  it("appears in production for a browser opted in with pf:admin=1 — without the ads switch", () => {
    _setDevBuildForTests(false);
    localStorage.setItem("pf:admin", "1");
    expect(adminSettingsAvailable()).toBe(true);
    renderOpen();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Diagnostics console")).toBeInTheDocument();
    expect(screen.queryByText("Show ads")).toBeNull();
  });

  it("only the exact value \"1\" opts in", () => {
    _setDevBuildForTests(false);
    for (const v of ["true", "yes", "0", ""]) {
      localStorage.setItem("pf:admin", v);
      expect(adminSettingsAvailable(), v).toBe(false);
    }
  });

  it("is always shown in a development build, ads switch included", () => {
    _setDevBuildForTests(true);
    renderOpen();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Show ads")).toBeInTheDocument();
  });
});
