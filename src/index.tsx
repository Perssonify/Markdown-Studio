"use client";
// Side-effect import so the library build emits dist/styles.css. Vite lib mode
// does NOT auto-inject it — consumers import "@perssonify/editor/styles.css".
import "./styles.css";
export { ErrorBoundary } from "./ui/ErrorBoundary";

export { useMarkdownEngine } from "./engine/useMarkdownEngine";
export { useSyncEngine } from "./engine/useSyncEngine";
export { BlockId, FieldBlock, TransclusionBlock } from "./extensions/index";
export { createAssociationStore, createEditorClient, createHostBridge, formatDocumentForPrompt, formatDocumentsForPrompt, mergeGraphWithAssociations, PerssonifyEditorIntegration } from "./integration/index";
export { PerssonifyEditor } from "./PerssonifyEditor";
export { clearLocalData, computeFidelity, createDocument, createStorageAdapter, ingest, useDocumentStore } from "./store/index";
export { createTheme } from "./theme/index";

