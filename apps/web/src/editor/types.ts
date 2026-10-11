/**
 * The dependency vocabulary of the editor's hooks.
 *
 * `PerssonifyEditor` is an orchestrator: it owns the stores, the refs and the
 * engines, and hands each hook in `src/editor/` exactly the pieces it uses.
 * These aliases name those pieces by where they come from (`ReturnType` of the
 * hook or store that produces them), so a hook's parameter list states its
 * dependencies without restating their signatures — and follows them when
 * they change.
 */
import type { RefObject } from "react";
import type { useMarkdownEngine } from "../engine/useMarkdownEngine";
import type { useSyncEngine } from "../engine/useSyncEngine";
import type { useFormatDispatcher } from "../formatting/useFormatDispatcher";
import type { useDocumentLifecycle } from "../hooks/useDocumentLifecycle";
import type { useDialogs } from "../hooks/useDialogs";
import type { useLinkIndex } from "../hooks/useLinkIndex";
import type { useDocumentStore } from "../store/documents/documentStore";
import type { useEditorStore } from "../store/editor/editorStore";
import type { useUIStore } from "../store/preferences/uiStore";
import type { CodeMirrorPaneHandle } from "../ui/panes/codeMirrorPane";
import type { useConfirm } from "../ui/dialogs/confirmDialog";
import type { useToast } from "../ui/shared/toast";
import type { TiptapPaneHandle } from "../ui/panes/tiptapPane";

/** The markdown pane (CodeMirror). */
export type CmRef = RefObject<CodeMirrorPaneHandle | null>;
/** The rich pane (TipTap) — the canonical source of truth. */
export type TiptapRef = RefObject<TiptapPaneHandle | null>;

export type DocStore = ReturnType<typeof useDocumentStore.getState>;
export type UIStore = ReturnType<typeof useUIStore.getState>;
export type EditorStore = ReturnType<typeof useEditorStore.getState>;
export type Lifecycle = ReturnType<typeof useDocumentLifecycle>;
export type SyncEngine = ReturnType<typeof useSyncEngine>;
export type Engine = ReturnType<typeof useMarkdownEngine>["engine"];
export type LinkIndexApi = ReturnType<typeof useLinkIndex>;
export type FormatDispatcher = ReturnType<typeof useFormatDispatcher>;
export type Toast = ReturnType<typeof useToast>;
export type PromptText = ReturnType<typeof useDialogs>["prompt"];
export type EquationPrompt = ReturnType<typeof useDialogs>["equation"];
export type Confirm = ReturnType<typeof useConfirm>["confirm"];
