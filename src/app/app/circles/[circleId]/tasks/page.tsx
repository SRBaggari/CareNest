import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { Alert } from "@/components/ui/alert";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { TASK_CATEGORIES } from "@/server/db/schema";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { listMembers } from "@/server/services/members";
import { listTasks } from "@/server/services/tasks";
import { CompleteTaskForm, TaskForm } from "./task-forms";

export const metadata: Metadata = { title: "Tasks" };

const VIEWS = ["open", "mine", "unassigned", "done"] as const;

export default async function TasksPage({ params, searchParams }: PageProps<"/app/circles/[circleId]/tasks">) {
  const { circleId } = await params;
  const viewParam = (await searchParams).view;
  const view = (VIEWS as readonly string[]).includes(String(viewParam)) ? (viewParam as (typeof VIEWS)[number]) : "open";
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/tasks`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;
  const zone = circle.profile.timeZone;

  const list = await orForbidden(
    listTasks(ctx, circleId, {
      status: view === "done" ? "done" : "open",
      assignee: view === "mine" ? "me" : view === "unassigned" ? "unassigned" : "any",
    }),
  );
  if (!list) return <Alert>{t("common.notAllowed")}</Alert>;

  const caps = new Set(circle.myCapabilities);
  const active = circle.status === "active";
  const canManage = caps.has("task.manage") && active;
  const canDo = caps.has("task.complete") && active;
  const me = circle.myMembership;
  const members = caps.has("members.view") ? await listMembers(ctx, circleId) : [];
  const assignable = members
    .filter((m) => ["admin", "family", "caregiver", "care_recipient"].includes(m.role))
    .map((m) => ({ value: m.id, label: m.name }));
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const base = `/api/v1/circles/${circleId}/tasks`;
  const fmt = (d: Date) => formatDateTime(d, locale, session.user.timeZone);

  const formLabels = {
    ...messages,
    ...Object.fromEntries(["title", "titleHint", "notes", "category", "assignee", "nobody", "priority", "recurrence", "save"].map((k) => [k, t(`tasks.${k}`)])),
    dueAt: t("tasks.dueAt", { name, zone }),
    cancel: t("common.cancel"),
  };
  const options = {
    categories: TASK_CATEGORIES.map((c) => ({ value: c, label: t(`tasks.category_${c}`) })),
    priorities: ["low", "normal", "high"].map((p) => ({ value: p, label: t(`tasks.priority_${p}`) })),
    recurrences: ["none", "daily", "weekly", "monthly"].map((r) => ({ value: r, label: t(`tasks.recurrence_${r}`) })),
    assignees: [{ value: "", label: t("tasks.nobody") }, ...assignable],
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("circle.tasks")}>
        <ul className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <li key={v}>
              <Link
                href={`?view=${v}`}
                aria-current={v === view ? "page" : undefined}
                className={`inline-flex min-h-12 items-center rounded-full border-2 px-4 font-semibold ${v === view ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {t(`tasks.view_${v}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {canManage && view !== "done" && <TaskForm method="POST" url={base} timeZone={zone} openLabel={t("tasks.add")} labels={formLabels} options={options} />}

      {list.length === 0 && <p className="text-muted">{t("tasks.none")}</p>}
      <ol className="flex flex-col gap-3">
        {list.map((task) => {
          const overdue = task.status === "open" && task.dueAt && task.dueAt.getTime() < ctx.now.getTime();
          const mine = task.assignee?.memberId === me.id;
          const canComplete = canDo && task.status === "open" && (me.role !== "caregiver" || mine);
          return (
            <li key={task.id} className={`flex flex-col gap-2 rounded-xl bg-surface p-5 ${overdue ? "border-2 border-danger" : "border border-border"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-semibold">
                  {task.priority === "high" && <span className="mr-2 text-danger">{t("tasks.priority_high")}:</span>}
                  {task.title}
                </h2>
                <span className="text-muted">
                  {t(`tasks.category_${task.category}`)}
                  {task.recurrence !== "none" && ` · ${t(`tasks.recurrence_${task.recurrence}`)}`}
                </span>
              </div>
              {task.notes && <p className="whitespace-pre-line">{task.notes}</p>}
              {task.appointmentId && <p className="text-muted">{t("tasks.fromAppointment")}</p>}
              {task.dueAt && (
                <p className={overdue ? "font-semibold text-danger" : ""}>
                  {overdue ? t("tasks.overdue", { when: fmt(task.dueAt) }) : t("tasks.due", { when: fmt(task.dueAt) })}
                </p>
              )}
              {task.status === "open" &&
                (task.assignee ? (
                  <p className="font-medium">{t("tasks.with", { name: task.assignee.name ?? "" })}</p>
                ) : (
                  <p className="font-semibold text-warning">! {t("tasks.unassigned")}</p>
                ))}
              {task.status === "done" && task.completedAt && (
                <p className="text-success">
                  ✓ {t("tasks.doneBy", { name: task.completedBy ?? t("audit.someone"), when: fmt(task.completedAt) })}
                  {task.completionNote && ` — ${task.completionNote}`}
                </p>
              )}
              <div className="flex flex-wrap items-start gap-3">
                {canDo && task.status === "open" && !task.assignee && (
                  <ActionButton method="POST" url={`${base}/${task.id}/claim`} body={{ action: "claim" }} variant="primary" messages={messages}>
                    {t("tasks.illDoIt")}
                  </ActionButton>
                )}
                {canComplete && (
                  <CompleteTaskForm url={`${base}/${task.id}/complete`} labels={{ ...messages, open: `✓ ${t("tasks.markDone")}`, note: t("tasks.doneNote"), save: t("tasks.markDone"), cancel: t("common.cancel") }} />
                )}
                {mine && task.status === "open" && (
                  <ActionButton method="POST" url={`${base}/${task.id}/claim`} body={{ action: "release" }} messages={messages}>
                    {t("tasks.handBack")}
                  </ActionButton>
                )}
                {canManage && task.status === "open" && (
                  <>
                    <TaskForm method="PATCH" url={`${base}/${task.id}`} timeZone={zone} initial={task} openLabel={t("tasks.edit")} labels={formLabels} options={options} />
                    <ActionButton method="POST" url={`${base}/${task.id}/status`} body={{ action: "cancel" }} confirm={t("tasks.cancelConfirm")} variant="danger" messages={messages}>
                      {t("tasks.cancelTask")}
                    </ActionButton>
                  </>
                )}
                {canManage && task.status === "done" && (
                  <ActionButton method="POST" url={`${base}/${task.id}/status`} body={{ action: "reopen" }} messages={messages}>
                    {t("tasks.reopen")}
                  </ActionButton>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
