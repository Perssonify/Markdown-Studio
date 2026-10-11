# Runbook — Storage Quota Exceeded

## Symptoms
- The status bar reads **"Storage full — not saving"** ("Storage full" on a
  narrow screen). That is the save status `full`
  ([`SaveStatus`](../../src/store/documents/documentStore.ts#L190)), and it is TERMINAL:
  autosave stops retrying it on a timer.
- A toast, at most once every 30 s: "Storage is full — your latest changes are
  NOT saved. Free space by deleting documents or old versions (Tools ▸ Version
  history), then keep typing to retry." ⌘S shows the quota error itself.
- In a host app that passes `onStorageQuotaExceeded`, the host gets the
  `StorageQuotaError` instead of the toast.
- The typed text is still on screen; nothing has been lost yet.

## Diagnosis
1. **Whose limit?** There is no app-level cap. The IndexedDB adapter's limit is
   the browser's quota for this site, read from `navigator.storage.estimate()`;
   a `QuotaExceededError` from the browser becomes a
   [`StorageQuotaError`](../../src/store/persistence/idb-storage-adapter.ts#L76)
   ([`isQuotaExceeded`](../../src/store/persistence/idb-storage-adapter.ts#L164)). A host can
   set an optional HARD cap, `storageConfig`'s
   [`maxBytes`](../../src/store/persistence/idb-storage-adapter.ts#L71), which is checked
   inside the write transaction. The localStorage fallback (used only
   where IndexedDB is missing) is bounded by the browser's ~5 MB localStorage
   allowance.
2. **How full?** Settings ▸ **Storage & backup** shows "Using X of about Y this
   browser allows for this site" and whether storage is persistent. From the
   console on the app's origin:
   ```js
   navigator.storage.estimate().then(console.log);   // { usage, quota } for the whole origin
   ```
   The store's `storageMetrics` holds the same numbers (`usedBytes`,
   `maxBytes`, `pct`, `docCount`, `available`, `limitKnown`). The estimate
   covers the WHOLE origin: documents, version history (`perssonify-snapshots`,
   up to ~12 MB) and the service worker's precache of the app itself (~8 MB).
3. **Find the large document.** Usually one with pasted or imported **images**:
   they are stored inside the document as base64 data URLs
   ([src/store/importExport/import-export.ts](../../src/store/importExport/import-export.ts) `importImage`).
   Storing images as separate blobs is not built yet (A086, partial).

## Remediation
- **Keep a copy first:** File ▸ Export ▸ **Full backup (.zip) — restorable**.
  Exporting downloads a file and does not need space in browser storage.
- **Free space:** delete documents you do not need. A delete retries the parked
  save by itself ([`storageFreed`](../../src/store/documents/documentStore.ts#L1180)); so
  does **Erase history** in the toast that follows a delete. Deleting old
  versions in Tools ▸ Version history also frees space; then press **Save**
  (the toolbar's Save is enabled in the `full` state) or keep typing.
- **Shrink a document:** replace embedded images with links to hosted ones.
- **A host's cap:** raise or remove `storageConfig.maxBytes`. Beyond that, the
  browser's quota is the ceiling.
- **In an embed:** wire `onStorageQuotaExceeded` to show a message in the host
  app.

## Prevention
- The status bar shows a storage indicator once usage passes 60 % of a known
  limit. Where the browser gives no estimate (`limitKnown: false`), it never
  shows.
- Discourage pasting large images.

## Escalation
If saves are refused while the estimate shows plenty of room, file an issue
with the `storageMetrics` values, the `navigator.storage.estimate()` output and
the size of the failing document. The code is the save path in
[src/store/persistence/idb-storage-adapter.ts](../../src/store/persistence/idb-storage-adapter.ts)
(`save`, `_refreshEstimate`, `isQuotaExceeded`) and the `full` handling in
`saveActiveDoc` ([src/store/documents/documentStore.ts](../../src/store/documents/documentStore.ts)).
Note that a `full` save is not recorded in Copy diagnostics; only failed,
refused and conflicted saves are.
