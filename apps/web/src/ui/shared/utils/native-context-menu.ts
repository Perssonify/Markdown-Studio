import type { MouseEvent } from "react";

/**
 * Shift + right-click opens the BROWSER's menu where the app has its own — the
 * only route to the browser's spelling suggestions, which a page can neither
 * read nor recreate (Google Docs uses the same gesture). Pass as
 * `onContextMenuCapture` on a custom menu's trigger.
 *
 * Base UI's trigger cancels the native menu twice: its own `onContextMenu`, and
 * a `document` listener for any target inside the trigger. Stopping the event
 * in the CAPTURE phase keeps it from reaching either (React dispatches capture
 * handlers from the root's capture listener, so the native event never gets to
 * the target or bubbles), and the default — the browser's menu — is left alone.
 *
 * Only for the MOUSE: Shift+F10 also arrives as a `contextmenu` with
 * `shiftKey` set, and a keyboard user asking for the app's menu must get it.
 * Chromium reports a keyboard-opened menu as a PointerEvent with an empty
 * `pointerType`; where the event is a plain MouseEvent, a mouse's is button 2.
 * (Firefox shows its own menu on Shift + right-click without firing the event
 * at all.)
 */
export function passShiftContextMenuToBrowser(event: MouseEvent) {
  if (!event.shiftKey) return;
  const native = event.nativeEvent as globalThis.MouseEvent & { pointerType?: string };
  const fromKeyboard = typeof native.pointerType === "string" ? native.pointerType === "" : native.button !== 2;
  if (!fromKeyboard) event.stopPropagation();
}
