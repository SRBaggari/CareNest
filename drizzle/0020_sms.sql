CREATE TABLE "sms_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"to" text NOT NULL,
	"body" text,
	"kind" text NOT NULL,
	"notification_id" uuid,
	"urgent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "sms_phones" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"verified_at" timestamp with time zone,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"code_sent_at" timestamp with time zone,
	"codes_sent_today" integer DEFAULT 0 NOT NULL,
	"urgent_only" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_outbox" ADD CONSTRAINT "sms_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_outbox" ADD CONSTRAINT "sms_outbox_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_phones" ADD CONSTRAINT "sms_phones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_outbox_due_idx" ON "sms_outbox" USING btree ("status","next_attempt_at");