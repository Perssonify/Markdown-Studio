# Runbook — Documents Disappeared

**Do not tell a user their work is gone until you have checked all four
recovery paths below.** Most "it's gone" reports are recoverable in the app
itself, and the first thing a support reply says decides whether the user keeps
the evidence (and the data) or clears site data in frustration.

## Symptoms
- The library (Files tab) is empty, or one document is missing or rolled back.
- A strip above the status bar says **"Your library here is empty"** — the app
  has detected that the browser cleared its storage (see
  [When the storage really is gone](#when-the-storage-really-is-gone)).
- "I typed something, closed the tab, and it's not there."
- Fewer documents after a browser restart, an OS update, "clear browsing data",
  or after opening the app on a different domain, browser, or profile.

## First: ask for two things
1. **Copy diagnostics** (crash screen, or Help ▸ About). It lists recent failed,
   refused or conflicted saves and boot-watchdog recoveries — never document
   content. `save-error` = a write failed and is being retried; `save-blocked` =
   the app refused to overwrite a document with an empty editor, or kept a
   document made by a newer version read-only; `save-conflict` = another tab
   wrote it first. A save refused because storage is full (`full`) is NOT
   recorded — see [storage-quota-exceeded.md](storage-quota-exceeded.md).
2. **Where they use it**: the exact address (storage is per-ORIGIN — `www.` and
   the bare domain, a preview URL, or an old domain are different libraries),
   the browser and profile, and whether it is a private window (private-window
   storage is discarded when the window closes). A library on the old address,
   markdowneditor.perssonify.com, stays there: a build deployed on that address
   shows a "has moved" banner with a one-click full backup to import here
   (deploying it there is an owner action, A004).

## The recovery paths, in order

### 1. Version history — Tools ▸ Version history
A separate IndexedDB database (`perssonify-snapshots`) keeps earlier versions of
every document: up to 20 per document, for up to 30 days, ~12 MB in total. It
never evicts the most recent snapshot of a document that still exists; a
DELETED document's last copy expires with the 30-day limit like any other
(A079). It records a version when an autosave is about to overwrite older
content (at most one every 90 s per document), always before a large shrink or
an explicit clear (`pre-clear`), before a restore (`pre-restore`), and **before
a document is deleted (`pre-delete`)**. It also keeps the version a card edit
replaces when the note holds something a card cannot carry, a card edit that
could not be saved, and an unload-stash draft (below) that was already in
conflict with another tab.

- A rolled-back or emptied document: open it, then Version history ▸ **Restore**
  on the version wanted (the current content is snapshotted first, so this is
  reversible).
- A **deleted** document: Version history lists it under **"Other & deleted
  documents"** — **As new** restores it as a new document.
- The buttons are disabled in read-only mode; turn read-only off first.
- Deleting a document offers **Erase history** in its toast. If the user
  pressed it, that document's versions are gone.

### 2. The unload stash — automatic, on the next visit
Text typed inside the autosave window and then lost to a reload or a closed tab
is written synchronously to `localStorage` (`pf:recovery`) as the page unloads
(`beforeunload` and `pagehide`), because IndexedDB cannot finish a write while a
page is being torn down. Several tabs closing together each add their own
documents to it. On the next start, `documentStore.initialize()` adopts it — for
documents that still exist, and only when the stash is newer than what is on
disk — as an **unsaved draft** (status bar: "Unsaved changes"); the next
autosave writes it. A draft written on top of a version that another tab has
since replaced opens in the conflict state instead ("Changed in another tab —
not saving"), so it cannot overwrite that tab's work (A018); a conflicted draft
that is older than what is on disk goes to Version history.

It is **one-shot** (removed as it is read, so it cannot resurrect itself over
newer work), expires after 7 days, and holds at most 2 MB. So: ask the user to
**open the app again in the same browser and profile** before anything else.

### 3. Backups they made
File ▸ Export ▸ **Full backup (.zip) — restorable**, or an earlier export.
Import the ZIP (drag it onto the editor, File ▸ Import ▸ File(s) / archive…, or
**Import a backup…** on the empty-library notice): documents come back with
their folders, titles, tags and creation dates; the modified date becomes the
time of the import.

A backup larger than the importer's archive limits — 5 MB compressed, 500
documents, 5 MB per document, 20 MB uncompressed — is refused and reported only
as a skipped file. Unzip it and import the `.json` files directly (each file up
to 5 MB; they land at the top level, not in their folders).

### 4. The raw database (only when a document exists but will not open)
The library list rebuilds itself: `storage.list()` compares the manifest with
the ids actually stored and rebuilds it from the documents whenever it is
missing, unreadable or out of step (A030), so a document is never hidden just
because the list lost it. What it cannot recover is a record that will not
PARSE: a rebuild leaves it out, startup skips it, and opening it (while it is
still listed) says "That document could not be opened".

In DevTools on the app's own origin, console:

```js
const db = await new Promise((r, j) => { const q = indexedDB.open("perssonify-docs"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
const get = (store, key) => new Promise((r) => { db.transaction(store).objectStore(store).get(key).onsuccess = (e) => r(e.target.result); });
const allKeys = await new Promise((r) => { db.transaction("documents").objectStore("documents").getAllKeys().onsuccess = (e) => r(e.target.result); });
const manifest = JSON.parse((await get("meta", "__manifest")) || '{"documents":[]}');   // stored as a JSON STRING
const listed = new Set(manifest.documents.map((d) => d.id));
console.table({ storedRecords: allKeys.length, listedInManifest: listed.size });
console.log("stored but not listed:", allKeys.filter((k) => !listed.has(k)));
```

- **Both empty** → the browser's storage for this origin is gone (see below).
- **Stored but not listed** (after the app has loaded once), or listed but
  "could not be opened" → a record that does not parse. Get the raw text out
  rather than editing the database: `await get("documents", id)` is the stored
  JSON string; save it (e.g. `copy(await get("documents", id))`) and file a bug
  with it so a developer can recover the content. Do not hand-edit `meta` on a
  user's machine.
- **`__prefs.lastActiveDocId` points at a missing id** → only the restore of
  the last-open document is affected; `initialize()` falls back to the most
  recently updated document.

## When the storage really is gone
Browser storage for an origin can be removed by "clear browsing data", by
Safari's seven-day cap on script-writable storage for sites that are not
installed to the Home Screen/Dock, by Chromium evicting a non-persistent origin
under disk pressure, and by private windows closing. Version history lives in
the same origin's storage and goes with it. Only backups/exports survive.

What the app does about it (A017, A022):
- It asks the browser to keep this origin's data (`navigator.storage.persist()`)
  after the first successful save. Settings ▸ **Storage & backup** shows whether
  that was granted, and how much space is used.
- It reminds the user to make a full backup when the last one is more than 7
  days old (or a day after the first save, if there has never been one), and
  shows Safari/iOS users a tip to install the app.
- A localStorage canary (`pf:library-canary`) remembers how many documents the
  origin held. If IndexedDB comes back empty while the canary remembers
  documents, the starter documents are NOT seeded and the "Your library here is
  empty" notice offers **Import a backup…**, **Version history** (when it holds
  anything) and **Start fresh**. A wipe that also cleared localStorage looks
  exactly like a first visit and is treated as one.
- When storage cannot be used at all (blocked site data, some private windows),
  a strip that cannot be dismissed says **"Not saving — browser storage is
  unavailable in this window"**. Nothing typed in that window is kept after it
  closes unless it is exported.

What is NOT a cause: the **boot watchdog** (inline in index.html; it
unregisters service workers and clears Cache Storage) and a **service-worker
update** (it replaces the cached app files) never delete anything from IndexedDB
or localStorage — the watchdog only adds a `pf:boot-recovered` note.

## Prevention
- A **Full backup** is the only copy that survives the browser losing the
  origin's storage. Say so plainly.
- Installing the app (Home Screen / Dock) exempts it from Safari's seven-day
  eviction.

## Escalation
No on-call. File an issue with: browser + version, the address used, whether
storage was cleared, the Copy-diagnostics text, and the console output of the
snippet above. The write path is [src/store/documents/documentStore.ts](../../src/store/documents/documentStore.ts)
(`saveActiveDoc`, `initialize`) + [src/store/persistence/idb-storage-adapter.ts](../../src/store/persistence/idb-storage-adapter.ts);
the snapshot ring is [src/store/history/snapshot-store.ts](../../src/store/history/snapshot-store.ts);
the unload stash is [src/store/persistence/crash-recovery.ts](../../src/store/persistence/crash-recovery.ts);
persistence, the backup reminder and the canary are
[src/store/persistence/storage-durability.ts](../../src/store/persistence/storage-durability.ts).
