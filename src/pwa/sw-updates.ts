/**
 * Service-worker update delivery for the standalone app — PROMPT, never force.
 *
 * It used to be autoUpdate + skipWaiting + clientsClaim, a `controllerchange`
 * listener that reloaded the page, and a worker-side script that navigated
 * every open window on activation: each deploy reloaded every open tab
 * mid-edit. Undo history, an IME composition and open dialogs were lost, and an
 * actively typing user met a surprise "Leave site?" prompt.
 *
 * Now a new worker installs and WAITS. This tab shows "Update ready — Reload";
 * the worker only takes over when a user presses Reload (or every tab has
 * closed, which is the browser's own rule). When it takes over, each OTHER open
 * tab is running the old build under the new worker, so it offers the reload
 * too — and performs it by itself only when nothing could be lost (app-health's
 * decideUpdateReload: online, nothing unsaved, tab in the background).
 *
 * Nothing here auto-activates a waiting worker: activation switches EVERY tab
 * at once, and a clean background tab has no right to do that to a busy one.
 */
import { toast } from "sonner";
import { decideUpdateReload, isOnline, pageActions, unsavedNow } from "../utils/app-health";
import { recordDiagnostic } from "../utils/diagnostics";

/** The subset of vite-plugin-pwa's `registerSW` this module drives. */
export type RegisterSW = (options: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swUrl: string, registration: { update(): Promise<unknown> } | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}) => (reloadPage?: boolean) => Promise<void>;

/**
 * How often an open tab asks the server for a new worker. The browser only
 * checks by itself on NAVIGATIONS, and this app's route changes are
 * history.pushState, which are not navigations — so a tab left open for days
 * (an installed PWA, typically) never learned a deploy had happened. One
 * conditional fetch of sw.js (served no-cache) an hour is the price.
 */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

export type UpdateNotice =
  | "ready" // a new version is waiting
  | "activated" // it took over (from another tab); this tab runs the old build
  | "offline" // the user asked to update while offline
  | "applying"; // the user asked; waiting for the worker to take over

export interface SwUpdateEnv {
  online(): boolean;
  hidden(): boolean;
  unsaved(): boolean;
  reload(): void;
  /** Show (or replace) the single update notice; `apply` is its Reload action. */
  notify(notice: UpdateNotice, apply: () => void): void;
  /** Subscribe to the moments a waiting decision should be re-taken. */
  onChance(cb: () => void): () => void;
  setTimeout(cb: () => void, ms: number): unknown;
  /** Run `cb` every `ms` for the life of the page. */
  every(ms: number, cb: () => void): unknown;
}

const browserEnv = (): SwUpdateEnv => ({
  online: isOnline,
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  unsaved: unsavedNow,
  reload: () => pageActions.reload(),
  notify: showUpdateToast,
  onChance(cb) {
    const onVis = () => cb();
    window.addEventListener("online", cb);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", cb);
      document.removeEventListener("visibilitychange", onVis);
    };
  },
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  every: (ms, cb) => window.setInterval(cb, ms),
});

export interface SwUpdateController {
  /** What the notice's Reload button does. */
  apply(): void;
}

export function setupServiceWorkerUpdates(registerSW: RegisterSW, env: SwUpdateEnv = browserEnv()): SwUpdateController {
  let requested = false; // the user pressed Reload in THIS tab
  let activated = false; // a new worker now controls this page
  let reloading = false;
  let watching = false;

  const reload = () => {
    if (reloading) return;
    reloading = true;
    env.reload();
    // Still here a moment later? The user kept the page — most likely by
    // declining the editor's unsaved-changes prompt. Offer the update again
    // instead of leaving the tab believing it is mid-reload.
    env.setTimeout(() => {
      reloading = false;
      requested = false;
      env.notify(activated ? "activated" : "ready", apply);
    }, 3000);
  };

  /** Re-take the decision; reloads only if the policy allows it right now. */
  const consider = () => {
    if (!activated || reloading) return;
    const decision = decideUpdateReload({
      online: env.online(),
      unsaved: env.unsaved(),
      hidden: env.hidden(),
      userRequested: requested,
    });
    if (decision === "reload") reload();
  };

  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      env.notify("ready", apply);
    },
    // vite-plugin-pwa calls this when the new worker takes control — INSTEAD of
    // its default `window.location.reload()`, which is exactly the forced
    // reload this module exists to prevent.
    onNeedReload() {
      activated = true;
      consider();
      if (reloading) return;
      env.notify("activated", apply);
      if (!watching) {
        watching = true;
        env.onChance(consider);
      }
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      env.every(UPDATE_CHECK_MS, () => {
        // Offline the fetch can only fail; hidden, nobody would see the prompt
        // (the next visible check, or the browser's own on navigation, finds it).
        if (!env.online() || env.hidden()) return;
        registration.update().catch((error: unknown) => recordDiagnostic({ kind: "sw", error, name: "ServiceWorkerUpdateCheck" }));
      });
    },
    onRegisterError(error) {
      recordDiagnostic({ kind: "sw", error, name: "ServiceWorkerRegistration" });
    },
  });

  function apply() {
    if (!env.online()) {
      // Activating offline would leave this page, and every other tab, on a
      // build the network cannot finish loading. Wait for a connection.
      env.notify("offline", apply);
      return;
    }
    requested = true;
    if (activated) {
      reload();
      return;
    }
    env.notify("applying", apply);
    // SKIP_WAITING → the worker takes control → onNeedReload → reload.
    void updateServiceWorker(true).catch((error: unknown) => recordDiagnostic({ kind: "sw", error, name: "ServiceWorkerUpdate" }));
    // If nothing takes control (the waiting worker was replaced by an even
    // newer one, so there is nothing left to message), the reload is still what
    // the user asked for. Once a worker HAS taken control, onNeedReload owns it.
    env.setTimeout(() => {
      if (!activated && !reloading && env.online()) reload();
    }, 5000);
  }

  return { apply };
}

// ── The notice ───────────────────────────────────────────────────────────────

const TOAST_ID = "pf-sw-update";

const COPY: Record<UpdateNotice, { title: string; description: string }> = {
  ready: {
    title: "A new version of Markdown Studio is ready",
    description: "Reload when it suits you — nothing changes until you do.",
  },
  activated: {
    title: "Markdown Studio was updated in another tab",
    description: "Reload this tab to finish updating. It will not reload while you have unsaved changes.",
  },
  offline: {
    title: "You're offline",
    description: "The update will be ready to apply once you're back online.",
  },
  applying: {
    title: "Updating…",
    description: "Markdown Studio will reload in a moment.",
  },
};

/**
 * Sonner only shows toasts created after its <Toaster> has mounted, and the
 * editor mounts it after its engine is ready — a worker that was already
 * waiting at load reports in before that. Wait for the toaster instead of
 * dropping the notice.
 */
function whenToasterReady(cb: () => void) {
  const present = () => !!document.querySelector('section[aria-label^="Notifications"], [data-sonner-toaster]');
  if (present()) return cb();
  const obs = new MutationObserver(() => {
    if (!present()) return;
    obs.disconnect();
    cb();
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

function showUpdateToast(notice: UpdateNotice, apply: () => void) {
  whenToasterReady(() => {
    const { title, description } = COPY[notice];
    toast(title, {
      id: TOAST_ID,
      description,
      // Stays until acted on: an update notice that times out is an update
      // the user never hears about again this session.
      duration: Infinity,
      ...(notice === "applying" ? {} : { action: { label: "Reload", onClick: apply } }),
    });
  });
}
