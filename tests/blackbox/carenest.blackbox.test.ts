// Black-box regression suite. Derived from the requirements in docs/PLAN.md only; it exercises a
// running deployment over HTTP. Run: BLACKBOX_URL=http://localhost:3000 npm run test:blackbox

import { describe, expect, it } from "vitest";
import { Actor, BASE, circleWith, type Json } from "./client";

describe.skipIf(!BASE)("CareNest black-box", () => {
  describe("platform", () => {
    it("health endpoint reports the database", async () => {
      const res = await new Actor().get("/api/health");
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ status: "ok", database: "ok" });
    });

    it("pages send security headers and no framework banner", async () => {
      const res = await new Actor().get("/");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("x-powered-by")).toBeNull();
    });

    it("pages are accessible-by-markup: language, skip link, labelled inputs", async () => {
      const home = await new Actor().get("/");
      expect(home.text).toMatch(/<html[^>]* lang="en"/);
      expect(home.text).toContain('href="#main"');
      const register = await new Actor().get("/register");
      const inputs = [...register.text.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
      expect(inputs.length).toBeGreaterThan(2);
      for (const id of inputs) expect(register.text).toContain(`for="${id}"`);
      expect(register.text).not.toMatch(/<img(?![^>]*\balt=)[^>]*>/);
    });

    it("unknown API routes are a JSON 404", async () => {
      const res = await new Actor().get("/api/v1/does-not-exist");
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe("not_found");
    });

    it("regression F1/F2: far-future and impossible dates are rejected fast, server stays up", async () => {
      const owner = await new Actor().register();
      const circleId = await circleWith(owner);
      for (const name of ["A", "B", "C"]) await owner.post(`/api/v1/circles/${circleId}/medications`, { name, dosage: "1", times: ["08:00"] });
      for (const date of ["9999-12-31", "0001-01-01", "2026-02-30"]) {
        const started = Date.now();
        expect([date, (await owner.get(`/api/v1/circles/${circleId}/doses?date=${date}`)).status]).toEqual([date, 422]);
        expect(Date.now() - started).toBeLessThan(3000);
      }
      expect((await new Actor().get("/api/health")).status).toBe(200);
    });

    it("regression F6: non-JSON bodies are refused with 415", async () => {
      const a = await new Actor().register();
      expect((await a.call("PATCH", "/api/v1/me", "name=x", { "content-type": "text/plain" })).status).toBe(415);
    });

    it("429 responses include Retry-After", async () => {
      const victim = await new Actor().register();
      let last;
      for (let i = 0; i < 6; i++) last = await new Actor().post("/api/v1/auth/login", { email: victim.email, password: "wrong password!!" });
      expect(last!.status).toBe(429);
      expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    });
  });

  describe("authentication", () => {
    it("register → me → logout → me is 401", async () => {
      const a = await new Actor("Asha").register();
      expect((await a.get("/api/v1/me")).json.user.name).toBe("Asha");
      expect((await a.post("/api/v1/auth/logout")).status).toBe(204);
      expect((await a.get("/api/v1/me")).status).toBe(401);
    });

    it("password boundaries: 9 chars rejected, 10 accepted, 129 rejected", async () => {
      const reg = (pw: string) => new Actor().post("/api/v1/auth/register", { email: `bb-${pw.length}-${Math.random()}@example.test`, name: "X", password: pw });
      expect((await reg("a".repeat(4) + "bcdef")).status).toBe(422);
      expect((await reg("abcdefghij")).status).toBe(201);
      expect((await reg("x".repeat(129))).status).toBe(422);
    });

    it("emails are case/whitespace-insensitive and unique", async () => {
      const a = await new Actor().register();
      const dup = await new Actor().post("/api/v1/auth/register", { email: `  ${a.email.toUpperCase()} `, name: "Dup", password: "correct horse battery staple" });
      expect(dup.status).toBe(409);
    });

    it("rejects malformed JSON (400) and wrong types (422)", async () => {
      expect((await new Actor().call("POST", "/api/v1/auth/login", "{oops")).status).toBe(400);
      expect((await new Actor().post("/api/v1/auth/login", { email: 42, password: [] })).status).toBe(422);
    });

    it("mutations without our Origin are refused (CSRF)", async () => {
      const a = await new Actor().register();
      expect((await a.call("PATCH", "/api/v1/me", { name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
      expect((await a.call("PATCH", "/api/v1/me", { name: "x" }, { origin: "" })).status).toBe(403);
    });

    it("signed-out visitors to /app are redirected to login, and ?next can't redirect off-site", async () => {
      const res = await new Actor().get("/app/account");
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login?next=%2Fapp%2Faccount");
      const a = await new Actor().register();
      const login = await a.get("/login?next=https://evil.example");
      expect(login.text).not.toContain("evil.example\"");
    });
  });

  describe("isolation between families (IDOR)", () => {
    it("a stranger gets 404 for another family's circle and every resource id inside it", async () => {
      const owner = await new Actor("Priya").register();
      const circleId = await circleWith(owner);
      const med = (await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: ["08:00"] })).json.medication;
      const task = (await owner.post(`/api/v1/circles/${circleId}/tasks`, { title: "Buy pills" })).json.task;
      const help = (await owner.post(`/api/v1/circles/${circleId}/emergency/requests`, { practice: true })).json.request;

      const stranger = await new Actor("Eve").register();
      const own = await circleWith(stranger);
      for (const path of [
        `/api/v1/circles/${circleId}`,
        `/api/v1/circles/${circleId}/members`,
        `/api/v1/circles/${circleId}/medications`,
        `/api/v1/circles/${circleId}/doses`,
        `/api/v1/circles/${circleId}/timeline`,
        `/api/v1/circles/${circleId}/emergency/info`,
        `/api/v1/circles/${own}/medications/${med.id}`,
        `/api/v1/circles/${own}/tasks/${task.id}`,
        `/api/v1/circles/${own}/emergency/requests/${help.id}`,
      ]) {
        const res = await stranger.get(path);
        expect([path, res.status]).toEqual([path, 404]);
        expect(res.text).not.toContain("Metformin");
      }
      expect((await stranger.post(`/api/v1/circles/${own}/tasks/${task.id}/claim`, { action: "claim" })).status).toBe(404);
    });

    it("with two busy families on one server, no list, summary, export or page shows the other family's data", async () => {
      // The other family: every kind of record, each marked "Zebra" so a leak is easy to spot.
      const zed = await new Actor("Zed").register();
      const zoe = await new Actor("Zoe").register("Asia/Kolkata");
      const zelda = await new Actor("Zelda").register("Asia/Kolkata");
      const theirs = await circleWith(zed, [[zoe, "caregiver"], [zelda, "care_recipient"]]);
      const z = (path: string) => `/api/v1/circles/${theirs}${path}`;
      const soon = new Date(Date.now() + 20 * 60_000);
      const slot = soon.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
      const day = soon.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      expect((await zed.post(z("/medications"), { name: "Zebramycin", dosage: "1 tablet", times: [slot], startDate: day })).status).toBe(201);
      expect((await zed.post(z("/appointments"), { title: "Zebra clinic", startsAt: new Date(Date.now() + 26 * 3_600_000).toISOString() })).status).toBe(201);
      await zed.post(z("/tasks"), { title: "Zebra task", dueAt: new Date(Date.now() + 30 * 3_600_000).toISOString() });
      const doneTask = (await zed.post(z("/tasks"), { title: "Zebra finished task" })).json.task;
      await zed.post(z(`/tasks/${doneTask.id}/complete`), { note: "Zebra done note" });
      await zelda.post(z("/updates"), { body: "Zebra everyday update" });
      await zelda.post(z("/updates"), { body: "Zebra important update", important: true });
      const finished = (await zoe.post(z("/visits"), { plannedStart: soon.toISOString(), purpose: "Zebra visit" })).json.visit;
      await zoe.post(z(`/visits/${finished.id}/check-in`));
      await zoe.post(z(`/visits/${finished.id}/check-out`), { observations: "Zebra observations", handoverNote: "Zebra handover" });
      const live = (await zoe.post(z("/visits"), { plannedStart: soon.toISOString(), purpose: "Zebra live visit" })).json.visit;
      await zoe.post(z(`/visits/${live.id}/check-in`));
      await zed.post(z("/emergency/contacts"), { name: "Zebra Contact", phone: "+91 90000 00099" });
      expect((await zelda.post(z("/emergency/requests"), { message: "Zebra help" })).status).toBe(201);
      await zed.post(z("/invitations"), { email: "zebra@example.test", role: "family" });
      // A real file upload: also proves the server (e.g. the Docker image) can store documents.
      const form = new FormData();
      form.set("title", "Zebra scan");
      form.set("category", "report");
      form.set("file", new File([new TextEncoder().encode("%PDF-1.7 zebra")], "zebra.pdf", { type: "application/pdf" }));
      const uploaded = await fetch(`${BASE}${z("/documents")}`, { method: "POST", headers: { cookie: zoe.cookie, origin: BASE, "x-forwarded-for": zoe.ip }, body: form });
      expect(uploaded.status).toBe(201);
      // Control: the other family does see all of it, so a clean result below means something.
      for (const [path, marker] of [
        ["/visits", "Zebra live visit"],
        ["/visits?range=recent", "Zebra observations"],
        ["/tasks?status=all", "Zebra finished task"],
        ["/updates", "Zebra everyday update"],
        ["/emergency/contacts", "Zebra Contact"],
        ["/emergency/requests", "Zebra help"],
        ["/invitations", "zebra@example.test"],
        ["/timeline", "Zebra"],
        ["/export", "Zebramycin"],
        ["/documents", "Zebra scan"],
      ]) {
        expect([path, (await zed.get(z(path))).text.includes(marker)]).toEqual([path, true]);
      }

      // This family, with its own records so every list has something real in it.
      const priya = await new Actor("Priya").register();
      const meena = await new Actor("Meena").register("Asia/Kolkata");
      const amma = await new Actor("Amma").register("Asia/Kolkata");
      const mine = await circleWith(priya, [[meena, "caregiver"], [amma, "care_recipient"]]);
      const m = (path: string) => `/api/v1/circles/${mine}${path}`;
      await priya.post(m("/medications"), { name: "Metformin", dosage: "500 mg", times: [slot], startDate: day });
      const visit = (await meena.post(m("/visits"), { plannedStart: soon.toISOString(), purpose: "Morning care" })).json.visit;
      await meena.post(m(`/visits/${visit.id}/check-in`));

      const reads: [Actor, string][] = [
        ...[
          "",
          "/members",
          "/invitations",
          "/medications",
          `/doses?date=${day}`,
          "/appointments",
          "/appointments?range=past",
          "/tasks?status=all",
          "/updates",
          "/timeline",
          "/visits",
          "/visits?range=recent",
          "/emergency/info",
          "/emergency/contacts",
          "/emergency/requests",
          "/audit",
          "/today",
          "/export",
          "/documents",
        ].map((p) => [priya, m(p)] as [Actor, string]),
        [priya, "/api/v1/me/today"],
        [priya, "/api/v1/me/export"],
        [priya, "/api/v1/notifications"],
        [priya, "/api/v1/circles"],
        [priya, "/app"],
        [priya, `/app/circles/${mine}`],
        [priya, `/app/circles/${mine}/visits`],
        [priya, `/app/circles/${mine}/timeline`],
        [priya, `/app/circles/${mine}/updates`],
        [priya, `/app/circles/${mine}/emergency`],
        [meena, `/app/circles/${mine}/visits`],
        [amma, `/simple/${mine}`],
      ];
      for (const [actor, path] of reads) {
        const res = await actor.get(path);
        expect([path, res.status < 400]).toEqual([path, true]);
        expect([path, /zebra/i.test(res.text)]).toEqual([path, false]);
      }
    });

    it("a stranger opening another family's circle page sees exactly what a missing circle shows", async () => {
      const owner = await new Actor("Priya").register();
      const circleId = await circleWith(owner);
      const stranger = await new Actor("Eve").register();
      // Pages stream, so the status is 200 (the JSON API above returns a real 404); what matters is
      // that nothing leaks, search engines are told not to index it, and it can't reveal that the
      // circle exists.
      for (const path of ["", "/medicines", "/settings"]) {
        const page = await stranger.get(`/app/circles/${circleId}${path}`);
        expect(page.text).toMatch(/<meta name="robots" content="noindex"/);
        expect(page.text).not.toContain("Lakshmi");
        expect(page.text).not.toContain("Amma's care");
      }
      const missing = await stranger.get("/app/circles/00000000-0000-4000-8000-000000000000");
      const real = await stranger.get(`/app/circles/${circleId}`);
      expect(real.status).toBe(missing.status);
      expect(missing.text).toMatch(/<meta name="robots" content="noindex"/);
    });

    it("a user with two parents sees each circle separately (Scenario F)", async () => {
      const child = await new Actor().register();
      const mum = await circleWith(child);
      const dad = await circleWith(child);
      await child.post(`/api/v1/circles/${mum}/medications`, { name: "MumOnlyMed", dosage: "1", times: ["08:00"] });
      const dadMeds = await child.get(`/api/v1/circles/${dad}/medications`);
      expect(dadMeds.text).not.toContain("MumOnlyMed");
      expect((await child.get("/api/v1/circles")).json.circles).toHaveLength(2);
    });
  });

  describe("roles and privacy", () => {
    it("family loses medicines when the parent stops sharing; caregivers keep them", async () => {
      const owner = await new Actor("Priya").register();
      const elder = await new Actor("Amma").register("Asia/Kolkata");
      const family = await new Actor("Ravi").register();
      const caregiver = await new Actor("Meena").register("Asia/Kolkata");
      const circleId = await circleWith(owner, [[elder, "care_recipient"], [family, "family"], [caregiver, "caregiver"]]);
      await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: ["08:00"] });
      expect((await elder.put(`/api/v1/circles/${circleId}/consent`, { shareMedications: false, shareAppointments: true, shareHealth: true })).status).toBe(200);
      expect((await family.get(`/api/v1/circles/${circleId}/medications`)).status).toBe(403);
      expect((await caregiver.get(`/api/v1/circles/${circleId}/medications`)).status).toBe(200);
      // An admin cannot override the parent's choice.
      expect((await owner.put(`/api/v1/circles/${circleId}/consent`, { shareMedications: true, shareAppointments: true, shareHealth: true })).status).toBe(403);
    });

    it("emergency contacts see the emergency card but not medicines or members", async () => {
      const owner = await new Actor().register();
      const neighbour = await new Actor("Neighbour").register();
      const circleId = await circleWith(owner, [[neighbour, "emergency_contact"]]);
      expect((await neighbour.get(`/api/v1/circles/${circleId}/emergency/info`)).status).toBe(200);
      expect((await neighbour.get(`/api/v1/circles/${circleId}/medications`)).status).toBe(403);
      expect((await neighbour.get(`/api/v1/circles/${circleId}/members`)).status).toBe(403);
    });
  });

  describe("journeys", () => {
    it("Scenario B: today's dose can be confirmed and is attributed to who reported it", async () => {
      const owner = await new Actor("Priya").register();
      const circleId = await circleWith(owner);
      // A dose 30 minutes from now in Amma's zone: inside the early-confirmation window, and after
      // the medicine was added (doses before that are never created).
      const due = new Date(Date.now() + 30 * 60_000);
      const t = due.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
      const today = due.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: [t], startDate: today });
      const doses = (await owner.get(`/api/v1/circles/${circleId}/doses?date=${today}`)).json.doses;
      expect(doses).toHaveLength(1);
      expect(doses[0].status).toBe("scheduled");
      const rec = await owner.post(`/api/v1/circles/${circleId}/doses/${doses[0].id}/record`, { status: "taken" });
      expect(rec.json.dose).toMatchObject({ status: "taken", source: "proxy" });
      expect(JSON.stringify((await owner.get(`/api/v1/circles/${circleId}/doses?date=${today}`)).json)).not.toMatch(/missed/i);
    });

    it("Scenario E: help request alerts the family and never claims emergency services were called", async () => {
      const owner = await new Actor("Priya").register();
      const elder = await new Actor("Amma").register("Asia/Kolkata");
      const family = await new Actor("Ravi").register();
      const circleId = await circleWith(owner, [[elder, "care_recipient"], [family, "family"]]);
      const req = await elder.post(`/api/v1/circles/${circleId}/emergency/requests`, { message: "I fell" });
      expect(req.status).toBe(201);
      const again = await elder.post(`/api/v1/circles/${circleId}/emergency/requests`, { message: "I fell" });
      expect(again.json.request).toMatchObject({ id: req.json.request.id, alreadyOpen: true });
      const alert = (await family.get("/api/v1/notifications")).json.notifications.find((n: Json) => n.kind === "assistance_alert");
      expect(alert.priority).toBe("critical");
      expect(alert.body).toContain("has NOT contacted emergency services");
      const ack = await family.post(`/api/v1/circles/${circleId}/emergency/requests/${req.json.request.id}/acknowledge`);
      expect(ack.json.request).toMatchObject({ status: "acknowledged", acknowledgedBy: "Ravi" });
    });

    it("the parent lands on their Simple view; family stay in the full app; the switch is remembered", async () => {
      const owner = await new Actor("Priya").register();
      const elder = await new Actor("Amma").register("Asia/Kolkata");
      const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
      // Next streams in-page redirects as "NEXT_REDIRECT;<type>;<path>;<status>".
      const redirectIn = (html: string) => html.match(/NEXT_REDIRECT;[a-z]+;(\/[\w\-/]+)/)?.[1];

      expect(redirectIn((await elder.get("/app")).text)).toBe(`/simple/${circleId}`);
      const simple = await elder.get(`/simple/${circleId}`);
      expect(simple.status).toBe(200);
      expect(simple.text).toContain(`tel:112`);
      expect(simple.text).not.toContain("Activity log");

      expect(redirectIn((await owner.get("/app")).text)).toBeUndefined();
      expect(redirectIn((await owner.get(`/simple/${circleId}`)).text)).toBe(`/app/circles/${circleId}`);

      const toFull = await elder.get(`/view?mode=full&next=${encodeURIComponent(`/app/circles/${circleId}`)}`);
      expect(toFull.status).toBe(303);
      elder.cookie = `${elder.cookie}; cn_view=full`;
      expect(redirectIn((await elder.get("/app")).text)).toBeUndefined();
    });

    it("the Today dashboard lists what needs attention and respects the parent's sharing choices", async () => {
      const owner = await new Actor("Priya").register();
      const elder = await new Actor("Amma").register("Asia/Kolkata");
      const family = await new Actor("Ravi").register();
      const circleId = await circleWith(owner, [[elder, "care_recipient"], [family, "family"]]);
      await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: ["08:00"] });
      const startsAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
      expect((await owner.post(`/api/v1/circles/${circleId}/appointments`, { title: "Eye clinic", startsAt, transportNeeded: true })).status).toBe(201);
      expect((await owner.post(`/api/v1/circles/${circleId}/tasks`, { title: "Buy pills" })).status).toBe(201);

      const page = await owner.get(`/app/circles/${circleId}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain("Needs attention");
      expect(page.text).toContain("No driver yet for Eye clinic");
      expect(page.text).toContain("Tasks nobody has taken yet: 1");
      expect(page.text).toContain("Medicines today");
      expect((await owner.get("/app")).text).toContain("Needs attention: 2");

      // Once Amma stops sharing medicines with family, the dashboard leaves them out for family and admins alike.
      expect((await elder.put(`/api/v1/circles/${circleId}/consent`, { shareMedications: false, shareAppointments: true, shareHealth: true })).status).toBe(200);
      for (const viewer of [owner, family]) {
        const after = await viewer.get(`/app/circles/${circleId}`);
        expect(after.text).toContain("Eye clinic");
        expect(after.text).not.toContain("Medicines today");
      }

      const stranger = await new Actor("Eve").register();
      expect((await stranger.get(`/app/circles/${circleId}`)).text).not.toContain("Eye clinic");
      expect((await new Actor().get(`/app/circles/${circleId}`)).status).toBe(307);
    });

    it("injection-shaped input is stored and returned as plain text", async () => {
      const owner = await new Actor().register();
      const circleId = await circleWith(owner);
      const payload = `'); DROP TABLE users; -- <script>alert(1)</script>`;
      expect((await owner.post(`/api/v1/circles/${circleId}/updates`, { body: payload })).status).toBe(201);
      expect((await owner.get(`/api/v1/circles/${circleId}/updates`)).json.updates[0].body).toBe(payload);
      const page = await owner.get(`/app/circles/${circleId}/updates`);
      expect(page.text).not.toContain("<script>alert(1)</script>");
      expect((await owner.get(`/api/v1/circles/${circleId}/timeline?q=${encodeURIComponent("%' OR '1'='1")}`)).json.items).toEqual([]);
      expect((await new Actor().get("/api/health")).status).toBe(200);
    });
  });
});
