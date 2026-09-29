/**
 * Can the bottom tray open without squeezing the editor to nothing?
 *
 * The tray and the editor are siblings in a column that is `overflow-hidden`,
 * and each has a floor: the tray caps at `min(35dvh, 16rem)` and the editor
 * column carries `min-h-[10rem]`. Those floors stop the editor DISAPPEARING,
 * which was the original defect, but they cannot conjure space that is not
 * there. On a short viewport the sum simply does not fit, and because the
 * editor's floor is not shrinkable the overflow lands on the tray and the
 * status bar instead — the bottom of the app gets clipped.
 *
 * It is worse than the arithmetic suggests below 768px, where the split panes
 * STACK: the surviving editor height is then divided between two panes, each
 * of which spends part of it on a header. 160px of column becomes roughly
 * 45-50px of text per pane.
 *
 * So the honest rule is that there is a height below which the tray should not
 * open at all, and the user should be told why rather than handed a clipped
 * layout. Pure and unit-tested because the alternative — reading it off a live
 * layout — is exactly the kind of thing that silently stops being true.
 */

/** Below this, the tray cannot show a usable row of content. */
export const TRAY_MIN_PX = 120;

/**
 * What the editor column must keep. Matches the `min-h-[10rem]` floor already
 * on that element; the two must move together, which is why the number lives
 * here with a name rather than twice as a literal.
 */
export const EDITOR_FLOOR_PX = 160;

/**
 * `available` is the current height of the region the tray and editor share.
 * Returns true when opening the tray still leaves the editor its floor.
 */
export function trayFits(available: number): boolean {
  if (!Number.isFinite(available) || available <= 0) return true; // unmeasurable → don't block
  return available - TRAY_MIN_PX >= EDITOR_FLOOR_PX;
}
