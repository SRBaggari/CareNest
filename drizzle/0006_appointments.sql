CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'in_person' NOT NULL,
	"clinician" text,
	"location" text,
	"virtual_url" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"reason" text,
	"questions" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"transport_needed" boolean DEFAULT true NOT NULL,
	"transport_member_id" uuid,
	"transport_note" text,
	"companion_member_id" uuid,
	"outcome_note" text,
	"follow_up" text,
	"outcome_by" uuid,
	"outcome_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"reminder_sent_at" timestamp with time zone,
	"transport_alerted_at" timestamp with time zone,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_transport_member_id_memberships_id_fk" FOREIGN KEY ("transport_member_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_companion_member_id_memberships_id_fk" FOREIGN KEY ("companion_member_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_outcome_by_users_id_fk" FOREIGN KEY ("outcome_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_circle_starts_idx" ON "appointments" USING btree ("circle_id","starts_at");