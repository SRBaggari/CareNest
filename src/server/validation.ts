import { IANAZone } from "luxon";
import { z } from "zod";
import { LOCALES } from "@/i18n";
import { isValidLocalDate, MAX_LOCAL_DATE, MIN_LOCAL_DATE } from "@/server/domain/schedule";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Enter a valid email address." }));

export const nameSchema = z.string().trim().min(1, "Enter a name.").max(100, "Use at most 100 characters.");

export const timeZoneSchema = z
  .string()
  .refine((tz) => IANAZone.isValidZone(tz), { message: "Choose a valid time zone." });

export const localeSchema = z.enum(LOCALES);

export const uuidSchema = z.uuid();

/** A real calendar date "YYYY-MM-DD" between 1900 and 2200 (rejects "2026-02-30", "9999-12-31"). */
export const localDateSchema = z
  .string()
  .refine(isValidLocalDate, { message: `Enter a real date between ${MIN_LOCAL_DATE} and ${MAX_LOCAL_DATE}.` });
