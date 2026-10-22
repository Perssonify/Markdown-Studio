import type { Message } from "../types";

/** Notices, banners and error screens: durabilityNotices/index.tsx, tabSyncNotice/index.tsx, errorBoundary/index.tsx, lazyChunkBoundary/index.tsx, diagnosticsActions/index.tsx, oneEditorPerPage/index.tsx, adUnit/index.tsx, toast/index.tsx, pwa/sw-updates.ts. */
export const notices = {
  // DurabilityNotices — storage unavailable
  "notices.notSaving": "Not saving",
  "notices.notSavingBrowserStorageIs": "Not saving — browser storage is unavailable in this window.",
  "notices.thisHappensInSomePrivate": "This happens in some private windows and when a browser blocks site data. Your writing stays on screen until you close the tab — use File ▸ Export to keep a copy.",

  // DurabilityNotices — library wiped
  "notices.libraryCleared": "Library cleared",
  "notices.importABackup": "Import a backup…",
  "notices.versionHistory": "Version history",
  "notices.startFresh": "Start fresh",
  "notices.yourLibraryHereIsEmpty": "Your library here is empty.",
  "notices.wipedHeldDocumentsAgo": {
    one: "This browser held {count} document on this site ({ago}), so its storage appears to have been cleared — browsers do this after a long gap between visits, when disk space runs low, or when site data is deleted.",
    other: "This browser held {count} documents on this site ({ago}), so its storage appears to have been cleared — browsers do this after a long gap between visits, when disk space runs low, or when site data is deleted.",
  },
  "notices.wipedHeldDocuments": {
    one: "This browser held {count} document on this site, so its storage appears to have been cleared — browsers do this after a long gap between visits, when disk space runs low, or when site data is deleted.",
    other: "This browser held {count} documents on this site, so its storage appears to have been cleared — browsers do this after a long gap between visits, when disk space runs low, or when site data is deleted.",
  },
  "notices.wipedRestoreBackup": "Restore a full backup (.zip) if you have one.",
  "notices.wipedRestoreBackupOrHistory": "Restore a full backup (.zip) if you have one, or look in Version history.",

  // DurabilityNotices — moved domain
  "notices.appHasMoved": "{app} has moved",
  "notices.downloadAgain": "Download again",
  "notices.downloadBackup": "Download backup",
  "notices.openDomain": "Open {domain}",
  "notices.hideForNow": "Hide for now",
  "notices.appHasMovedTo": "{app} has moved to {domain}.",
  "notices.movedBackedUp": "You downloaded a full backup {ago}. Now open {domain} and import it there (File ▸ Open file…).",
  "notices.movedNotBackedUp": "Your documents are stored in this browser for this address only — download a full backup, then import it at {domain} (File ▸ Open file…).",

  // DurabilityNotices — backup reminder
  "notices.backupReminder": "Backup reminder",
  "notices.notNow": "Not now",
  "notices.lastFullBackup": "Last full backup: {ago}.",
  "notices.noFullBackupYet": "No full backup yet.",
  "notices.yourDocumentsLiveOnlyIn": "Your documents live only in this browser. A backup (.zip) restores your whole library, folders included, in any browser.",

  // DurabilityNotices — install tip
  "notices.keepYourLibrary": "Keep your library",
  "notices.gotIt": "Got it",
  "notices.safariMayDeleteThisSite": "Safari may delete this site's data after 7 days without a visit.",
  "notices.installTipMobile": "To keep your library, add {app} to your Home Screen (Share ▸ Add to Home Screen) and keep a backup.",
  "notices.installTipDesktop": "To keep your library, add {app} to your Dock (File ▸ Add to Dock) and keep a backup.",

  // ErrorBoundary — crash screen
  "notices.exportMyDocuments": "Export my documents",
  "notices.copyDiagnostics": "Copy diagnostics",
  "notices.diagnosticsCopiedPasteThem": "Diagnostics copied — paste them into your report. They contain no document content.",
  "notices.couldNotReachClipboard": "Couldn't reach the clipboard.",
  "notices.exportedDocumentsAsBackup": {
    one: "Exported {count} document as a backup ZIP. Import it to restore.",
    other: "Exported {count} documents as a backup ZIP. Import it to restore.",
  },
  "notices.noStoredDocumentsToExport": "There were no stored documents to export.",
  "notices.exportFailedToo": "The export failed too. Your documents are still in this browser's storage — don't clear site data.",
  "notices.youReOfflineTryAgain": "You're offline — try again when you're connected.",
  "notices.partOfTheAppCouldNotLoad": "Part of the app couldn't load",
  "notices.editorCrashed": "Editor Crashed",
  "notices.appFileCouldNotBeDownloaded": "A file the app needs could not be downloaded. Reloading usually fixes this.",
  "notices.appOfflineFileNotSaved": "You're offline and a file the app needs isn't saved on this device yet. Reload once you're back online.",
  "notices.unexpectedRenderError": "An unexpected error occurred while rendering the editor.",
  "notices.recoverEditor": "Recover Editor",

  // LazyChunkBoundary
  "notices.thisPanel": "This panel",
  "notices.panelCouldNotBeLoaded": "{what} couldn't be loaded",
  "notices.panelRanIntoAnError": "{what} ran into an error",
  "notices.panelFileCouldNotBeDownloaded": "A file it needs could not be downloaded. Reload to fix it — your documents are kept.",
  "notices.panelOfflineNotSaved": "You're offline and it isn't saved on this device yet. Reload once you're back online.",
  "notices.panelClosedDocumentsNotAffected": "It has been closed so the editor keeps working. Your documents are not affected.",
  "notices.tryAgain": "Try again",

  // DiagnosticsActions
  "notices.copiedNoDocumentContent": "Copied — it contains no document content.",

  // OneEditorPerPage
  "notices.onlyOneEditorPerPage": "Only one {app} editor can be open on a page. Another one is already open here, so this one did not start.",

  // AdUnit (development builds only)
  "notices.ad": "Ad",
  "notices.closeAd": "Close ad",
  "notices.yourAdHere": "Your Ad Here",
  "notices.reachThousandsOfWriters": "Reach thousands of writers",
  "notices.sponsored": "Sponsored",
  "notices.reachThousandsOfDevelopersAnd": "Reach thousands of developers & writers every day",
  "notices.learnMore": "Learn More →",

  // pwa/sw-updates.ts
  "notices.updateReadyTitle": "A new version of {app} is ready",
  "notices.updateReadyDescription": "Reload when it suits you — nothing changes until you do.",
  "notices.updateActivatedTitle": "{app} was updated in another tab",
  "notices.updateActivatedDescription": "Reload this tab to finish updating. It will not reload while you have unsaved changes.",
  "notices.updateOfflineTitle": "You're offline",
  "notices.updateOfflineDescription": "The update will be ready to apply once you're back online.",
  "notices.updateApplyingTitle": "Updating…",
  "notices.updateApplyingDescription": "{app} will reload in a moment.",
  "notices.today": "today",
  "notices.yesterday": "yesterday",
  "notices.daysAgo": { other: "{count} days ago" },
  "notices.closeToast": "Close toast",

  // TabSyncNotice — another tab changed or deleted the open document
  "notices.tabChangedLabel": "Changed in another tab",
  "notices.tabChangedHeadline": "This document was changed in another tab.",
  "notices.tabChangedBody": "Your changes here aren't saved yet, so this tab won't save until you choose. The version you set aside is kept in Version history.",
  "notices.tabChangedBodyNoHistory": "Your changes here aren't saved yet, so this tab won't save until you choose. Version history is off here — save yours as a copy to keep both.",
  "notices.tabKeepMine": "Keep mine",
  "notices.tabKeepMineTitle": "Save this tab's version over the other one — theirs is kept in Version history",
  "notices.tabKeepMineReadOnly": "Read-only mode is on — turn it off to save over the other version",
  "notices.tabUseTheirs": "Use theirs",
  "notices.tabUseTheirsTitle": "Show the other tab's version here — yours is kept in Version history",
  "notices.tabSaveCopy": "Save mine as a copy",
  "notices.tabSaveCopyTitle": "Save this tab's version as a new document, then show the other tab's version here",
  "notices.tabDeletedLabel": "Deleted in another tab",
  "notices.tabDeletedHeadline": "This document was deleted in another tab.",
  "notices.tabDeletedBody": "It isn't saved here any more. Keep it as a new document, or close it — Version history keeps a copy.",
  "notices.tabKeepAsNew": "Keep as a new document",
  "notices.tabClose": "Close",

  // SharedDocNotice — a shared document that is read-only here
  "notices.liveLabel": "Live shared document",
  "notices.liveHeadline": "Live copy — it updates when its owner edits it.",
  "notices.liveBody": "It is read-only here, because the next update would replace anything you type. Stop following to keep it as your own document.",
  "notices.liveUpdatedAt": "Updated {when}.",
  "notices.liveStop": "Stop following",
  "notices.liveStopConfirmTitle": "Stop following this document?",
  "notices.liveStopConfirmBody": "It stays in your library as your own document, and you can edit it — but it will not get the owner's changes any more.",
  "notices.liveEndedLabel": "No longer shared",
  "notices.liveEndedHeadline": "Its owner stopped sharing this document.",
  "notices.liveEndedBody": "It will not change any more. This copy is yours to keep and edit.",
  "notices.liveEndedDismiss": "Got it",
  "notices.readOnlyShareLabel": "Shared read-only",
  "notices.readOnlyShareHeadline": "Shared with you read-only.",
  "notices.readOnlyShareBody": "This is your own copy: make it editable whenever you like.",
  "notices.makeEditable": "Make editable",
  "notices.analyticsConsentLabel": "Analytics cookies",
  "notices.analyticsConsent": "May {app} use analytics cookies? Google Analytics counts visits and which pages are opened — never your documents, their names or your share links. You can change this in Settings ▸ Privacy.",
  "notices.analyticsAllow": "Allow",
  "notices.analyticsDecline": "Decline",
} satisfies Record<`notices.${string}`, Message>;
