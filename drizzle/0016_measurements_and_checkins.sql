CREATE TABLE "measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" double precision NOT NULL,
	"value2" double precision,
	"unit" text NOT NULL,
	"context" text,
	"measured_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"source" text NOT NULL,
	"note" text,
	"removed_at" timestamp with time zone,
	"removed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "care_updates" ADD COLUMN "checkin" text;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measurements_circle_kind_measured_idx" ON "measurements" USING btree ("circle_id","kind","measured_at");