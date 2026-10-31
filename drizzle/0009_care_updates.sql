CREATE TABLE "care_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"important" boolean DEFAULT false NOT NULL,
	"corrects_update_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "care_updates" ADD CONSTRAINT "care_updates_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_updates" ADD CONSTRAINT "care_updates_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_updates" ADD CONSTRAINT "care_updates_corrects_update_id_care_updates_id_fk" FOREIGN KEY ("corrects_update_id") REFERENCES "public"."care_updates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_updates_circle_created_idx" ON "care_updates" USING btree ("circle_id","created_at");