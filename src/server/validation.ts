import { IANAZone } from "luxon";
import { z } from "zod";
import { LOCALES } from "@/i18n";

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
