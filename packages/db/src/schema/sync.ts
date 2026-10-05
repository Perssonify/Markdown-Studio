// Cloud copies of each user's library. The CONTENT lives in S3
// (users/<userId>/…); these tables are the index the sync protocol reads and
// the conflict check it takes a row lock on (apps/api/src/routes/sync.ts).
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * One row per document a user has synced. `updated` is the document's OWN
 * revision stamp (the `updated` of the record, written by the device that made
 * the change) — the value every device compares; `modifiedAt` is the server's
 * clock. A deleted document keeps its row as a tombstone (`deleted`), so a
 * device that has not heard about the deletion yet is told rather than
 * re-uploading the note.
 */
export const syncDocument = pgTable(
  "sync_document",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    docId: text("doc_id").notNull(),
    title: text("title").notNull().default(""),
    updated: text("updated").notNull(),
    deleted: boolean("deleted").notNull().default(false),
    /** Bytes stored in S3 (gzip). */
    size: integer("size").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.docId] })],
);

/** Images a user has stored, by SHA-256 of their bytes (content-addressed: immutable). */
export const syncAsset = pgTable(
  "sync_asset",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.hash] })],
);

/** Library-wide state: the folder tree (folders, which folder each note is in, manual order). */
export const syncLibrary = pgTable("sync_library", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  folderTree: jsonb("folder_tree").notNull(),
  updated: text("updated").notNull(),
  modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
});
