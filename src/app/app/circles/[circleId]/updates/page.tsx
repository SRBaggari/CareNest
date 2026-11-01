import { MessageSquareText } from "lucide-react";
import type { Metadata } from "next";
import { SimpleForm } from "@/components/simple-form";
import { Alert } from "@/components/ui/alert";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { listUpdates } from "@/server/services/updates";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Updates" };

export default async function UpdatesPage({ params }: PageProps<"/app/circles/[circleId]/updates">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/updates`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;
  const updates = await orForbidden(listUpdates(ctx, circleId, { limit: 50 }));
  if (!updates) return <Alert>{t("common.notAllowed")}</Alert>;

  const caps = new Set(circle.myCapabilities);
  const canPost = caps.has("update.post") && circle.status === "active";
  const healthOk = caps.has("health.view");
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const url = `/api/v1/circles/${circleId}/updates`;
  const categories = (healthOk ? ["general", "health", "mood"] : ["general"]).map((c) => ({ value: c, label: t(`updates.category_${c}`) }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("circle.updates")} description={t("updates.intro", { name })} />
      {canPost && (
        <section className="card">
          <SimpleForm
            method="POST"
            url={url}
            messages={messages}
            cancelLabel={t("common.cancel")}
            submitLabel={t("updates.post")}
            fields={[
              { name: "body", type: "textarea", label: t("updates.body"), required: true, maxLength: 4000 },
              ...(healthOk ? [{ name: "category", type: "select" as const, label: t("updates.category"), hint: t("updates.healthNote", { name }), options: categories, defaultValue: "general" }] : []),
              { name: "important", type: "checkbox", label: t("updates.important") },
            ]}
          />
        </section>
      )}

      {updates.length === 0 && <EmptyState icon={MessageSquareText}>{t("updates.none")}</EmptyState>}
      <ol className="flex flex-col gap-3">
        {updates.map((u) => (
          <li key={u.id} className={`flex flex-col gap-2 rounded-xl bg-surface p-5 ${u.important ? "border-l-8 border-warning" : "border border-border"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">
                {u.important && <span className="mr-2 text-warning">{t("updates.importantBadge")}:</span>}
                {u.author?.name ?? t("audit.someone")}
                {u.category !== "general" && <span className="ml-2 font-normal text-muted">· {t(`updates.category_${u.category}`)}</span>}
              </p>
              <time className="text-muted" dateTime={u.createdAt.toISOString()}>
                {formatDateTime(u.createdAt, locale, session.user.timeZone)}
              </time>
            </div>
            {u.correctsUpdateId && <p className="text-muted">{t("updates.isCorrection")}</p>}
            <p className={`whitespace-pre-line ${u.correctedBy ? "text-muted line-through decoration-1" : ""}`}>{u.body}</p>
            {u.correctedBy && <p className="font-medium">{t("updates.corrected")}</p>}
            {canPost && u.author?.id === session.user.id && !u.correctedBy && (
              <SimpleForm
                method="POST"
                url={url}
                messages={messages}
                cancelLabel={t("common.cancel")}
                openLabel={t("updates.correct")}
                submitLabel={t("updates.post")}
                fixed={{ correctsUpdateId: u.id, category: u.category }}
                fields={[{ name: "body", type: "textarea", label: t("updates.correctionOf"), required: true, maxLength: 4000, defaultValue: u.body }]}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
