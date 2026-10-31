// Database schema. Tables are added milestone by milestone; each change ships with a
// generated SQL migration in `drizzle/` (npm run db:generate).

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Key/value metadata about the running deployment (schema sanity checks, feature flags). */
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
