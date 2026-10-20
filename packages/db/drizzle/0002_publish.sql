CREATE TABLE "published_document" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"revision" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "published_document" ADD CONSTRAINT "published_document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "published_document_user_doc" ON "published_document" USING btree ("user_id","doc_id");