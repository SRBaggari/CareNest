import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { getRequestTranslator } from "@/i18n/server";
import { orNotFound, pageContext } from "@/server/page";
import { assistantStatus } from "@/server/services/assistant";
import { getCircle } from "@/server/services/circles";
import { AskForm } from "./ask-form";

export const metadata: Metadata = { title: "Ask CareNest" };

export default async function AssistantPage({ params }: PageProps<"/app/circles/[circleId]/assistant">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}/assistant`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { t } = await getRequestTranslator();
  const p = circle.profile;
  const name = p.preferredName ?? p.displayName;
  const status = await assistantStatus(ctx, circleId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("assistant.title")} description={t("assistant.intro", { name })} />
      {!status.configured ? (
        <Alert>{t("assistant.notSetUp")}</Alert>
      ) : !status.allowed ? (
        <Alert>{t("assistant.notOn", { name })}</Alert>
      ) : (
        <>
          <AskForm
            url={`/api/v1/circles/${circleId}/assistant`}
            labels={{
              network: t("common.errorNetwork"),
              generic: t("common.errorGeneric"),
              fixErrors: t("common.fixErrors"),
              question: t("assistant.question"),
              questionHint: t("assistant.questionHint"),
              ask: t("assistant.ask"),
              from: t("assistant.from"),
              medical: t("assistant.medical", { number: p.emergencyNumber }),
              declined: t("assistant.declined"),
              disclaimer: t("assistant.disclaimer"),
            }}
          />
          <p className="max-w-3xl text-base text-muted">{t("assistant.privacyNote")}</p>
        </>
      )}
    </div>
  );
}
