import { Download, ExternalLink, FileImage, FileText, FolderOpen, Upload } from "lucide-react";
import type { Metadata } from "next";
import { ActionButton } from "@/components/action-button";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Badge, IconTile, SectionCard } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { DOCUMENT_CATEGORIES, getDocument, listDocuments } from "@/server/services/documents";
import { NewVersionForm, UploadDocumentForm } from "./document-forms";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ params }: PageProps<"/app/circles/[circleId]/documents">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/documents`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const p = circle.profile;
  const name = p.preferredName ?? p.displayName;
  const docs = await orForbidden(listDocuments(ctx, circleId));
  if (!docs) return <Alert>{t("health.notShared", { name })}</Alert>;
  const details = await Promise.all(docs.map((d) => getDocument(ctx, circleId, d.id)));
  const canUpload = circle.myCapabilities.includes("document.upload") && circle.status === "active";
  const isAdmin = circle.myMembership.role === "admin";
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const when = (d: Date) => formatDateTime(d, locale, p.timeZone);
  const size = (bytes: number) => new Intl.NumberFormat(locale, { style: "unit", unit: bytes > 1_000_000 ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(bytes > 1_000_000 ? bytes / 1_000_000 : bytes / 1000);
  const base = `/api/v1/circles/${circleId}/documents`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold">{t("documents.title")}</h2>
        <p className="text-muted">{t("documents.intro", { name })}</p>
        <p className="text-muted">{t("documents.privacyNote", { name })}</p>
      </div>

      {canUpload && (
        <SectionCard id="upload-heading" icon={Upload} title={t("documents.upload")}>
          <UploadDocumentForm
            url={base}
            categories={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: t(`documents.cat_${c}`) }))}
            labels={{
              ...messages,
              ...(Object.fromEntries((["file", "name", "nameHint", "category", "note", "save", "uploaded"] as const).map((k) => [k, t(`documents.${k}`)])) as Record<string, string>),
            } as Parameters<typeof UploadDocumentForm>[0]["labels"]}
          />
        </SectionCard>
      )}

      {docs.length === 0 ? (
        <EmptyState icon={FolderOpen}>{t("documents.none")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {docs.map((d, i) => {
            const info = details[i];
            const image = d.current?.contentType.startsWith("image/");
            const fileUrl = `${base}/${d.id}/file`;
            return (
              <li key={d.id} className="card flex min-w-0 flex-col gap-3">
                <div className="flex items-start gap-3">
                  <IconTile icon={image ? FileImage : FileText} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xl font-bold">{d.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone="primary">{t(`documents.cat_${d.category}`)}</Badge>
                      {d.current && (
                        <span className="text-base text-muted">
                          {t("documents.addedBy", { name: d.current.uploader ?? t("audit.someone"), date: when(d.current.uploadedAt) })} · {size(d.current.sizeBytes)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={fileUrl} target="_blank" rel="noopener" className={buttonClass("primary")}>
                    <ExternalLink aria-hidden="true" className="size-5" />
                    {t("documents.open")}
                  </a>
                  <a href={`${fileUrl}?download=1`} className={buttonClass("secondary")}>
                    <Download aria-hidden="true" className="size-5" />
                    {t("documents.download")}
                  </a>
                </div>
                <details className="rounded-xl bg-sunken px-4 py-2">
                  <summary className="flex min-h-12 cursor-pointer items-center font-semibold">
                    {t("documents.history")} · {t("documents.versions", { count: d.versionCount })}
                  </summary>
                  <div className="flex flex-col gap-4 py-2">
                    <ol className="flex flex-col gap-1">
                      {info.versions.map((v) => (
                        <li key={v.id} className="flex flex-wrap items-baseline gap-x-2">
                          <a href={`${fileUrl}?version=${v.id}`} target="_blank" rel="noopener" className="font-semibold text-primary underline">
                            {v.filename}
                          </a>
                          <span className="text-base text-muted">
                            {t("documents.addedBy", { name: v.uploader ?? t("audit.someone"), date: when(v.uploadedAt) })} · {size(v.sizeBytes)}
                          </span>
                          {v.note && <span className="w-full text-base">{v.note}</span>}
                        </li>
                      ))}
                    </ol>
                    <div>
                      {info.access.length === 0 ? (
                        <p className="text-base text-muted">{t("documents.neverOpened")}</p>
                      ) : (
                        <ul className="flex flex-col gap-0.5 text-base text-muted">
                          {info.access.slice(0, 10).map((a, n) => (
                            <li key={n}>{t("documents.openedBy", { name: a.name ?? t("audit.someone"), date: when(a.at) })}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {canUpload && (
                      <div>
                        <h4 className="mb-2 font-bold">{t("documents.newVersion")}</h4>
                        <NewVersionForm
                          url={`${base}/${d.id}/versions`}
                          labels={{ ...messages, file: t("documents.file"), note: t("documents.note"), save: t("documents.save"), versionSaved: t("documents.versionSaved") }}
                        />
                      </div>
                    )}
                    {canUpload && (info.createdBy === session.user.id || isAdmin) && (
                      <ActionButton method="DELETE" url={`${base}/${d.id}`} confirm={t("documents.removeConfirm", { title: d.title })} variant="quietDanger" className="px-3 text-base" messages={messages}>
                        {t("documents.remove")}
                      </ActionButton>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
