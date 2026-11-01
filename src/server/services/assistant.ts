// "Ask CareNest": answers a family member's question from the circle's records, with links to the
// records it used. Off unless the server has an AI key AND the person who manages the circle's
// sharing choices (the parent, if they manage their own care) has turned it on. The model only ever
// sees records the asker could already open, gathered through the same permission-checked services
// as the pages. Never medical advice; never stored: only that a question was asked is logged.

import { z } from "zod";
import { AssistantUnavailableError, getAssistantModel, type AssistantRecord, type AssistantReply } from "@/server/assistant/model";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { formatReading, type MeasurementKind } from "@/server/domain/measurements";
import { addDays, localDateIn, localDayBounds } from "@/server/domain/schedule";
import { AppError } from "@/server/http";
import { loadCircleAccess, type CircleAccess, type ServiceContext } from "./access";
import { listAppointments } from "./appointments";
import { recordAudit } from "./audit";
import { listMeasurements } from "./measurements";
import { medicinesIn } from "./reports";
import { listTasks } from "./tasks";
import { listUpdates } from "./updates";
import { listVisits } from "./visits";

export const askSchema = z.object({ question: z.string().trim().min(3, "Type a question.").max(500, "Keep the question under 500 characters.") });

/** Questions cost money and send records out: a few dozen an hour is plenty for a family. */
const QUESTIONS_PER_HOUR = 20;
const RECENT_DAYS = 30;
/** The language to answer in, named in English for the model. */
const ANSWER_LANGUAGE: Record<string, string> = { en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil" };
const DOSE_DAYS = 14;

export type AssistantStatus = { configured: boolean; allowed: boolean };

/** Whether the assistant can be used in this circle (for the page and the menu). */
export async function assistantStatus(ctx: ServiceContext, circleId: string): Promise<AssistantStatus> {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  return { configured: getAssistantModel() !== null, allowed: allowedIn(access) };
}

const allowedIn = (access: CircleAccess) => access.profile.consent.allowAssistant === true && access.can("update.view");

type Source = { label: string; path: string };

/** Everything the asker may see that's useful for questions, as short text records with where to find each. */
async function gatherRecords(ctx: ServiceContext, access: CircleAccess) {
  const circleId = access.circle.id;
  const tz = access.profile.timeZone;
  const base = `/app/circles/${circleId}`;
  const today = localDateIn(tz, ctx.now);
  const local = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const records: AssistantRecord[] = [];
  const sources = new Map<string, Source>();
  const add = (record: AssistantRecord, source: Source) => {
    records.push(record);
    sources.set(record.id, source);
  };

  if (access.can("medication.view")) {
    const from = addDays(today, -(DOSE_DAYS - 1));
    const meds = await medicinesIn(ctx, circleId, { from, to: today }, localDayBounds(from, tz).start, localDayBounds(today, tz).end);
    for (const m of meds) {
      const d = m.doses;
      const schedule = m.asNeeded ? "taken only when needed" : `times ${m.scheduleTimes.join(", ")}`;
      const doses = m.asNeeded
        ? `taken when needed ${d.asNeeded} times in the last ${DOSE_DAYS} days`
        : `last ${DOSE_DAYS} days: ${d.scheduled} scheduled doses, ${d.taken + d.administered} taken or given, ${d.skipped} skipped, ${d.refused} refused, ${d.unconfirmed} unconfirmed`;
      add(
        {
          id: `medicine:${m.id}`,
          kind: "medicine",
          when: m.startDate,
          text: [`${m.name} ${m.dosage}`, schedule, m.instructions, m.prescriber && `prescribed by ${m.prescriber}`, m.status === "stopped" && m.stoppedAt ? `stopped ${local(m.stoppedAt)}` : "current", doses].filter(Boolean).join("; "),
        },
        { label: m.name, path: `${base}/medicines` },
      );
    }
  }

  if (access.can("appointment.view")) {
    const [upcoming, past] = await Promise.all([listAppointments(ctx, circleId, { range: "upcoming", limit: 10 }), listAppointments(ctx, circleId, { range: "past", limit: 10 })]);
    for (const a of [...upcoming, ...past]) {
      const transport = a.transportNeeded ? (a.transport ? `driver: ${a.transport.name ?? "someone"}` : "needs a driver, nobody yet") : null;
      add(
        { id: `appointment:${a.id}`, kind: "appointment", when: local(a.startsAt), text: [a.title, a.status, a.clinician && `with ${a.clinician}`, a.location && `at ${a.location}`, transport].filter(Boolean).join("; ") },
        { label: a.title, path: `${base}/appointments` },
      );
    }
  }

  if (access.can("task.view")) {
    for (const task of (await listTasks(ctx, circleId, { status: "all", assignee: "any" })).slice(0, 40)) {
      add(
        {
          id: `task:${task.id}`,
          kind: "task",
          when: task.dueAt ? local(task.dueAt) : null,
          text: [task.title, task.status, task.assignee ? `assigned to ${task.assignee.name}` : "nobody has taken it", task.completionNote && `note: ${task.completionNote}`].filter(Boolean).join("; "),
        },
        { label: task.title, path: `${base}/tasks` },
      );
    }
  }

  // Visit notes are health details: only for people the parent shares health details with.
  const health = access.can("health.view");
  const [recentVisits, upcomingVisits] = await Promise.all([listVisits(ctx, circleId, "recent"), listVisits(ctx, circleId, "upcoming")]);
  for (const v of [...recentVisits, ...upcomingVisits].slice(0, 30)) {
    const notes = health ? [v.observations && `observations: ${v.observations}`, v.handoverNote && `handover: ${v.handoverNote}`] : [];
    add(
      {
        id: `visit:${v.id}`,
        kind: "visit",
        when: local(v.plannedStart),
        text: [`visit by ${v.visitor?.name ?? "someone"}`, v.status, v.checkedInAt && `checked in ${local(v.checkedInAt)}`, v.checkedOutAt && `checked out ${local(v.checkedOutAt)}`, ...notes].filter(Boolean).join("; "),
      },
      { label: `Visit, ${local(v.plannedStart).slice(0, 10)}`, path: `${base}/visits` },
    );
  }

  const since = new Date(ctx.now.getTime() - RECENT_DAYS * 24 * 3_600_000);
  for (const u of (await listUpdates(ctx, circleId, { limit: 50 })).filter((u) => u.createdAt >= since && !u.correctedBy)) {
    add(
      { id: `update:${u.id}`, kind: "update", when: local(u.createdAt), text: `${u.author?.name ?? "someone"} wrote (${u.category}${u.important ? ", important" : ""}): ${u.body}` },
      { label: `Update by ${u.author?.name ?? "someone"}, ${local(u.createdAt).slice(0, 10)}`, path: `${base}/updates` },
    );
  }

  if (health) {
    for (const r of await listMeasurements(ctx, circleId, { days: RECENT_DAYS })) {
      add(
        {
          id: `reading:${r.id}`,
          kind: "reading",
          when: local(r.measuredAt),
          text: [`${r.kind.replace("_", " ")}: ${formatReading(r.kind as MeasurementKind, r.unit, r.value, r.value2, "en")}`, r.context, r.recordedBy && `recorded by ${r.recordedBy.name}`, r.note && `note: ${r.note}`].filter(Boolean).join("; "),
        },
        { label: `${r.kind.replace("_", " ")}, ${local(r.measuredAt).slice(0, 10)}`, path: `${base}/health` },
      );
    }
  }
  return { records, sources, today };
}

export type AssistantAnswer = {
  kind: "answer" | "not_in_records" | "medical_advice" | "declined";
  answer: string | null;
  citations: { id: string; label: string; path: string }[];
};

export async function askAssistant(ctx: ServiceContext, circleId: string, raw: z.input<typeof askSchema>, locale: string): Promise<AssistantAnswer> {
  const input = askSchema.parse(raw);
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  const model = getAssistantModel();
  if (!model) throw new AppError("conflict", "The assistant isn't set up on this server.");
  if (!allowedIn(access)) throw new AppError("forbidden", "The assistant isn't turned on for this circle.");
  const limit = await consumeRateLimit(ctx.db, { key: `assistant:${ctx.userId}`, limit: QUESTIONS_PER_HOUR, windowMs: 3_600_000, now: ctx.now });
  if (!limit.allowed) throw new AppError("rate_limited", "That's a lot of questions. Please try again later.", { retryAfterSeconds: limit.retryAfterSeconds });

  const { records, sources, today } = await gatherRecords(ctx, access);
  let reply: AssistantReply;
  try {
    reply = await model.ask({ language: ANSWER_LANGUAGE[locale] ?? "English", recipientName: access.profile.preferredName ?? access.profile.displayName, today, records, question: input.question });
  } catch (err) {
    if (err instanceof AssistantUnavailableError) throw new AppError("conflict", err.message);
    throw err;
  }

  // Only records that were actually given to the model can be cited; anything else is dropped.
  const citations = reply.kind === "declined" ? [] : [...new Set(reply.citations)].flatMap((id) => (sources.has(id) ? [{ id, ...sources.get(id)! }] : []));
  await recordAudit(ctx.db, {
    circleId,
    actorUserId: ctx.userId,
    action: "assistant.asked",
    entityType: "circle",
    entityId: circleId,
    // The question and answer are not kept: only that one was asked, and how it was answered.
    metadata: { kind: reply.kind, records: records.length, cited: citations.length, model: model.name },
    now: ctx.now,
  });
  return { kind: reply.kind, answer: reply.kind === "answer" || reply.kind === "not_in_records" ? reply.answer : null, citations };
}
