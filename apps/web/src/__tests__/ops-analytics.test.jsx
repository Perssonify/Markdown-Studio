/**
 * Google Analytics (utils/analytics.ts, utils/analytics-consent.ts): on in the
 * production deploy alone, installed only once the boot watchdog has stood
 * down, told the route — never the address bar, where `#share=` carries the
 * shared documents themselves, `#live=` a live share's permission and
 * `?import_url=` the address a user imports from — and asking every visitor,
 * in every country, before it sets a cookie.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANALYTICS_BUILD,
  GA_DISABLE_KEY,
  GA_MEASUREMENT_ID,
  GTAG_SRC,
  _resetAnalyticsForTests,
  installAnalytics,
  trackPageView,
} from "../utils/analytics";
import {
  ANALYTICS_CONSENT_KEY,
  _resetAnalyticsConsentForTests,
  analyticsConsent,
  analyticsOffered,
  setAnalyticsConsent,
} from "../utils/analytics-consent";
import { AnalyticsConsentBar } from "../app/analyticsConsent";
import { PageChrome } from "../ui/pages/pageChrome";
import { PrivacySection } from "../ui/settings/settingsPrivacy";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const gtagScripts = () => [...document.head.querySelectorAll("script")].filter((s) => s.src === GTAG_SRC);
const commands = () => (window.dataLayer || []).map((a) => [...a]);
const consentCommands = () => commands().filter((c) => c[0] === "consent");
const BAR = { name: "Analytics cookies" };
/** The browser's time zone: it must not matter where the visitor is. */
const zone = (timeZone) => {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function () {
    return { ...real.call(this), timeZone };
  });
};
const DENIED = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  _resetAnalyticsForTests();
  _resetAnalyticsConsentForTests();
  for (const s of gtagScripts()) s.remove();
  delete window.dataLayer;
  delete window[GA_DISABLE_KEY];
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("off everywhere but the production deploy", () => {
  it("is off in this build, and an install that is off does nothing", () => {
    expect(ANALYTICS_BUILD).toBe(false);
    expect(installAnalytics()).toBe(false);
    trackPageView("/");
    expect(gtagScripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
    expect(analyticsOffered()).toBe(false);
  });

  it("only the app's Vite config turns it on, and only for VERCEL_ENV=production", () => {
    expect(read("vite.app.config.ts")).toMatch(/__PF_ANALYTICS__: JSON\.stringify\(process\.env\.VERCEL_ENV === 'production'\)/);
    for (const f of ["vite.config.ts", "vite.embed.config.ts"]) expect(read(f), f).not.toMatch(/__PF_ANALYTICS__/);
  });

  it("only the app shell imports the Google code; the library side holds none", () => {
    const users = readdirSync(join(process.cwd(), "src"), { recursive: true })
      .filter((f) => /\.[jt]sx?$/.test(f) && !f.includes("__tests__"))
      .filter((f) => /from "[@./\w-]*\/analytics"/.test(read(join("src", f))));
    expect(users.sort()).toEqual(["App.tsx", "main.tsx"]);
    expect(read("src/utils/analytics-consent.ts")).not.toMatch(/googletagmanager|G-[A-Z0-9]{6,}|dataLayer/);
  });
});

describe("in the production deploy", () => {
  it("runs Google's snippet once: one async gtag.js, commands as `arguments`, no automatic page view", () => {
    zone("America/New_York");
    expect(installAnalytics(true)).toBe(true);
    expect(installAnalytics(true)).toBe(true);
    expect(gtagScripts()).toHaveLength(1);
    expect(gtagScripts()[0].async).toBe(true);
    expect(GTAG_SRC).toBe(`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`);
    expect(GA_DISABLE_KEY).toBe(`ga-disable-${GA_MEASUREMENT_ID}`);
    // gtag.js ignores a command pushed as an array.
    expect(Object.prototype.toString.call(window.dataLayer[0])).toBe("[object Arguments]");
    const [consent, js, config, ...rest] = commands();
    expect(consent).toEqual(["consent", "default", DENIED]);
    expect(js[0]).toBe("js");
    expect(js[1]).toBeInstanceOf(Date);
    expect(config).toEqual(["config", GA_MEASUREMENT_ID, { send_page_view: false }]);
    expect(rest).toEqual([]);
  });

  it("reports the route's path and title, never the query or the hash", () => {
    installAnalytics(true);
    const before = commands().length;
    window.history.replaceState({}, "", "/about?import_url=https%3A%2F%2Fexample.com%2Fprivate.md#share=SECRET&live=ID");
    document.title = "About — Markdown Studio";
    trackPageView("/about");
    expect(commands().slice(before)).toEqual([
      ["set", { page_location: `${window.location.origin}/about`, page_title: "About — Markdown Studio" }],
      ["event", "page_view"],
    ]);
    expect(JSON.stringify(commands())).not.toMatch(/SECRET|import_url|example\.com|live=/);
  });

  it("installs after __PF_BOOTED, so the boot watchdog never takes a blocked gtag.js for a broken deploy", () => {
    const main = read("src/main.tsx");
    const booted = main.indexOf("__PF_BOOTED = true");
    expect(booted).toBeGreaterThan(-1);
    expect(main.indexOf("installAnalytics()")).toBeGreaterThan(booted);
  });

  it("App reports a route after titling it", () => {
    const app = read("src/App.tsx");
    const titled = app.indexOf("document.title =");
    expect(titled).toBeGreaterThan(-1);
    expect(app.indexOf("trackPageView(routeToPath(route))")).toBeGreaterThan(titled);
  });
});

describe("consent", () => {
  it.each(["Europe/Paris", "America/New_York", "Asia/Karachi", "Asia/Tokyo", "UTC"])(
    "nothing is stored until the visitor answers, in %s as anywhere",
    (tz) => {
      zone(tz);
      installAnalytics(true);
      expect(consentCommands()).toEqual([["consent", "default", DENIED]]);
    },
  );

  it("an earlier yes allows analytics cookies on the next load, never advertising ones", () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
    installAnalytics(true);
    expect(consentCommands().at(-1)).toEqual(["consent", "update", { analytics_storage: "granted" }]);
  });

  it("an earlier no loads nothing, but keeps the setting offered so it can be changed", () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
    expect(installAnalytics(true)).toBe(false);
    expect(gtagScripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
    expect(analyticsOffered()).toBe(true);
  });

  it("no stops gtag.js at once and removes Google's cookies", () => {
    installAnalytics(true);
    document.cookie = "_ga=GA1.1.123.456; path=/";
    document.cookie = "_ga_WFN9X3MKR0=GS1.1.789; path=/";
    document.cookie = "pf-other=keep; path=/";
    setAnalyticsConsent("denied");
    expect(window[GA_DISABLE_KEY]).toBe(true);
    expect(consentCommands().at(-1)).toEqual(["consent", "update", DENIED]);
    expect(document.cookie).not.toMatch(/_ga/);
    expect(document.cookie).toMatch(/pf-other=keep/);
    const before = commands().length;
    trackPageView("/");
    expect(commands()).toHaveLength(before);
    document.cookie = "pf-other=; Max-Age=0; path=/";
  });

  it("yes after an earlier no starts analytics without a reload", () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
    installAnalytics(true);
    setAnalyticsConsent("granted");
    expect(window[GA_DISABLE_KEY]).toBe(false);
    expect(gtagScripts()).toHaveLength(1);
    expect(consentCommands().at(-1)).toEqual(["consent", "update", { analytics_storage: "granted" }]);
  });
});

describe("the prompt and the setting", () => {
  it.each(["Europe/Paris", "America/New_York", "Asia/Karachi"])("the prompt asks in %s, with Decline as prominent as Allow, and goes once answered", (tz) => {
    zone(tz);
    installAnalytics(true);
    render(<AnalyticsConsentBar />);
    const allow = screen.getByRole("button", { name: "Allow" });
    const decline = screen.getByRole("button", { name: "Decline" });
    expect(decline.className).toBe(allow.className);
    fireEvent.click(decline);
    expect(analyticsConsent()).toBe("denied");
    expect(screen.queryByRole("region", BAR)).toBeNull();
  });

  it("no prompt after an answer, or where analytics does not run", () => {
    installAnalytics(true);
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
    const first = render(<AnalyticsConsentBar />);
    expect(screen.queryByRole("region", BAR)).toBeNull();
    first.unmount();

    _resetAnalyticsConsentForTests();
    localStorage.clear();
    render(<AnalyticsConsentBar />);
    expect(screen.queryByRole("region", BAR)).toBeNull();
  });

  it("every interior page (About, Help, Sign in, Profile) carries the prompt under its header", () => {
    installAnalytics(true);
    render(<PageChrome title="About" onClose={() => {}}><p>About text</p></PageChrome>);
    const page = screen.getByRole("dialog", { name: "About" });
    expect(within(page).getByRole("region", BAR)).toBeInTheDocument();
    fireEvent.click(within(page).getByRole("button", { name: "Allow" }));
    expect(analyticsConsent()).toBe("granted");
    expect(within(page).queryByRole("region", BAR)).toBeNull();
    for (const f of ["aboutPage", "helpPage", "loginPage", "profilePage"]) {
      expect(read(`src/ui/pages/${f}/index.tsx`), f).toMatch(/<PageChrome\b/);
    }
  });

  it("Settings ▸ Privacy offers the switch only where analytics runs", () => {
    const { unmount } = render(<PrivacySection open />);
    expect(screen.queryByRole("switch", { name: "Usage analytics" })).toBeNull();
    unmount();
    installAnalytics(true);
    render(<PrivacySection open />);
    expect(screen.getByRole("switch", { name: "Usage analytics" })).toBeInTheDocument();
  });

  it("the switch starts off and undecided, follows the prompt, and changes the answer", () => {
    zone("America/New_York");
    installAnalytics(true);
    render(<><AnalyticsConsentBar /><PrivacySection open /></>);
    const toggle = screen.getByRole("switch", { name: "Usage analytics" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Not decided yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/Not decided yet/)).toBeNull();
    fireEvent.click(toggle);
    expect(analyticsConsent()).toBe("denied");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("the prompt sits under the editor's header", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/<EditorHeader[^>]*\/>\s*<AnalyticsConsentBar \/>/);
  });

  it("a first visit's tour waits until the prompt is answered (it would cover the bar)", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/const consentPending = consent === null && analyticsOffered\(\);/);
    expect(app).toMatch(/if \(route !== "editor" \|\| consentPending\) return;/);
    expect(app).toMatch(/\}, \[route, consentPending\]\);/);
  });
});

describe("the privacy copy says so", () => {
  it.each(["src/ui/pages/aboutPage/about-content.ts", "src/ui/pages/helpPage/help-content.ts"])("%s", (file) => {
    const src = read(file);
    expect(src).toMatch(/Google Analytics/);
    expect(src).toMatch(/no cookies unless you allow them/);
    expect(src).toMatch(/Settings [▸→] Privacy/);
    expect(src).not.toMatch(/no analytics/i);
  });
});
