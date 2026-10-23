import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Is this keydown part of an IME composition (Japanese, Chinese, Korean, and
 * some voice-dictation inputs)?
 *
 * People confirm an input-method candidate with Enter. A handler that reads
 * that Enter as "submit" commits the raw reading — renaming a note to 日本
 * saved "にほん" and closed the box before the conversion could be chosen.
 * Every Enter handler on a text field returns early when this is true.
 *
 * `isComposing` covers Chrome and Firefox. Safari fires the confirming keydown
 * AFTER `compositionend`, with `isComposing` already false, and flags it only
 * with the legacy `keyCode` 229 ("IME is processing this key"), so both are
 * checked. Accepts React's synthetic event or a native one.
 */
export function isImeComposing(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  const native = "nativeEvent" in e ? e.nativeEvent : e;
  return native.isComposing || native.keyCode === 229;
}
