CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"kind" text NOT NULL,
	"notification_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_outbox_notification_idx" ON "email_outbox" USING btree ("notification_id");