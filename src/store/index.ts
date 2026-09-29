export { createDocument, generateId, deriveTitleFromCanonical, extractText, computeCounts, toSummary, extractFields, extractTags, syncFieldsToMetadata } from "./document";
export { ingest, completeIngest, ingestPaste } from "./ingest";
export {
  createStorageAdapter,
  hasMetrics,
  WindowStorageAdapter,
  MemoryStorageAdapter,
  IndexedDBStorageAdapter,
  StorageQuotaError,
  type StorageAdapter,
  type IDBStorageConfig,
  type StorageMetrics,
} from "./storage-adapter";
export { useDocumentStore } from "./documentStore";
export { useUIStore } from "./uiStore";
export { useEditorStore } from "./editorStore";
export { computeFidelity } from "./fidelity";
export { importFile, importFiles, importImage, getFileContentAndFormat, exportAsMarkdown, exportAsHtml, exportAsJson } from "./import-export";
export { buildLinkIndex, updateDocInIndex, getBacklinks, getForwardLinks, exportGraph, scanWikiLinks, resolveTarget } from "./link-index";
