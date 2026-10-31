CREATE TYPE "public"."dose_status" AS ENUM('scheduled', 'unconfirmed', 'taken', 'administered', 'skipped', 'refused');--> statement-breakpoint
CREATE TABLE "dose_event_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dose_event_id" uuid NOT NULL,
	"circle_id" uuid NOT NULL,
	"status" "dose_status" NOT NULL,
	"previous_status" "dose_status" NOT NULL,
	"occurred_at" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"source" text NOT NULL,
	"reason" text,
	"note" text,
	"side_effects" text,
	"is_correction" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dose_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone,
	"local_date" date,
	"local_time" text,
	"shifted" boolean DEFAULT false NOT NULL,
	"status" "dose_status" DEFAULT 'scheduled' NOT NULL,
	"occurred_at" timestamp with time zone,
	"recorded_at" timestamp with time zone,
	"recorded_by" uuid,
	"source" text,
	"reason" text,
	"note" text,
	"side_effects" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dose_events_medication_time_unique" UNIQUE("medication_id","scheduled_for")
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dosage" text NOT NULL,
	"instructions" text,
	"prescriber" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"as_needed" boolean DEFAULT false NOT NULL,
	"schedule_times" text[] DEFAULT '{}'::text[] NOT NULL,
	"schedule_days" integer[],
	"units_per_dose" integer DEFAULT 1 NOT NULL,
	"supply_count" integer,
	"refill_threshold" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"stopped_at" timestamp with time zone,
	"stopped_by" uuid,
	"stop_reason" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "care_profiles" ADD COLUMN "dose_grace_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "dose_event_history" ADD CONSTRAINT "dose_event_history_dose_event_id_dose_events_id_fk" FOREIGN KEY ("dose_event_id") REFERENCES "public"."dose_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_event_history" ADD CONSTRAINT "dose_event_history_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_event_history" ADD CONSTRAINT "dose_event_history_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_stopped_by_users_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dose_event_history_dose_idx" ON "dose_event_history" USING btree ("dose_event_id");--> statement-breakpoint
CREATE INDEX "dose_events_circle_time_idx" ON "dose_events" USING btree ("circle_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "medications_circle_idx" ON "medications" USING btree ("circle_id");