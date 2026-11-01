import { ArrowRight, CircleCheck, Download, HandCoins, ReceiptIndianRupee, Scale, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { ActionButton } from "@/components/action-button";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, SectionCard } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { CURRENCIES, defaultCurrency, EXPENSE_CATEGORIES, minorToDecimal, SPLIT_MODES } from "@/server/domain/expenses";
import { localDateIn } from "@/server/domain/schedule";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { costSharerList, expenseBalances, listExpenses, listSettlements } from "@/server/services/expenses";
import { AddExpenseForm, RecordPaymentForm } from "./expense-forms";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ params }: PageProps<"/app/circles/[circleId]/expenses">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/expenses`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const p = circle.profile;
  const name = p.preferredName ?? p.displayName;
  const list = await orForbidden(listExpenses(ctx, circleId));
  if (!list) return <Alert>{t("expenses.notAllowed", { name })}</Alert>;
  const [standing, payments, sharers] = await Promise.all([expenseBalances(ctx, circleId), listSettlements(ctx, circleId), costSharerList(ctx, circleId)]);

  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const money = (minor: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  const date = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const who = (n: string | null) => n ?? t("expenses.formerMember");
  const today = localDateIn(p.timeZone, ctx.now);
  const canRecord = circle.myCapabilities.includes("expense.record") && circle.status === "active";
  const canManage = circle.myCapabilities.includes("circle.manage");
  const mayRemove = (createdBy: string | null) => canRecord && (createdBy === session.user.id || canManage);
  const currency = defaultCurrency(p.country);
  const formLabels = { ...messages, cancel: t("common.cancel") };
  const url = `/api/v1/circles/${circleId}`;

  // Group the history by month, newest first.
  const months = new Map<string, typeof list>();
  for (const e of list) months.set(e.spentOn.slice(0, 7), [...(months.get(e.spentOn.slice(0, 7)) ?? []), e]);
  const monthName = (ym: string) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-15T12:00:00Z`));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("expenses.title")} description={t("expenses.intro")}>
        {list.length > 0 && (
          <a href={`${url}/expenses/export`} download className={buttonClass("secondary")}>
            <Download aria-hidden="true" className="size-5" />
            {t("expenses.download")}
          </a>
        )}
      </PageHeader>

      <SectionCard id="standing" icon={Scale} title={t("expenses.standing")}>
        {standing.currencies.length === 0 ? (
          <p className="inline-flex items-center gap-2 font-semibold text-success">
            <CircleCheck aria-hidden="true" className="size-5" />
            {t("expenses.settled")}
          </p>
        ) : (
          standing.currencies.map((c) => (
            <div key={c.currency} className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                {c.transfers.map((tr) => {
                  const amount = money(tr.amountMinor, c.currency);
                  const mine = tr.from === standing.myMemberId || tr.to === standing.myMemberId;
                  return (
                    <li key={`${tr.from}-${tr.to}`} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 ${mine ? "bg-warning-soft" : "bg-sunken/70"}`}>
                      <span className="inline-flex flex-wrap items-center gap-2 text-lg font-semibold">
                        {who(tr.fromName)}
                        <ArrowRight aria-hidden="true" className="size-5 text-muted" />
                        {who(tr.toName)}
                        <span className="sr-only">{t("expenses.pays", { from: who(tr.fromName), to: who(tr.toName), amount })}</span>
                        <span aria-hidden="true" className="font-bold">
                          {amount}
                        </span>
                      </span>
                      {canRecord && (
                        <ActionButton
                          method="POST"
                          url={`${url}/settlements`}
                          body={{ fromMember: tr.from, toMember: tr.to, amount: minorToDecimal(tr.amountMinor), currency: c.currency, paidOn: today }}
                          confirm={t("expenses.markPaidConfirm", { from: who(tr.fromName), to: who(tr.toName), amount })}
                          variant="secondary"
                          messages={messages}
                        >
                          <HandCoins aria-hidden="true" className="size-5" />
                          {t("expenses.markPaid")}
                        </ActionButton>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-base text-muted">
                {c.people
                  .map((person) =>
                    person.amountMinor > 0
                      ? t("expenses.isOwed", { name: who(person.name), amount: money(person.amountMinor, c.currency) })
                      : t("expenses.owes", { name: who(person.name), amount: money(-person.amountMinor, c.currency) }),
                  )
                  .join(" · ")}
              </p>
            </div>
          ))
        )}
      </SectionCard>

      {canRecord && sharers.people.length > 0 && (
        <div className="flex flex-col gap-4">
          <AddExpenseForm
            url={`${url}/expenses`}
            people={sharers.people}
            me={sharers.myMemberId}
            today={today}
            currency={currency}
            currencies={[...CURRENCIES]}
            categories={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`expenses.cat_${c}`) }))}
            splitModes={SPLIT_MODES.map((m) => ({ value: m, label: t(`expenses.split_${m}`) }))}
            labels={{
              ...formLabels,
              ...(Object.fromEntries(
                (["add", "description", "descriptionHint", "amount", "currency", "category", "spentOn", "paidBy", "split", "sharedBy", "customHint", "note", "save"] as const).map((k) => [k, t(`expenses.${k}`)]),
              ) as Record<string, string>),
            } as Parameters<typeof AddExpenseForm>[0]["labels"]}
          />
          {sharers.people.length > 1 && (
            <RecordPaymentForm
              url={`${url}/settlements`}
              people={sharers.people}
              me={sharers.myMemberId}
              today={today}
              currency={currency}
              currencies={[...CURRENCIES]}
              labels={{
                ...formLabels,
                ...(Object.fromEntries((["recordPayment", "payFrom", "payTo", "amount", "currency", "spentOn", "note", "savePayment"] as const).map((k) => [k, t(`expenses.${k}`)])) as Record<string, string>),
              } as Parameters<typeof RecordPaymentForm>[0]["labels"]}
            />
          )}
        </div>
      )}

      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <h3 id="history-heading" className="text-xl font-bold">
          {t("expenses.historyTitle")}
        </h3>
        {list.length === 0 ? (
          <EmptyState icon={Wallet}>{t("expenses.none")}</EmptyState>
        ) : (
          [...months].map(([ym, items]) => (
            <div key={ym} className="flex flex-col gap-3">
              <h4 className="text-base font-bold tracking-wide text-muted uppercase">{monthName(ym)}</h4>
              <ul className="flex flex-col gap-3">
                {items.map((e) => (
                  <li key={e.id} className="card flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="inline-flex min-w-0 items-center gap-2 text-lg font-bold">
                        <ReceiptIndianRupee aria-hidden="true" className="size-5 shrink-0 text-primary" />
                        {e.description}
                      </span>
                      <span className="text-xl font-bold">{money(e.amountMinor, e.currency)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-base text-muted">
                      <Badge tone="neutral">{t(`expenses.cat_${e.category}`)}</Badge>
                      {t("expenses.paidByOn", { name: who(e.paidBy.name), date: date(e.spentOn) })}
                    </div>
                    <p className="text-base">
                      {e.splitMode === "payer_only" ? t("expenses.notShared") : e.shares.map((s) => `${who(s.name)} ${money(s.amountMinor, e.currency)}`).join(" · ")}
                    </p>
                    {e.note && <p className="text-base text-muted">{e.note}</p>}
                    {mayRemove(e.createdBy) && (
                      <ActionButton method="DELETE" url={`${url}/expenses/${e.id}`} confirm={t("expenses.removeConfirm")} variant="quietDanger" className="px-3 text-base" messages={messages}>
                        {t("expenses.remove")}
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {payments.length > 0 && (
        <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
          <h3 id="payments-heading" className="text-xl font-bold">
            {t("expenses.paymentsTitle")}
          </h3>
          <ul className="card flex flex-col divide-y divide-border">
            {payments.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span>
                  <span className="block font-semibold">{t("expenses.paymentLine", { from: who(s.from.name), to: who(s.to.name), amount: money(s.amountMinor, s.currency) })}</span>
                  <span className="text-base text-muted">
                    {date(s.paidOn)}
                    {s.note ? ` · ${s.note}` : ""}
                  </span>
                </span>
                {mayRemove(s.createdBy) && (
                  <ActionButton method="DELETE" url={`${url}/settlements/${s.id}`} confirm={t("expenses.removePaymentConfirm")} variant="quietDanger" className="px-3 text-base" messages={messages}>
                    {t("expenses.remove")}
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
