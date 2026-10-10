// Accounts in the standalone app: the session state (app/account/account.ts), the
// menu-bar control (app/account/accountMenu/index.tsx) and the /login and /profile pages.
// The backend is faked at fetch: these cases pin what the app SENDS and how it
// reads each answer, including the ones that must hide every account control.
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountsEnabled, browserNav, signInTargets, useAccount } from "../app/account/account";
import { App } from "../App";
import { AccountMenu } from "../app/account/accountMenu";
import { initialsOf } from "../app/account/accountAvatar";
import { AccountBackups } from "../app/account/accountBackups";
import { LoginPage } from "../ui/pages/loginPage";
import { ProfilePage } from "../ui/pages/profilePage";

const USER = {
  id: "u1",
  name: "Syed Moinuddin",
  email: "syed@perssonify.com",
  image: null,
  createdAt: "2026-10-05T06:41:52.222Z",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html404 = () => new Response("<!doctype html><title>404</title>", { status: 404, headers: { "content-type": "text/html" } });

let fetchMock;
let go;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  go = vi.spyOn(browserNav, "go").mockImplementation(() => {});
  useAccount.setState({ status: "loading", user: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  go.mockRestore();
});

const signedIn = () => useAccount.setState({ status: "signed-in", user: { ...USER } });
const signedOut = () => useAccount.setState({ status: "signed-out", user: null });

describe("the session state", () => {
  it("is signed in when the backend returns a user", async () => {
    fetchMock.mockResolvedValueOnce(json({ session: { id: "s" }, user: USER }));
    await useAccount.getState().refresh();
    expect(useAccount.getState()).toMatchObject({ status: "signed-in", user: { name: USER.name, email: USER.email } });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/get-session", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("is signed out when the backend answers null", async () => {
    fetchMock.mockResolvedValueOnce(json(null));
    await useAccount.getState().refresh();
    expect(useAccount.getState().status).toBe("signed-out");
  });

  // Today's Vercel site has no /api/auth: a 404 page. A dev server whose API is
  // down answers a proxy error. Offline, fetch throws. None of them is
  // "signed out" — the controls must disappear, not invite a sign-in that fails.
  it.each([
    ["a 404 page (a host without the backend)", () => Promise.resolve(html404())],
    ["a server error", () => Promise.resolve(json({ error: "auth_not_configured" }, 503))],
    ["no network", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("is unavailable on %s", async (_label, answer) => {
    fetchMock.mockImplementationOnce(answer);
    await useAccount.getState().refresh();
    expect(useAccount.getState().status).toBe("unavailable");
  });

  it("starts Google sign-in coming back to the editor, or to /login on failure", async () => {
    fetchMock.mockResolvedValueOnce(json({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", redirect: true }));
    await useAccount.getState().signIn();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/sign-in/social");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ provider: "google", ...signInTargets(window.location.origin) });
    expect(signInTargets("https://app.example")).toEqual({
      callbackURL: "https://app.example/",
      errorCallbackURL: "https://app.example/login",
    });
    expect(go).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1");
  });

  it("does not navigate when sign-in cannot start", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Invalid callbackURL" }, 403));
    await expect(useAccount.getState().signIn()).rejects.toThrow();
    expect(go).not.toHaveBeenCalled();
  });

  it("signs out, and stays signed in when the backend refuses", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(json({ error: "x" }, 500));
    await expect(useAccount.getState().signOut()).rejects.toThrow();
    expect(useAccount.getState().status).toBe("signed-in");
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await useAccount.getState().signOut();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/sign-out");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(useAccount.getState()).toMatchObject({ status: "signed-out", user: null });
  });

  it("makes initials from a name", () => {
    expect(initialsOf("Syed Moinuddin")).toBe("SM");
    expect(initialsOf("ada")).toBe("A");
    expect(initialsOf("  ")).toBe("?");
  });
});

/** Open a Base UI menu: in jsdom a click on the trigger opens it (the harness clicks twice when it does not). */
async function openMenu(trigger) {
  await act(async () => { fireEvent.click(trigger); });
  if (!screen.queryByRole("menu")) await act(async () => { fireEvent.click(trigger); });
}

describe("the menu-bar control", () => {
  it.each([["loading"], ["unavailable"]])("renders nothing while %s", (status) => {
    useAccount.setState({ status, user: null });
    const { container } = render(<AccountMenu onSignIn={() => {}} onProfile={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("offers Sign in when signed out, which opens the sign-in page", () => {
    signedOut();
    const onSignIn = vi.fn();
    render(<AccountMenu onSignIn={onSignIn} onProfile={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows the account when signed in, with Profile and Sign out", async () => {
    signedIn();
    const onProfile = vi.fn();
    render(<AccountMenu onSignIn={() => {}} onProfile={onProfile} />);
    await openMenu(screen.getByRole("button", { name: `Account: ${USER.name}` }));
    expect(screen.getByText(USER.email)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: /Profile/ })); });
    expect(onProfile).toHaveBeenCalledTimes(1);

    await openMenu(screen.getByRole("button", { name: `Account: ${USER.name}` }));
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: /Sign out/ })); });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", expect.objectContaining({ method: "POST" }));
    expect(useAccount.getState().status).toBe("signed-out");
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
  });

  // Google's picture is, for most accounts, its own coloured letter, which
  // ignores the theme: the avatar is the initials on the palette's accent.
  it("shows the initials in the theme's accent colour, never the Google picture", () => {
    useAccount.setState({ status: "signed-in", user: { ...USER, image: "https://lh3.googleusercontent.com/a/x=s96-c" } });
    render(<AccountMenu onSignIn={() => {}} onProfile={() => {}} />);
    const trigger = screen.getByRole("button", { name: `Account: ${USER.name}` });
    expect(trigger.querySelector("img")).toBeNull();
    const badge = trigger.querySelector("span[aria-hidden]");
    expect(badge.textContent).toBe("SM");
    expect(badge.className).toMatch(/\bbg-primary\b/);
    expect(badge.className).toMatch(/\btext-primary-foreground\b/);
  });
});

describe("the sign-in page", () => {
  it("signs in with Google from a button", async () => {
    signedOut();
    render(<LoginPage onClose={() => {}} onProfile={() => {}} />);
    fetchMock.mockResolvedValueOnce(json({ url: "https://accounts.google.com/o/oauth2/v2/auth" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ })); });
    expect(go).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("says so when sign-in cannot start", async () => {
    signedOut();
    render(<LoginPage onClose={() => {}} onProfile={() => {}} />);
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ })); });
    expect(screen.getByRole("alert").textContent).toMatch(/could not start/);
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeTruthy();
  });

  it("shows the error Better Auth sends back, then clears it from the address bar", () => {
    window.history.replaceState({}, "", "/login?error=access_denied");
    signedOut();
    render(<LoginPage onClose={() => {}} onProfile={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("access_denied");
    expect(window.location.search).toBe("");
    window.history.replaceState({}, "", "/");
  });

  it("explains, with no button, when sign-in is not available", () => {
    useAccount.setState({ status: "unavailable", user: null });
    render(<LoginPage onClose={() => {}} onProfile={() => {}} />);
    expect(screen.getByRole("status").textContent).toMatch(/isn’t available/);
    expect(screen.queryByRole("button", { name: /Continue with Google/ })).toBeNull();
  });

  it("points a signed-in visitor to their profile", () => {
    signedIn();
    const onProfile = vi.fn();
    render(<LoginPage onClose={() => {}} onProfile={onProfile} />);
    expect(screen.getByText(`You’re signed in as ${USER.name}.`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(onProfile).toHaveBeenCalledTimes(1);
  });
});

describe("the profile page", () => {
  it("shows the account and signs out in place", async () => {
    signedIn();
    const onSignIn = vi.fn();
    render(<ProfilePage onClose={() => {}} onSignIn={onSignIn} />);
    expect(screen.getByRole("heading", { name: USER.name })).toBeTruthy();
    expect(screen.getAllByText(USER.email).length).toBeGreaterThan(0);
    expect(screen.getByText("Member since")).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();

    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign out" })); });
    expect(screen.getByText("You’re not signed in.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("keeps the account and says so when sign-out fails", async () => {
    signedIn();
    render(<ProfilePage onClose={() => {}} onSignIn={() => {}} />);
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign out" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/Could not sign out/);
    expect(useAccount.getState().status).toBe("signed-in");
  });
});

describe("the profile page's backups", () => {
  const BACKUPS = [{ date: "2026-10-05", size: 2048, at: 1 }, { date: "2026-10-04", size: 1024, at: 0 }];
  afterEach(() => localStorage.removeItem("pf:cloud-owner"));

  // Backups are intentionally no longer surfaced on the profile page: the
  // library is kept indefinitely, so a "kept for 30 days" panel only misled.
  // The AccountBackups component still works and is covered directly below.
  it("are no longer shown on the profile page", () => {
    signedIn();
    localStorage.setItem("pf:cloud-owner", USER.id);
    render(<ProfilePage onClose={() => {}} onSignIn={() => {}} />);
    expect(screen.queryByRole("heading", { name: "Backups" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("backs up now, then shows the new list", async () => {
    const api = { listBackups: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(BACKUPS.slice(0, 1)), backupDownloadUrl: vi.fn() };
    const backUpNow = vi.fn(async () => "stored");
    render(<AccountBackups backUpNow={backUpNow} api={api} />);
    expect(await screen.findByText(/No backups yet/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Back up now" })); });
    expect(backUpNow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toMatch(/Today’s backup is in your account/);
    expect(await screen.findAllByRole("button", { name: /Download the backup of/ })).toHaveLength(1);
  });

  it("says so when a backup cannot be made, or the list cannot be read", async () => {
    const api = { listBackups: vi.fn().mockRejectedValue(new Error("offline")), backupDownloadUrl: vi.fn() };
    render(<AccountBackups backUpNow={vi.fn(async () => { throw new Error("offline"); })} api={api} />);
    expect(await screen.findByText(/could not be listed/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Back up now" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/could not be stored/);
  });
});

// Accounts belong to the website. The npm library and the iframe embed have
// none: no host's page may grow a sign-in button pointing at our backend.
describe("accounts are the standalone app's alone", () => {
  const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

  it("the app shell hands the top header its account control", () => {
    // Lives at the right end of the top brand header, not in the menu bar.
    expect(read("src/App.tsx")).toMatch(/<EditorHeader accountControl=\{accountControl\}/);
    expect(read("src/EditorHeader.tsx")).toMatch(/accountControl/);
    expect(read("src/ui/chrome/menuBar/index.tsx")).not.toMatch(/accountControl/);
  });

  it.each(["src/embed.tsx", "src/index.tsx", "src/integration/PerssonifyEditorIntegration.tsx"])("%s never mounts it", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/accountControl|AccountMenu|app\/account/);
  });
});

// The app is for signed-in visitors wherever accounts exist; where they do not,
// or the account service does not answer, it is the editor it always was.
describe("the sign-in gate", () => {
  it("is on for the dev server and VITE_ACCOUNTS=on, off for other builds and for tests", () => {
    expect(accountsEnabled({ DEV: true, MODE: "development" })).toBe(true);
    expect(accountsEnabled({ DEV: false, MODE: "production", VITE_ACCOUNTS: "on" })).toBe(true);
    expect(accountsEnabled({ DEV: true, MODE: "development", VITE_ACCOUNTS: "off" })).toBe(false);
    expect(accountsEnabled({ DEV: false, MODE: "production" })).toBe(false); // today's Vercel build, the e2e builds
    expect(accountsEnabled({ DEV: true, MODE: "test" })).toBe(false);
  });

  const renderApp = async () => {
    vi.stubEnv("VITE_ACCOUNTS", "on");
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    const view = render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    return view;
  };
  afterEach(() => vi.unstubAllEnvs());

  it("shows a signed-out visitor the sign-in screen, and no editor", async () => {
    fetchMock.mockResolvedValue(json(null));
    const { container } = await renderApp();
    expect(await screen.findByRole("button", { name: /Continue with Google/ }, { timeout: 10_000 })).toBeTruthy();
    expect(container.querySelector('[data-tour="menubar"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /Back to editor/ })).toBeNull(); // nothing behind it to go back to
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/get-session", expect.anything());
  }, 30_000);

  it("waits for the answer instead of flashing the editor", async () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // never answers (until the timeout)
    const { container } = await renderApp();
    expect(screen.getByText("Checking your account…")).toBeTruthy();
    expect(container.querySelector('[data-tour="menubar"]')).toBeNull();
  }, 30_000);
});
