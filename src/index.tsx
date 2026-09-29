"use client";
// Side-effect import so the library build emits dist/styles.css. Vite lib mode
// does NOT auto-inject it — consumers import "@perssonify/editor/styles.css".
import "./styles.css";
import {
  BlockId as BlockIdExtension,
  FieldBlock as FieldBlockNode,
  TransclusionBlock as TransclusionBlockNode,
} from "./extensions/index";
import { warnDeprecated } from "./integration/deprecation";
export { ErrorBoundary } from "./ui/ErrorBoundary";

export { useMarkdownEngine } from "./engine/useMarkdownEngine";
export { useSyncEngine } from "./engine/useSyncEngine";
export { createAssociationStore, createEditorClient, createHostBridge, formatDocumentForPrompt, formatDocumentsForPrompt, mergeGraphWithAssociations, PerssonifyEditorIntegration } from "./integration/index";
export { PerssonifyEditor } from "./PerssonifyEditor";
export { clearLocalData, computeFidelity, createDocument, createStorageAdapter, ingest, useDocumentStore } from "./store/index";
export { createTheme } from "./theme/index";

// These three are exported for compatibility only. The editor never registers
// them — neither in its live schema nor in the serializer — so adding them to
// your own Tiptap editor gives you nodes/attributes that PerssonifyEditor does
// not render, and BlockId's ids do not survive a Markdown round trip. Each warns
// once, in development, when an editor is constructed with it.
const NOT_REGISTERED =
  "the editor does not register it, and it does not round-trip through Markdown. It will be removed in a future major version.";

/** @deprecated Not registered by the editor; block ids do not round-trip through Markdown. */
export const BlockId = BlockIdExtension.extend({
  onBeforeCreate(event) {
    warnDeprecated("The `BlockId` export", NOT_REGISTERED);
    this.parent?.(event);
  },
});

/** @deprecated Not registered by the editor; `:::fields:::` blocks are handled as Markdown text. */
export const FieldBlock = FieldBlockNode.extend({
  onBeforeCreate(event) {
    warnDeprecated("The `FieldBlock` export", NOT_REGISTERED);
    this.parent?.(event);
  },
});

/** @deprecated Not registered by the editor; `![[…]]` embeds are not rendered by it. */
export const TransclusionBlock = TransclusionBlockNode.extend({
  onBeforeCreate(event) {
    warnDeprecated("The `TransclusionBlock` export", NOT_REGISTERED);
    this.parent?.(event);
  },
});
