import { getRequestTranslator } from "@/i18n/server";
import { formatDate } from "@/lib/format";
import { orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";

export default async function CircleOverview({ params }: PageProps<"/app/circles/[circleId]">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const p = circle.profile;
  const name = p.preferredName ?? p.displayName;
  const role = circle.myMembership.role;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="emergency-heading" className="rounded-xl border-2 border-danger bg-surface p-6">
        <h2 id="emergency-heading" className="text-xl font-semibold">
          {t("circle.emergencyNumber")}
        </h2>
        <a
          href={`tel:${p.emergencyNumber}`}
          className="mt-3 inline-flex min-h-14 items-center rounded-lg bg-danger px-6 text-xl font-bold text-primary-foreground"
        >
          {t("circle.callEmergency", { number: p.emergencyNumber })}
        </a>
        <p className="mt-3 text-muted">{t("safety.notEmergencyService")}</p>
      </section>

      <section aria-labelledby="about-heading" className="rounded-xl border border-border bg-surface p-6">
        <h2 id="about-heading" className="text-xl font-semibold">
          {t("circle.about", { name })}
        </h2>
        <p className="mt-3 text-lg font-medium">{p.displayName}</p>
        {p.dateOfBirth && (
          <dl className="mt-1 flex gap-2">
            <dt className="text-muted">{t("circle.dateOfBirth")}:</dt>
            <dd>{formatDate(`${p.dateOfBirth}T12:00:00Z`, locale, "UTC")}</dd>
          </dl>
        )}
        <ul className="mt-2 flex flex-col gap-1">
          <li>{p.selfManaging ? t("circle.managesOwnCare") : t("circle.decisionsByFamily")}</li>
          <li>{p.hasOwnAccount ? t("circle.hasAccount") : t("circle.noAccount")}</li>
        </ul>
      </section>

      <section aria-labelledby="role-heading" className="rounded-xl border border-border bg-surface p-6">
        <h2 id="role-heading" className="text-xl font-semibold">
          {t("home.yourRole", { role: t(`roles.${role}`) })}
        </h2>
        <p className="mt-2 text-muted">{t(`roleHints.${role}`)}</p>
      </section>

      <section className="rounded-xl border border-dashed border-border bg-surface p-6">
        <p className="text-muted">{t("circle.comingSoon")}</p>
      </section>
    </div>
  );
}
