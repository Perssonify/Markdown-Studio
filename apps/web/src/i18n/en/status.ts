import type { Message } from "../types";

/** Status bar and bottom tray: statusBar/index.tsx, bottomTray/index.tsx, backlinksPanel/index.tsx, residualsDialog/index.tsx, consolePanel/index.tsx, editor/useBottomTray.tsx. */
export const status = {
  // Status bar: the tray toggle and the document context.
  "status.panel": "Panel",
  "status.panelTray": "Panel tray",
  "status.collapsePanelTray": "Collapse panel tray",
  "status.expandPanelTray": "Expand panel tray (Document links, tools)",
  "status.currentViewMode": "Current view mode",
  "status.modeMarkdown": "Markdown",
  "status.modeRichText": "Rich text",
  "status.modeSplit": "Split",
  /** Appended to the view-mode label, separator included. */
  "status.readOnlySuffix": " · Read-only",
  "status.fidelityLossTitle": {
    other: "{count} formatting detail(s) in this document cannot be written as Markdown (alignment has no Markdown or HTML carrier at all; colour, highlight and font are stripped in Clean mode). They stay in the rich pane, but will not survive an export.",
  },
  "status.residualsTitle": {
    other: "{count} thing(s) in the imported source have no place in the document model — click for details",
  },
  "status.residualCount": { one: "{count} residual", other: "{count} residuals" },
  "status.linksChipTitle": "Document links — backlinks & outgoing (click to expand)",
  "status.linkCount": { one: "{count} link", other: "{count} links" },
  /** Appended to the link count, separator included. */
  "status.brokenSuffix": { other: " · {count} broken" },

  // Status bar: save state. `{error}` is the storage error's own message.
  "status.saveFailedTitle": "{error} — retrying. Your work is still on screen; copy anything you cannot lose.",
  "status.saveFailedRetrying": "Save failed — retrying",
  "status.saveFailed": "Save failed",
  "status.unsavedChanges": "Unsaved changes",
  "status.saving": "Saving…",
  "status.changesSaved": "Changes saved",
  "status.blockedTitle": "The editor is empty but this document is not. Saving is paused so the stored version cannot be overwritten — reload to get it back, or use Clear document if you meant to empty it.",
  "status.emptyEditorNotSaving": "Empty editor — not saving",
  "status.notSaving": "Not saving",
  "status.schemaLockTitle": "This document was made by a newer version of the app. It is shown read-only so its content cannot be overwritten — open it in the newer version to edit it.",
  "status.newerVersionReadOnly": "Newer version — read-only",
  "status.readOnly": "Read-only",
  "status.storageFullTitle": "Storage is full, so your latest changes are not saved. Delete documents or old versions (Version history) to free space, then keep typing to retry.",
  "status.storageFullNotSaving": "Storage full — not saving",
  "status.storageFull": "Storage full",
  "status.conflictTitle": "This document was changed in another tab or window. To avoid overwriting that work, this tab won't save until you choose Keep mine, Use theirs or Save mine as a copy.",
  "status.conflictNotSaving": "Changed in another tab — not saving",
  "status.tabConflict": "Tab conflict",
  "status.deletedTitle": "This document was deleted in another tab or window. This tab won't save it back — keep it as a new document or close it.",
  "status.deletedNotSaving": "Deleted in another tab — not saving",
  "status.deletedElsewhere": "Deleted elsewhere",

  // Status bar: what the live region SAYS (save-announcer.ts) — failures and recovery only.
  "status.announceSaveFailed": "Save failed. Retrying; your work is still on screen.",
  "status.announceBlocked": "Not saving: the editor is empty but the stored document is not.",
  "status.announceConflict": "Not saving: this document was changed in another tab.",
  "status.announceDeleted": "Not saving: this document was deleted in another tab.",
  "status.announceRecovered": "Changes saved.",

  // Status bar: counters and tools. `{used}`/`{max}` are megabytes, already formatted.
  "status.storageTitle": "Local storage: {pct}% used ({used} MB of {max} MB)",
  "status.totalWords": "Total words",
  "status.wordCountShort": { other: "{count}w" },
  "status.totalCharacters": "Total characters",
  "status.charCountShort": { other: "{count}c" },
  "status.keyboardShortcuts": "Keyboard shortcuts",
  "status.versionOnly": "{app} {version}",
  "status.versionCommit": "{app} {version}, commit {commit}",
  "status.versionBuilt": "{app} {version} — built from {branch} at commit {commit}",
  "status.memoryAndUndoHistory": "Memory and undo history",
  "status.memoryTitle": "Undo-history memory (estimated): {used} of {budget} — click to manage",

  // Bottom tray.
  "status.collapseTray": "Collapse tray",
  "status.collapse": "Collapse",
  "status.trayTooShort": "Not enough height for the panel — make the window taller",
  "status.documentLinks": "Document Links",
  "status.consoleTab": "Console",

  // Document links (BacklinksPanel).
  "status.noLinksYet": "No links in this document yet.",
  "status.backlinksTab": { other: "Backlinks ({count})" },
  "status.outgoingTab": { other: "Outgoing ({count})" },
  "status.brokenTab": { other: "Broken ({count})" },
  "status.noBacklinks": "No documents link to this one.",
  "status.noOutgoingLinks": "This document has no outgoing links.",
  /** The linking passage, quoted. */
  "status.backlinkContext": "\"{context}\"",

  // What didn't come through on import (ResidualsDialog).
  "status.residualsDialogTitle": "What didn’t come through",
  "status.residualsIntro": {
    one: "When this document was imported, {count} thing in the source had no representation in the editor’s document model, so it is not part of the document. Nothing was changed in your original file.",
    other: "When this document was imported, {count} things in the source had no representation in the editor’s document model, so they are not part of the document. Nothing was changed in your original file.",
  },
  "status.residualsIntroDoc": {
    one: "When <b>{title}</b> was imported, {count} thing in the source had no representation in the editor’s document model, so it is not part of the document. Nothing was changed in your original file.",
    other: "When <b>{title}</b> was imported, {count} things in the source had no representation in the editor’s document model, so they are not part of the document. Nothing was changed in your original file.",
  },
  "status.residualsMore": { other: "…and {count} more of the same kind." },
  "status.residualsBlindSpot": "This covers what the importer could still see. Scripts, iframes and form controls are stripped for safety before the check runs on an HTML or pasted source, so they are removed without appearing here.",
  /** Shown in code type: an attribute name on an HTML tag name. */
  "status.residualAttributeOn": "{attribute} on <{element}>",
  "status.residualBlockedElementTitle": "Removed for safety",
  "status.residualBlockedElementBlurb": "Scripts and other active content are never imported, whatever the source says.",
  "status.residualUnknownElementTitle": "No place in the document model",
  "status.residualUnknownElementBlurb": "The editor has no node for these tags, so their markup was not kept.",
  "status.residualUnknownStyleTitle": "Inline style not carried over",
  "status.residualUnknownStyleBlurb": "The editor stores formatting as marks, not as arbitrary CSS.",
  "status.residualDroppedAttributeTitle": "Attribute not kept",
  "status.residualDroppedAttributeBlurb": "The element was imported; this attribute on it was not.",
  "status.residualNotedAttributeTitle": "May not survive a round-trip",
  "status.residualNotedAttributeBlurb": "Kept for now, but not guaranteed through every export format.",
  "status.residualHtmlCommentTitle": "Comments not kept",
  "status.residualHtmlCommentBlurb": "HTML comments (<!-- … -->) have no place in the document, so they were left out.",

  // Diagnostics console (ConsolePanel). `{command}` is the literal `help` command.
  "status.consoleTitle": "Diagnostics console",
  "status.consoleEmptyHint": "Read-only. Type {command} and press Enter.",
  "status.consoleCommandInput": "Console command input",
  "status.runCommand": "Run command",
  "status.fidelityColors": { one: "{count} color", other: "{count} colors" },
  "status.fidelityFonts": { one: "{count} font", other: "{count} fonts" },
  "status.fidelityHighlights": { one: "{count} highlight", other: "{count} highlights" },
  "status.fidelityAlignments": { one: "{count} alignment", other: "{count} alignments" },
  "status.fidelityOther": { other: "{count} other" },
  "status.fidelitySummary": "{list} not in MD",
  "status.listSeparator": ", ",
} satisfies Record<`status.${string}`, Message>;
