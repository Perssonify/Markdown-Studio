import type React from "react";

/**
 * "Skip to editor" (A094, WCAG 2.4.1 Bypass Blocks).
 *
 * Before this, a keyboard user reached the document only after the header, the
 * menu bar, the surface switcher, the whole formatting toolbar and the library.
 * The link is the first stop on the page, visible only while focused.
 *
 * It FOCUSES the editor rather than jumping to a fragment: a fragment moves the
 * sequential-navigation start point in some browsers and not others, leaves a
 * `#hash` in the address bar, and cannot put the caret in a CodeMirror or
 * ProseMirror surface — which is where the user wants to be.
 */

/** The editing surface the skip link should land in: the first VISIBLE pane
 *  (the markdown pane is first in split view; a single-pane view hides the
 *  other with `hidden`). Falls back to the first control in <main> — the
 *  "Create New Document" button when no document is open. */
export function findEditorFocusTarget(root: ParentNode = document): HTMLElement | null {
  const panes = root.querySelectorAll<HTMLElement>(
    '[data-tour="editor"] .cm-content, [data-tour="editor"] .ProseMirror',
  );
  for (const el of Array.from(panes)) {
    if (el.closest(".hidden, [hidden], [inert]")) continue;
    return el;
  }
  const main = root.querySelector("main");
  return main?.querySelector<HTMLElement>("button:not(:disabled), [href], [tabindex='0']") ?? null;
}

export function SkipToEditor() {
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    findEditorFocusTarget()?.focus();
  };
  return (
    <a
      href="#editor"
      onClick={onClick}
      data-print-hide
      className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[200] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg"
    >
      Skip to editor
    </a>
  );
}
