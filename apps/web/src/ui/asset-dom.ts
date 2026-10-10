import { type RefObject, useEffect, useState } from "react";
import { missingImageTitle, missingSvg } from "../extensions/AssetImages";
import { parseAssetRef } from "../store/assets/asset-refs";
import { assetStore } from "../store/assets/asset-store";

/**
 * Showing images stored as assets (A086) OUTSIDE the rich pane's own node
 * view: the theme-image node view and rendered markdown (the card editor's
 * preview). A `pf-asset:` source must never reach a live `<img>` — the browser
 * cannot load it, and under the app's CSP it is a violation — so it is
 * resolved to a shared object URL first.
 */

/** What to put in an `<img src>` for a document image source. */
export function useAssetSrc(src: string | null | undefined): { src: string; missing: boolean } {
  const ref = parseAssetRef(src);
  const hash = ref?.hash ?? null;
  const [resolved, setResolved] = useState<{ hash: string; url: string | null } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!hash) return;
    let live = true;
    void assetStore.acquireUrl(hash).then((url) => { if (live) setResolved({ hash, url }); });
    return () => {
      live = false;
      assetStore.releaseUrl(hash);
    };
  }, [hash, revision]);

  // A missing asset can arrive later (a backup restored while this is shown).
  const missingNow = !!hash && resolved?.hash === hash && resolved.url === null;
  useEffect(() => {
    if (!missingNow) return;
    return assetStore.subscribe(() => setRevision((r) => r + 1));
  }, [missingNow]);

  if (!ref) return { src: src ?? "", missing: false };
  if (!resolved || resolved.hash !== hash) return { src: "", missing: false };
  if (resolved.url === null) return { src: missingSvg(), missing: true };
  return { src: resolved.url + ref.fragment, missing: false };
}

const ASSET_ATTR_RE = /\s(src|srcset)=(["'])(pf-asset:[0-9a-fA-F]{64}[^"']*)\2/g;

/**
 * Rendered HTML with every asset source moved to a `data-pf-asset-*`
 * attribute, so inserting it into the page loads nothing; pair with
 * `useResolvedAssetImages`, which puts real URLs back.
 */
export function neutralizeAssetSrcs(html: string): string {
  if (!html || html.indexOf("pf-asset:") === -1) return html;
  return html.replace(ASSET_ATTR_RE, (_m, attr: string, q: string, value: string) => ` data-pf-asset-${attr}=${q}${value}${q}`);
}

/**
 * Resolve the neutralized asset images inside `containerRef` (see
 * `neutralizeAssetSrcs`). Re-runs when `html` changes; releases every object
 * URL on cleanup.
 */
export function useResolvedAssetImages(containerRef: RefObject<HTMLElement | null>, html: string): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || html.indexOf("pf-asset:") === -1) return;
    const held: string[] = [];
    let live = true;
    for (const attr of ["src", "srcset"] as const) {
      root.querySelectorAll<HTMLElement>(`[data-pf-asset-${attr}]`).forEach((el) => {
        const ref = parseAssetRef(el.getAttribute(`data-pf-asset-${attr}`));
        if (!ref) return;
        held.push(ref.hash);
        void assetStore.acquireUrl(ref.hash).then((url) => {
          if (!live) return;
          if (url) {
            el.setAttribute(attr, url + ref.fragment);
          } else if (attr === "src") {
            el.setAttribute("src", missingSvg());
            el.setAttribute("title", missingImageTitle());
            el.setAttribute("data-pf-asset-missing", "");
          }
        });
      });
    }
    return () => {
      live = false;
      for (const h of held) assetStore.releaseUrl(h);
    };
  }, [containerRef, html]);
}
