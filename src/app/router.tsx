import { useCallback, useEffect, useState } from "react";

/**
 * Minimal history-API router for the **standalone app** only.
 *
 * The editor library (`PerssonifyEditor`) and the iframe embed stay routing-
 * agnostic — this hook lives in the app shell (`App.tsx`) so host apps that
 * embed the editor never have their own routing touched.
 *
 * Vercel already rewrites every non-`/api/` path to `index.html`
 * (see `vercel.json`), so real paths like `/about` deep-link and refresh
 * cleanly with no extra configuration.
 */
export type AppRoute = "editor" | "about" | "help" | "graph";

const ROUTE_PATHS: Record<AppRoute, string> = {
  editor: "/",
  about: "/about",
  help: "/help",
  graph: "/graph",
};

export function pathToRoute(pathname: string): AppRoute {
  const p = pathname.replace(/\/+$/, "").toLowerCase() || "/";
  if (p === "/about") return "about";
  if (p === "/help") return "help";
  if (p === "/graph") return "graph";
  return "editor";
}

export function routeToPath(route: AppRoute): string {
  return ROUTE_PATHS[route] ?? "/";
}

export function useAppRouter() {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === "undefined" ? "editor" : pathToRoute(window.location.pathname)
  );

  useEffect(() => {
    const onPop = () => setRoute(pathToRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: AppRoute, opts?: { replace?: boolean }) => {
    const path = routeToPath(to);
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      if (opts?.replace) window.history.replaceState({}, "", path);
      else window.history.pushState({}, "", path);
    }
    setRoute(to);
    // Interior pages scroll from the top.
    if (typeof window !== "undefined") window.scrollTo?.(0, 0);
  }, []);

  return { route, navigate };
}
