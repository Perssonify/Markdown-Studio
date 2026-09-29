/**
 * Should a workspace overlay (the Cards board, the relationship map) act on
 * this Escape?
 *
 * Both surfaces — and the editor shell around them — used to listen for Escape
 * on `window`/`document` in the CAPTURE phase, which runs before anything else
 * on the page. So Escape meant "close the overlay" no matter what it was pressed
 * in: cancelling a card's delete confirmation closed the whole board (the
 * dialog never even heard the key); Escape in a library rename box closed the
 * map, and the blur that followed COMMITTED the rename the user meant to
 * cancel. The overlay now listens in the bubble phase and only claims the key
 * when:
 *  - nothing earlier handled it (`defaultPrevented`) and it is not ending an
 *    IME composition;
 *  - it was pressed INSIDE the overlay — or with nothing focused at all, where
 *    no other control could want it;
 *  - no modal dialog, menu or listbox is open outside the overlay (they own
 *    Escape even when focus has not moved into them).
 *
 * `root` is any element of the surface; the whole overlay (PerssonifyEditor's
 * `[data-workspace-overlay]` shell, which is what holds focus when the overlay
 * opens) is found from it.
 */
export function overlayShouldHandleEscape(e: KeyboardEvent, root: Element | null): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return false;
  const surface = root?.closest("[data-workspace-overlay]") ?? root;
  if (!surface) return false;
  const target = e.target as Node | null;
  const unfocused =
    !target || target === document || target === document.body || target === document.documentElement;
  if (!unfocused && !surface.contains(target)) return false;
  return !openPopupOutside(surface);
}

const POPUPS = '[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function openPopupOutside(surface: Element): boolean {
  for (const el of Array.from(document.querySelectorAll(POPUPS))) {
    if (surface.contains(el)) continue;
    if (isShown(el)) return true;
  }
  return false;
}

/** Actually on screen. Some popups stay MOUNTED while closed — the emoji
 *  suggestion list is a `role="listbox"` parked on <body> with display:none —
 *  and counting those as open made the board ignore every Escape. */
function isShown(el: Element): boolean {
  if (el.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const style = getComputedStyle(n);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}
