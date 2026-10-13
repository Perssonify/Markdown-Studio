import { createContext, useContext } from "react";

/**
 * Why sharing is unavailable right now, or undefined when it is available.
 * PerssonifyEditor provides it from its `shareDisabledReason` prop (the
 * standalone app sets "Sign in to share…" for signed-out visitors); the share
 * controls (the menu bar's Share button, "Copy share link" on notes and
 * folders) read it. Context, not props: those controls sit several levels down
 * the workspace panel, inside menus rendered in portals.
 */
export const ShareGateContext = createContext<string | undefined>(undefined);

export const useShareGate = (): string | undefined => useContext(ShareGateContext);

/**
 * The attributes of a share control while sharing is unavailable: greyed out,
 * the reason on hover, and still focusable and clickable, so the reason can be
 * shown on a tap too (a `disabled` element gets no hover and no tooltip).
 */
export function gatedShareProps(reason: string | undefined) {
  return reason ? { "aria-disabled": true as const, title: reason, "data-share-gated": "" } : {};
}
