CREATE TABLE "sync_asset" (
	"user_id" text NOT NULL,
	"hash" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_asset_user_id_hash_pk" PRIMARY KEY("user_id","hash")
);
--> statement-breakpoint
CREATE TABLE "sync_document" (
	"user_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"updated" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_document_user_id_doc_id_pk" PRIMARY KEY("user_id","doc_id")
);
--> statement-breakpoint
CREATE TABLE "sync_library" (
	"user_id" text PRIMARY KEY NOT NULL,
	"folder_tree" jsonb NOT NULL,
	"updated" text NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_asset" ADD CONSTRAINT "sync_asset_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_document" ADD CONSTRAINT "sync_document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_library" ADD CONSTRAINT "sync_library_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;