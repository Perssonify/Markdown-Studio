# Runbook — Storage Quota Exceeded

## Symptoms
- A save fails; the user sees a quota/storage error toast.
- `saveStatus` sticks on `"error"` ([src/store/documentStore.ts](../../src/store/documentStore.ts)).
- Console shows a `StorageQuotaError`.

## Diagnosis
1. The adapter projects usage **before** writing and throws if it would exceed the cap ([src/store/idb-storage-adapter.ts:287](../../src/store/idb-storage-adapter.ts#L287)). Default cap is **50 MB** ([:67](../../src/store/idb-storage-adapter.ts#L67)).
2. Inspect current usage:
   ```js
   // app-level metrics (if exposed)
   navigator.storage.estimate().then(console.log);   // browser-level quota/usage
   ```
   Or read the store's `storageMetrics` (`usedBytes`, `maxBytes`, `pct`, `docCount`).
3. Find the culprit doc — usually one with large **base64 images** pasted/imported (images embed as data URLs, [src/store/import-export.ts](../../src/store/import-export.ts) `importImage`). Big tables/JSON also add up.

## Remediation
- **Free space:** Delete unneeded documents, or export-then-delete large ones (JSON export is lossless).
- **Shrink a doc:** Remove large embedded images; link to external images instead of pasting data URLs.
- **Raise the cap (deliberate):** the cap is configurable via the editor's `storageConfig` prop ([src/PerssonifyEditor.tsx](../../src/PerssonifyEditor.tsx) props) which feeds `maxBytes`. Raising it only helps up to the **browser's** real quota — `navigator.storage.estimate()` tells you the ceiling.
- **Handle it gracefully in an embed:** wire `onStorageQuotaExceeded` ([src/PerssonifyEditor.tsx](../../src/PerssonifyEditor.tsx)) to surface a host-app message.

## Prevention
- Discourage pasting large images; consider downscaling on import.
- Surface `storageMetrics.pct` in the UI so users see they're approaching the limit before a hard failure.

## Escalation
If the projected-usage math is wrong (rejecting saves that should fit), that's a bug in `_recomputeMetrics`/quota check ([src/store/idb-storage-adapter.ts:226](../../src/store/idb-storage-adapter.ts#L226)). File an issue with `storageMetrics` values and the failing doc size.
