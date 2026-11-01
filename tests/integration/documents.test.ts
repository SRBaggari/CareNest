import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getFile } from "@/app/api/v1/circles/[circleId]/documents/[documentId]/file/route";
import { DELETE as removeRoute, GET as detailsRoute } from "@/app/api/v1/circles/[circleId]/documents/[documentId]/route";
import { POST as versionRoute } from "@/app/api/v1/circles/[circleId]/documents/[documentId]/versions/route";
import { GET as listRoute, POST as uploadRoute } from "@/app/api/v1/circles/[circleId]/documents/route";
import { auditEvents } from "@/server/db/schema";
import { setDocumentStoreForTesting, type DocumentStore } from "@/server/documents/store";
import { listAuditEvents } from "@/server/services/audit";
import { MAX_DOCUMENT_BYTES } from "@/server/services/documents";
import { createTeam } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { apiRequest, BASE_URL, params } from "../helpers/http";
import type { TestUser } from "../helpers/users";

const db = setupTestDb();

class MemoryStore implements DocumentStore {
  files = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    this.files.set(key, bytes);
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}
let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
  setDocumentStoreForTesting(store);
});
afterEach(() => setDocumentStoreForTesting(undefined));

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

function multipart(path: string, user: TestUser | null, fields: Record<string, string>, file?: { name: string; bytes: Uint8Array; type?: string }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", new File([file.bytes as BlobPart], file.name, { type: file.type ?? "application/pdf" }));
  return new Request(`${BASE_URL}${path}`, { method: "POST", headers: { origin: BASE_URL, ...(user ? { cookie: user.cookie } : {}) }, body: form });
}

async function upload(user: TestUser | null, circleId: string, title = "Blood test, March", file = { name: "blood-test.pdf", bytes: PDF }) {
  return uploadRoute(multipart(`/api/v1/circles/${circleId}/documents`, user, { title, category: "report" }, file), params({ circleId }));
}
async function listFor(user: TestUser, circleId: string) {
  return listRoute(apiRequest("GET", `/api/v1/circles/${circleId}/documents`, { cookie: user.cookie }), params({ circleId }));
}
async function open(user: TestUser, circleId: string, documentId: string, query = "") {
  return getFile(apiRequest("GET", `/api/v1/circles/${circleId}/documents/${documentId}/file${query}`, { cookie: user.cookie }), params({ circleId, documentId }));
}

describe("health documents", () => {
  it("uploads a PDF, lists it, and serves it back safely, recording who opened it", async () => {
    const team = await createTeam(db());
    const res = await upload(team.caregiver, team.circle.id, "Blood test, March", { name: "C:\\fakepath\\blood test.pdf", bytes: PDF });
    expect(res.status).toBe(201);
    const { document } = await res.json();

    const { documents } = await (await listFor(team.family, team.circle.id)).json();
    expect(documents).toEqual([
      expect.objectContaining({ title: "Blood test, March", category: "report", versionCount: 1, current: expect.objectContaining({ filename: "blood test.pdf", contentType: "application/pdf", uploader: "Meena" }) }),
    ]);

    const file = await open(team.family, team.circle.id, document.id);
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    expect(file.headers.get("content-disposition")).toMatch(/^inline; filename="blood test.pdf"/);
    expect((await open(team.family, team.circle.id, document.id, "?download=1")).headers.get("content-disposition")).toMatch(/^attachment/);

    const details = await (await detailsRoute(apiRequest("GET", `/api/v1/circles/${team.circle.id}/documents/${document.id}`, { cookie: team.admin.cookie }), params({ circleId: team.circle.id, documentId: document.id }))).json();
    expect(details.document.access.map((a: { name: string }) => a.name)).toEqual(["Ravi", "Ravi"]);
    // Stored under a random key, never the uploaded name.
    expect([...store.files.keys()][0]).toMatch(new RegExp(`^${team.circle.id}/[0-9a-f-]{36}$`));
  });

  it("keeps every version, newest first, and can open an older one", async () => {
    const team = await createTeam(db());
    const { document } = await (await upload(team.caregiver, team.circle.id)).json();
    const v2 = await versionRoute(
      multipart(`/api/v1/circles/${team.circle.id}/documents/${document.id}/versions`, team.admin, { note: "Clearer photo" }, { name: "photo.jpg", bytes: JPEG, type: "image/jpeg" }),
      params({ circleId: team.circle.id, documentId: document.id }),
    );
    expect(v2.status).toBe(201);
    const details = await (await detailsRoute(apiRequest("GET", `/api/v1/circles/${team.circle.id}/documents/${document.id}`, { cookie: team.admin.cookie }), params({ circleId: team.circle.id, documentId: document.id }))).json();
    expect(details.document.versions.map((v: { contentType: string; note: string | null }) => [v.contentType, v.note])).toEqual([
      ["image/jpeg", "Clearer photo"],
      ["application/pdf", null],
    ]);
    expect((await open(team.family, team.circle.id, document.id)).headers.get("content-type")).toBe("image/jpeg");
    const older = details.document.versions[1].id;
    expect((await open(team.family, team.circle.id, document.id, `?version=${older}`)).headers.get("content-type")).toBe("application/pdf");
  });

  it("refuses files that aren't really PDFs or photos, whatever they're called, and oversized ones", async () => {
    const team = await createTeam(db());
    for (const bytes of [new TextEncoder().encode("MZ\u0090\u0000 program"), new TextEncoder().encode("<html><script>alert(1)</script>"), new TextEncoder().encode("<svg onload=alert(1)>")]) {
      const res = await upload(team.caregiver, team.circle.id, "Report", { name: "report.pdf", bytes });
      expect(res.status).toBe(422);
      expect((await res.json()).error.details.file[0]).toMatch(/PDF or a photo/);
    }
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set(PDF);
    expect((await upload(team.caregiver, team.circle.id, "Big", { name: "big.pdf", bytes: big })).status).toBe(422);
    const noTitle = await upload(team.caregiver, team.circle.id, "", { name: "x.pdf", bytes: PDF });
    expect((await noTitle.json()).error.details).toHaveProperty("title");
    const json = await uploadRoute(apiRequest("POST", `/api/v1/circles/${team.circle.id}/documents`, { cookie: team.caregiver.cookie, body: { title: "x" } }), params({ circleId: team.circle.id }));
    expect(json.status).toBe(415);
    expect(store.files.size).toBe(0);
  });

  it("follows the parent's choice not to share health details, for seeing, opening and adding", async () => {
    const team = await createTeam(db());
    const { document } = await (await upload(team.caregiver, team.circle.id)).json();
    await putConsentFor(team.elder, team.circle.id, { shareMedications: true, shareAppointments: true, shareHealth: false });
    expect((await listFor(team.family, team.circle.id)).status).toBe(403);
    expect((await open(team.admin, team.circle.id, document.id)).status).toBe(403);
    expect((await upload(team.family, team.circle.id)).status).toBe(403);
    expect((await open(team.caregiver, team.circle.id, document.id)).status).toBe(200);
    expect((await open(team.neighbour, team.circle.id, document.id)).status).toBe(403);
    // Activity log entries follow the same choice.
    expect((await listAuditEvents(team.as(team.admin, new Date()), team.circle.id)).map((e) => e.action)).not.toContain("document.uploaded");
  });

  it("is 404 for outsiders and 401 signed out, and never mixes up two families' documents", async () => {
    const team = await createTeam(db());
    const other = await createTeam(db());
    const { document } = await (await upload(team.caregiver, team.circle.id)).json();
    await upload(other.caregiver, other.circle.id, "Zebra report");
    expect((await listFor(other.admin, team.circle.id)).status).toBe(404);
    expect((await open(other.admin, team.circle.id, document.id)).status).toBe(404);
    expect((await open(other.admin, other.circle.id, document.id)).status).toBe(404); // right circle, wrong document
    expect((await upload(other.admin, team.circle.id)).status).toBe(404);
    expect((await upload(null, team.circle.id)).status).toBe(401);
    expect(JSON.stringify(await (await listFor(team.admin, team.circle.id)).json())).not.toContain("Zebra");
  });

  it("lets whoever added a document, or an admin, remove it, deleting its files", async () => {
    const team = await createTeam(db());
    const { document } = await (await upload(team.caregiver, team.circle.id)).json();
    const remove = (user: TestUser) =>
      removeRoute(apiRequest("DELETE", `/api/v1/circles/${team.circle.id}/documents/${document.id}`, { cookie: user.cookie }), params({ circleId: team.circle.id, documentId: document.id }));
    expect((await remove(team.family)).status).toBe(403);
    expect((await remove(team.admin)).status).toBe(204);
    expect(store.files.size).toBe(0);
    expect((await (await listFor(team.admin, team.circle.id)).json()).documents).toEqual([]);
    expect((await open(team.admin, team.circle.id, document.id)).status).toBe(404);
    const [removed] = await db().select().from(auditEvents).where(eq(auditEvents.action, "document.removed"));
    expect(removed.metadata).toEqual({ name: "Blood test, March" });
  });
});
