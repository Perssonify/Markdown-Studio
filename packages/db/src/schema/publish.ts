// Live shares: a document its owner publishes read-only, which people who open
// the link follow — their copy updates when the owner edits. The CONTENT is in
// S3 (users/<userId>/published/<docId>.json.gz); this is the index the public
// link is looked up in (apps/api/src/modules/sync/routes/index.ts).
import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * One row per published document. `id` is the public, unguessable id in the
 * link (the only way to read it — no listing exists); `revision` is the
 * document revision (`updated`) the stored copy was made from, which followers
 * compare against theirs. Unpublishing deletes the row and the copy.
 */
export const publishedDocument = pgTable(
  "published_document",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    docId: text("doc_id").notNull(),
    title: text("title").notNull().default(""),
    revision: text("revision").notNull(),
    /** Bytes stored in S3 (gzip). */
    size: integer("size").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("published_document_user_doc").on(t.userId, t.docId)],
);
