CREATE TABLE "assistance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"raised_by" uuid,
	"message" text,
	"status" text DEFAULT 'open' NOT NULL,
	"is_practice" boolean DEFAULT false NOT NULL,
	"location" jsonb,
	"escalation_step" integer DEFAULT 0 NOT NULL,
	"next_escalation_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"relationship" text,
	"notes" text,
	"tier" integer DEFAULT 1 NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_info_cards" (
	"circle_id" uuid PRIMARY KEY NOT NULL,
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_member_id_memberships_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_info_cards" ADD CONSTRAINT "emergency_info_cards_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_info_cards" ADD CONSTRAINT "emergency_info_cards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistance_requests_circle_idx" ON "assistance_requests" USING btree ("circle_id","created_at");--> statement-breakpoint
CREATE INDEX "emergency_contacts_circle_idx" ON "emergency_contacts" USING btree ("circle_id");