import type { Message } from "../types";

/** App shell and editor chrome: App.tsx, EditorHeader.tsx, PerssonifyEditor.tsx, skipToEditor/index.tsx. */
export const app = {
  "app.initializingEngine": "Initializing Engine...",
  "app.findAndReplace": "Find & Replace",
  "app.openWorkspacePanel": "Open workspace panel",
  "app.noDocumentOpen": "No document open",
  "app.noDocumentOpenHint": "Select a document from the Files panel or create a new one",
  "app.createNewDocument": "Create New Document",
  "app.loadingGraph": "Loading graph…",
  "app.loadingCards": "Loading cards…",
  "app.skipToEditor": "Skip to editor",
  "app.deletedRecoverableCopyKept": "Deleted — a recoverable copy is kept in Version history",
  "app.eraseHistory": "Erase history",
  "app.versionHistoryErased": "Version history of “{title}” erased",
  "app.versionHistoryCouldNotBeErased": "Version history could not be erased",
  "app.renameCouldNotBeSaved": "Rename could not be saved",
  "app.duplicateCouldNotBeSaved": "Duplicate could not be saved — storage may be full",
  "app.aboutTitle": "About · {app}",
  "app.helpTitle": "Help · {app}",
  "app.relationshipMapTitle": "Relationship map · {app}",
  "app.overlayMap": "Relationship map",
  "app.overlayCards": "Cards",
  "app.notifications": "Notifications",
} satisfies Record<`app.${string}`, Message>;
