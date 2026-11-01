// Health documents: prescriptions, reports, discharge summaries, insurance papers. They are health
// details, so they follow the parent's health-sharing choice for seeing and adding. Every opening is
// recorded and shown on the document.

import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { documentAccess, documents, documentVersions, users } from "@/server/db/schema";
import { getDocumentStore, newStorageKey } from "@/server/documents/store";
import { detectFileType, safeFilename } from "@/server/domain/files";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { authorize, type ServiceContext } from "./access";
import { recordAudit } from "./audit";

/** Big enough for a phone photo or a multi-page scan; anything larger is usually a mistake. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_CATEGORIES = ["prescription", "report", "discharge", "insurance", "other"] as const;

const note = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .transform((v) => v || null);
export const documentDetailsSchema = z.object({
  title: z.string().trim().min(1, "Give the document a name, such as “Blood test, March”.").max(120),
  category: z.enum(DOCUMENT_CATEGORIES),
  note,
});
export const versionDetailsSchema = z.object({ note });

export type UploadedFile = { name: string; bytes: Uint8Array };

const uploader = alias(users, "uploader");
const notFound = () => new AppError("not_found", "That document wasn't found.");

/** Checks the file and stores it; returns what to save in the versions table. */
async function storeFile(circleId: string, file: UploadedFile) {
  if (file.bytes.length === 0) throw new AppError("validation_failed", "Some fields are invalid.", { file: ["Choose a file to upload."] });
  if (file.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new AppError("validation_failed", "Some fields are invalid.", { file: ["That file is larger than 10 MB. Try a smaller photo or scan."] });
  }
  const type = detectFileType(file.bytes);
  if (!type) throw new AppError("validation_failed", "Some fields are invalid.", { file: ["Upload a PDF or a photo (JPEG, PNG or WebP)."] });
  const storageKey = newStorageKey(circleId);
  await getDocumentStore().put(storageKey, file.bytes);
  return {
    storageKey,
    filename: safeFilename(file.name, type),
    contentType: type.contentType,
    sizeBytes: file.bytes.length,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
  };
}

/** If the database write fails after the file was stored, don't leave the file behind. */
async function withStoredFile<T>(stored: { storageKey: string }, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    await getDocumentStore().delete(stored.storageKey);
    throw err;
  }
}

export async function uploadDocument(ctx: ServiceContext, circleId: string, raw: z.input<typeof documentDetailsSchema>, file: UploadedFile) {
  const input = documentDetailsSchema.parse(raw);
  await authorize(ctx, circleId, "document.upload", { write: true });
  const stored = await storeFile(circleId, file);
  return withStoredFile(stored, () =>
    ctx.db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ circleId, title: input.title, category: input.category, createdBy: ctx.userId, createdAt: ctx.now })
        .returning({ id: documents.id });
      await tx.insert(documentVersions).values({ documentId: doc.id, ...stored, note: input.note, uploadedBy: ctx.userId, uploadedAt: ctx.now });
      await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "document.uploaded", entityType: "document", entityId: doc.id, metadata: { name: input.title }, now: ctx.now });
      return doc;
    }),
  );
}

async function loadDocument(ctx: ServiceContext, circleId: string, documentId: string) {
  if (!uuidSchema.safeParse(documentId).success) throw notFound();
  const [doc] = await ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.circleId, circleId), isNull(documents.removedAt)));
  if (!doc) throw notFound();
  return doc;
}

export async function addDocumentVersion(ctx: ServiceContext, circleId: string, documentId: string, raw: z.input<typeof versionDetailsSchema>, file: UploadedFile) {
  const input = versionDetailsSchema.parse(raw);
  await authorize(ctx, circleId, "document.upload", { write: true });
  const doc = await loadDocument(ctx, circleId, documentId);
  const stored = await storeFile(circleId, file);
  return withStoredFile(stored, () =>
    ctx.db.transaction(async (tx) => {
      const [version] = await tx
        .insert(documentVersions)
        .values({ documentId: doc.id, ...stored, note: input.note, uploadedBy: ctx.userId, uploadedAt: ctx.now })
        .returning({ id: documentVersions.id });
      await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "document.version_added", entityType: "document", entityId: doc.id, metadata: { name: doc.title }, now: ctx.now });
      return version;
    }),
  );
}

export async function listDocuments(ctx: ServiceContext, circleId: string) {
  await authorize(ctx, circleId, "health.view");
  const docs = await ctx.db
    .select({ id: documents.id, title: documents.title, category: documents.category, createdBy: documents.createdBy, createdAt: documents.createdAt })
    .from(documents)
    .where(and(eq(documents.circleId, circleId), isNull(documents.removedAt)))
    .orderBy(desc(documents.createdAt));
  if (docs.length === 0) return [];
  const ids = docs.map((d) => d.id);
  const [latest, counts] = await Promise.all([
    ctx.db
      .select({
        documentId: documentVersions.documentId,
        id: documentVersions.id,
        filename: documentVersions.filename,
        contentType: documentVersions.contentType,
        sizeBytes: documentVersions.sizeBytes,
        uploadedAt: documentVersions.uploadedAt,
        uploader: uploader.name,
      })
      .from(documentVersions)
      .leftJoin(uploader, eq(uploader.id, documentVersions.uploadedBy))
      .where(inArray(documentVersions.documentId, ids))
      .orderBy(desc(documentVersions.uploadedAt)),
    ctx.db
      .select({ documentId: documentAccess.documentId, opens: count(), lastOpenedAt: max(documentAccess.at) })
      .from(documentAccess)
      .where(inArray(documentAccess.documentId, ids))
      .groupBy(documentAccess.documentId),
  ]);
  const opened = new Map(counts.map((c) => [c.documentId, c]));
  return docs.map((d) => {
    const versions = latest.filter((v) => v.documentId === d.id);
    return { ...d, current: versions[0], versionCount: versions.length, opens: opened.get(d.id)?.opens ?? 0 };
  });
}

/** A document's versions and who has opened it. */
export async function getDocument(ctx: ServiceContext, circleId: string, documentId: string) {
  await authorize(ctx, circleId, "health.view");
  const doc = await loadDocument(ctx, circleId, documentId);
  const opener = alias(users, "opener");
  const [versions, access] = await Promise.all([
    ctx.db
      .select({ id: documentVersions.id, filename: documentVersions.filename, contentType: documentVersions.contentType, sizeBytes: documentVersions.sizeBytes, note: documentVersions.note, uploadedAt: documentVersions.uploadedAt, uploader: uploader.name })
      .from(documentVersions)
      .leftJoin(uploader, eq(uploader.id, documentVersions.uploadedBy))
      .where(eq(documentVersions.documentId, doc.id))
      .orderBy(desc(documentVersions.uploadedAt)),
    ctx.db
      .select({ at: documentAccess.at, name: opener.name, versionId: documentAccess.versionId })
      .from(documentAccess)
      .leftJoin(opener, eq(opener.id, documentAccess.userId))
      .where(eq(documentAccess.documentId, doc.id))
      .orderBy(desc(documentAccess.at))
      .limit(50),
  ]);
  return { id: doc.id, title: doc.title, category: doc.category, createdBy: doc.createdBy, versions, access };
}

/** The file to show, recording that this person opened it. Without a version, the newest. */
export async function openDocumentFile(ctx: ServiceContext, circleId: string, documentId: string, versionId?: string) {
  await authorize(ctx, circleId, "health.view");
  const doc = await loadDocument(ctx, circleId, documentId);
  if (versionId && !uuidSchema.safeParse(versionId).success) throw notFound();
  const [version] = await ctx.db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, doc.id), versionId ? eq(documentVersions.id, versionId) : undefined))
    .orderBy(desc(documentVersions.uploadedAt))
    .limit(1);
  if (!version) throw notFound();
  const bytes = await getDocumentStore().get(version.storageKey);
  if (!bytes) throw new AppError("not_found", "That file is missing from storage. Upload it again.");
  await ctx.db.insert(documentAccess).values({ documentId: doc.id, versionId: version.id, userId: ctx.userId, at: ctx.now });
  return { bytes, contentType: version.contentType, filename: version.filename };
}

/** Deletes every file of a document (by whoever added it, or an admin); the activity log keeps its name. */
export async function removeDocument(ctx: ServiceContext, circleId: string, documentId: string) {
  const access = await authorize(ctx, circleId, "document.upload", { write: true });
  const doc = await loadDocument(ctx, circleId, documentId);
  if (doc.createdBy !== ctx.userId && access.membership.role !== "admin") {
    throw new AppError("forbidden", "Only the person who added a document, or an admin, can remove it.");
  }
  const versions = await ctx.db.select({ storageKey: documentVersions.storageKey }).from(documentVersions).where(eq(documentVersions.documentId, doc.id));
  await ctx.db.transaction(async (tx) => {
    await tx.update(documents).set({ removedAt: ctx.now, removedBy: ctx.userId }).where(eq(documents.id, doc.id));
    await tx.delete(documentVersions).where(eq(documentVersions.documentId, doc.id));
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "document.removed", entityType: "document", entityId: doc.id, metadata: { name: doc.title }, now: ctx.now });
  });
  for (const v of versions) await getDocumentStore().delete(v.storageKey);
}

/** Metadata for the circle export (files themselves stay in CareNest). */
export async function documentIndex(ctx: ServiceContext, circleId: string) {
  return ctx.db
    .select({ title: documents.title, category: documents.category, filename: documentVersions.filename, sizeBytes: documentVersions.sizeBytes, uploadedAt: documentVersions.uploadedAt })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(and(eq(documents.circleId, circleId), isNull(documents.removedAt)))
    .orderBy(asc(documents.createdAt), asc(documentVersions.uploadedAt));
}
