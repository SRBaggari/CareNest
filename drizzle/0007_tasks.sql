CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"category" text DEFAULT 'other' NOT NULL,
	"assignee_member_id" uuid,
	"due_at" timestamp with time zone,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"next_task_id" uuid,
	"appointment_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"completion_note" text,
	"cancelled_at" timestamp with time zone,
	"due_reminder_sent_at" timestamp with time zone,
	"overdue_alerted_at" timestamp with time zone,
	"unassigned_alerted_at" timestamp with time zone,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_circle_id_care_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."care_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_member_id_memberships_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_circle_status_due_idx" ON "tasks" USING btree ("circle_id","status","due_at");