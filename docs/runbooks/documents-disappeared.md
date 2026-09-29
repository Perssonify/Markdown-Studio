# Runbook — Documents Disappeared

## Symptoms
- A user reports their document list is empty or a specific doc is gone.
- Sidebar/tabs show fewer documents than expected after a browser restart, OS update, or "clear browsing data."

## Diagnosis
1. **Confirm it's storage, not rendering.** Open devtools → Application → IndexedDB → `perssonify-docs`. Inspect the `documents` and `meta` stores.
2. **Check the manifest vs documents:**
   ```js
   const db = await new Promise(r => { const q = indexedDB.open('perssonify-docs'); q.onsuccess = () => r(q.result); });
   db.transaction('meta','readonly').objectStore('meta').get('__manifest').onsuccess = e => console.table(e.target.result);
   ```
   - **Manifest empty + documents empty** → storage was cleared/evicted (most common). The browser dropped the IndexedDB partition.
   - **Manifest has entries but `documents` is missing records (or vice-versa)** → a desync (invariant #1 in [database.md](../database.md#invariants)), likely an interrupted write.
3. **Check the active-doc pref:** `meta → __prefs.lastActiveDocId` — if it points at a missing id, only the *restore* is broken, not the data.

## Remediation
- **Evicted storage (no data left):** It's unrecoverable from the app — IndexedDB has no built-in backup. If the user exported JSON earlier, re-import it ([features.md#13-import--export](../features.md#13-import--export)). Otherwise, gone.
- **Manifest/documents desync:** Rebuild the manifest from the surviving `documents` records. The cleanest path is to reload (the store re-derives summaries on `initialize()`, [src/store/documentStore.ts:160](../../src/store/documentStore.ts#L160)); if a stale `__prefs.lastActiveDocId` blocks load, clear it:
  ```js
  const tx = db.transaction('meta','readwrite');
  const s = tx.objectStore('meta');
  s.get('__prefs').onsuccess = e => { const p = e.target.result || {}; delete p.lastActiveDocId; s.put(p,'__prefs'); };
  ```
- **Wrong browser profile / incognito:** Data is per-origin and per-profile. Confirm the user is in the same browser profile and not a private window (incognito IndexedDB is discarded on close).

## Prevention
- Tell users to **export important docs as JSON** periodically (lossless). 
- A future hardening: call `navigator.storage.persist()` to request persistent storage (not currently done) — would reduce eviction risk.

## Escalation
No on-call. File a GitHub issue with: browser + version, whether storage was cleared, and a copy of the `__manifest` dump. If it's a desync bug, attach repro steps — the write path is [src/store/documentStore.ts](../../src/store/documentStore.ts) + [src/store/idb-storage-adapter.ts](../../src/store/idb-storage-adapter.ts).
