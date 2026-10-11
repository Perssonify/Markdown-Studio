export { createDocument, generateId, deriveTitleFromCanonical, extractText, computeCounts, toSummary, extractFields, extractTags, syncFieldsToMetadata } from "./documents/document";
export { ingest, completeIngest, ingestPaste } from "./importExport/ingest";
export {
  createStorageAdapter,
  hasMetrics,
  WindowStorageAdapter,
  MemoryStorageAdapter,
  IndexedDBStorageAdapter,
  StorageQuotaError,
  StorageReadError,
  type StorageAdapter,
  type IDBStorageConfig,
  type StorageMetrics,
} from "./persistence/storage-adapter";
export { useDocumentStore, clearLocalData, configureLocalStores } from "./documents/documentStore";
export { useUIStore } from "./preferences/uiStore";
export { useEditorStore } from "./editor/editorStore";
export { computeFidelity } from "./documents/fidelity";
export { importFile, importFiles, importImage, getFileContentAndFormat, exportAsMarkdown, exportAsHtml, exportAsJson } from "./importExport/import-export";
export { buildLinkIndex, updateDocInIndex, getBacklinks, getForwardLinks, exportGraph, scanWikiLinks, resolveTarget } from "./links/link-index";
