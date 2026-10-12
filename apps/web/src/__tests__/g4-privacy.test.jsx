/**
 * A076 — privacy claims that are true, and the controls behind them.
 *
 * The About page, Help, the welcome document and marketing copy promised
 * "your documents never leave your device … nothing uploaded", while URL import
 * silently retried through our server relay and remote images loaded on open
 * (a tracking beacon, with a Referer). The copy now describes both, the relay
 * asks first (g4-relay-consent.test.js), and remote images can be blocked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DialogProvider } from "../ui/dialogs/dialogProvider";
import { UrlImportDialog } from "../ui/importExport/urlImportDialog";
import { PrivacySection } from "../ui/settings/settingsPrivacy";
import { getRelayConsent } from "../store/importExport/url-import";
import {
  BLOCK_REMOTE_IMAGES_KEY,
  REMOTE_IMAGE_CSP,
  _resetRemoteImagesForTests,
  installRemoteImagePolicy,
  remoteImagePolicyActive,
} from "../utils/remote-images";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

beforeAll(() => {
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
  _resetRemoteImagesForTests();
  for (const m of document.head.querySelectorAll("meta[data-pf-remote-images]")) m.remove();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("no absolute 'nothing ever leaves' claims", () => {
  // The surfaces a visitor reads. An absolute claim here is a promise the
  // relay and remote images break.
  const FILES = [
    "src/ui/pages/aboutPage/index.tsx",
    "src/ui/pages/helpPage/help-content.ts",
    "src/constants.ts",
    "src/data/starter-documents.ts",
    "src/ui/chrome/menuBar/index.tsx",
    "vite.app.config.ts", // the install prompt's description (PWA manifest)
    // Since A099 the copy itself lives in the About content module and the
    // interface catalog, so the claims are checked where they are written.
    "src/ui/pages/aboutPage/about-content.ts",
    ...readdirSync(join(process.cwd(), "src/i18n/en")).map((f) => `src/i18n/en/${f}`),
  ];
  const ABSOLUTE = [
    /never leave your device/i,
    /nothing (?:is |you write is )?uploaded/i,
    /never uploaded/i,
    /no server, nothing/i,
    /completely client-side/i,
    /client-only/i,
    // Offline works after one online visit (A085); installing is not required.
    /install it as an app[^"]*to work offline/i,
    // PDF is export-only; there is no PDF import.
    /import and export [^"]*\bPDF\b/i,
  ];

  it.each(FILES)("%s", (file) => {
    const src = read(file);
    for (const re of ABSOLUTE) expect(src, `${file} ${re}`).not.toMatch(re);
  });

  it("Help explains both features that do go online, and where to control them", () => {
    const help = read("src/ui/pages/helpPage/help-content.ts");
    const privacy = help.slice(help.indexOf('id: "offline-privacy"'));
    expect(privacy).toMatch(/its own server/);
    expect(privacy).toMatch(/asks you first/);
    expect(privacy).toMatch(/Block remote images/);
  });
});

describe("the URL importer asks before using the relay", () => {
  it("routes the one-time question through useDialog().confirm", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (href) => {
      calls.push(String(href));
      if (String(href).startsWith("/api/import")) {
        return new Response("# Relayed notes", { status: 200, headers: { "x-upstream-content-type": "text/markdown" } });
      }
      throw new TypeError("Failed to fetch"); // the host blocks browsers (CORS)
    });
    const confirm = vi.fn(async () => true);
    render(
      <DialogProvider value={{ confirm, prompt: async () => null, equation: async () => null, confirmUnsaved: async () => "cancel" }}>
        <UrlImportDialog open onImport={() => {}} onCancel={() => {}} />
      </DialogProvider>
    );
    fireEvent.change(screen.getByPlaceholderText(/example\.com/), { target: { value: "https://example.com/notes.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0].title).toMatch(/through our server/);
    expect(confirm.mock.calls[0][0].description).toMatch(/example\.com/);
    // Only AFTER the yes did anything reach the relay.
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/import"))).toBe(true));
    expect(getRelayConsent()).toBe("allow");
  });
});

describe("Block remote images", () => {
  it("installs an img-src policy only when the setting is on", () => {
    expect(installRemoteImagePolicy(document)).toBe(false);
    expect(remoteImagePolicyActive(document)).toBe(false);

    localStorage.setItem(BLOCK_REMOTE_IMAGES_KEY, "true");
    expect(installRemoteImagePolicy(document)).toBe(true);
    const meta = document.head.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(meta?.getAttribute("content")).toBe(REMOTE_IMAGE_CSP);
    expect(REMOTE_IMAGE_CSP).toBe("img-src 'self' data: blob:");
    // Idempotent: a second call does not stack policies.
    installRemoteImagePolicy(document);
    expect(document.head.querySelectorAll("meta[data-pf-remote-images]").length).toBe(1);
  });

  it("the switch appears only where the page enforces it (the app shell), and persists", async () => {
    const { unmount } = render(<PrivacySection open />);
    expect(screen.queryByText("Block remote images")).toBeNull(); // library host: nothing enforces it
    unmount();

    installRemoteImagePolicy(document); // what App.tsx does at startup
    render(<PrivacySection open />);
    const toggle = screen.getByRole("switch", { name: "Block remote images" });
    fireEvent.click(toggle);
    await waitFor(() => expect(localStorage.getItem(BLOCK_REMOTE_IMAGES_KEY)).toBe("true"));
    expect(screen.getByText(/next loads/)).toBeInTheDocument();
  });

  it("the app shell installs it at startup, before anything renders", () => {
    const app = read("src/App.tsx");
    const call = app.indexOf("installRemoteImagePolicy();");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(app.indexOf("export function App"));
  });

  it("app and embed pages send no Referer with their image requests", () => {
    for (const page of ["index.html", "embed.html"]) {
      expect(read(page), page).toMatch(/<meta name="referrer" content="no-referrer"/);
    }
  });
});

describe("Settings ▸ Privacy ▸ Import relay", () => {
  // The toggle is HIDDEN (commented out in settingsPrivacy, 2026-10-05, on
  // request); the import dialog still asks (g4-relay-consent.test.js).
  // Un-skip this when the toggle is restored.
  it.skip("reflects and changes the stored answer", async () => {
    render(<PrivacySection open />);
    expect(screen.getByText(/Not decided yet/)).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Import relay" });
    fireEvent.click(toggle);
    await waitFor(() => expect(getRelayConsent()).toBe("allow"));
    fireEvent.click(toggle);
    await waitFor(() => expect(getRelayConsent()).toBe("deny"));
  });
});
