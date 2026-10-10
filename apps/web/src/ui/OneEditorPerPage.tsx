import { useLayoutEffect, useState, type ReactNode } from "react";
import { APP_NAME } from "../constants";
import { claimEditorInstance, onEditorInstanceReleased, releaseEditorInstance } from "../store/documents/documentStore";
import { useT } from "../i18n";

/** What a refused editor logs, once per mount. */
export const SECOND_EDITOR_ERROR =
  `[MarkdownEditor] A second ${APP_NAME} editor was mounted while one is already running on this page, ` +
  "so it will not start. The editor's stores (the open document, unsaved drafts, the storage adapter) " +
  "belong to the whole page: two editors would share them, and typing in one could be saved into the " +
  "other's document. The first editor is unaffected. Mount one editor per page, or give each its own " +
  "iframe (the embed build).";

/**
 * One editor per page (A106).
 *
 * The editor's stores are module singletons, so a second editor mounted while
 * one is running used to share the active document and the injected storage
 * with it, silently. This gate claims the page's editor slot before the editor
 * renders at all — nothing below it runs, and no store is touched, until the
 * claim succeeds. A second editor gets a message instead and logs why; if the
 * first one unmounts, the waiting one takes over (as an ordinary remount).
 *
 * The claim is made in a LAYOUT effect, so the editor renders before the first
 * paint rather than one blank frame later, and it is released in THAT effect's
 * cleanup: a deleted editor's layout cleanups run before the layout effects of
 * one inserted in the same commit, so replacing one editor with another never
 * shows the refusal. (Releasing in a passive cleanup instead would free the
 * slot only after the newcomer had been refused.) StrictMode's simulated
 * unmount and remount release and re-claim with the same token, so it never
 * refuses the first editor.
 */
export function OneEditorPerPage({ children }: { children: ReactNode }) {
  // One identity per mounted editor; it survives re-renders and StrictMode's
  // unmount/remount (the component keeps its state across both).
  const [token] = useState(() => ({}));
  const [state, setState] = useState<"pending" | "owner" | "refused">("pending");

  useLayoutEffect(() => {
    let stopWaiting = () => {};
    if (claimEditorInstance(token)) {
      setState("owner");
    } else {
      setState("refused");
      console.error(SECOND_EDITOR_ERROR);
      stopWaiting = onEditorInstanceReleased(() => {
        if (!claimEditorInstance(token)) return;
        stopWaiting();
        setState("owner");
      });
    }
    return () => {
      stopWaiting();
      releaseEditorInstance(token);
    };
  }, [token]);

  if (state === "owner") return <>{children}</>;
  if (state === "refused") return <SecondEditorNotice />;
  return null;
}

/** Plain and self-styled: it renders in a host page, with no editor around it. */
function SecondEditorNotice() {
  const t = useT();
  return (
    <div
      role="alert"
      data-pf-second-editor=""
      style={{ padding: "12px 16px", border: "1px dashed currentColor", borderRadius: 6, font: "14px/1.5 system-ui, sans-serif" }}
    >
      {t("notices.onlyOneEditorPerPage", { app: APP_NAME })}
    </div>
  );
}
