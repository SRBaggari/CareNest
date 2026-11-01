// Demo data: `npm run demo:seed` (server must be running; DEMO_URL defaults to http://localhost:3000).
// Everything is created through the public API, exactly as people would, and is clearly labelled
// as demo data. Never run this against a server holding real families' data.

const BASE = (process.env.DEMO_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET;
const PASSWORD = "carenest demo 2026";
const TZ = "Asia/Kolkata";

class Person {
  cookie = "";
  memberId = "";
  constructor(
    public name: string,
    public email: string,
    public timeZone: string,
    public locale = "en",
  ) {}

  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { origin: BASE };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${this.name}: ${method} ${path} → ${res.status} ${text}`);
    return json;
  }

  async join() {
    try {
      await this.call("POST", "/api/v1/auth/register", { email: this.email, name: this.name, password: PASSWORD, timeZone: this.timeZone, locale: this.locale });
    } catch (err) {
      if (!String(err).includes("409")) throw err;
      await this.call("POST", "/api/v1/auth/login", { email: this.email, password: PASSWORD });
    }
    return this;
  }
}

/** An instant `offsetMinutes` from now, plus Amma's local "HH:MM" and date for it. */
function inIndia(offsetMinutes: number) {
  const at = new Date(Date.now() + offsetMinutes * 60_000);
  return {
    iso: at.toISOString(),
    time: at.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
    date: at.toLocaleDateString("en-CA", { timeZone: TZ }),
  };
}

async function main() {
  console.log(`Seeding demo data into ${BASE} …`);
  const priya = await new Person("Priya Rao", "priya@demo.carenest", "Europe/London").join();
  const ravi = await new Person("Ravi Rao", "ravi@demo.carenest", TZ).join();
  const meena = await new Person("Meena (caregiver)", "meena@demo.carenest", TZ).join();
  const amma = await new Person("Lakshmi Rao", "amma@demo.carenest", TZ, "te").join();
  const doctor = await new Person("Dr. Iyer", "dr.iyer@demo.carenest", TZ).join();
  const neighbour = await new Person("Mrs. Reddy (neighbour)", "neighbour@demo.carenest", TZ).join();

  const existing = (await priya.call("GET", "/api/v1/circles")).circles.find((c: { name: string }) => c.name === "Amma's care [DEMO]");
  if (existing) {
    console.log("Demo circle already exists — nothing to do.");
    return;
  }

  // Priya, abroad in London, sets up the circle for her mother in Hyderabad (Scenario A).
  const { circle } = await priya.call("POST", "/api/v1/circles", {
    name: "Amma's care [DEMO]",
    recipient: { displayName: "Lakshmi Rao", preferredName: "Amma", dateOfBirth: "1948-03-14", timeZone: TZ, country: "IN", locale: "te", selfManaging: true },
  });
  const c = `/api/v1/circles/${circle.id}`;
  for (const [person, role] of [
    [ravi, "family"],
    [meena, "caregiver"],
    [amma, "care_recipient"],
    [doctor, "clinician"],
    [neighbour, "emergency_contact"],
  ] as const) {
    const { inviteUrl } = await priya.call("POST", `${c}/invitations`, { email: person.email, role });
    await person.call("POST", `/api/v1/invitations/${inviteUrl.split("/").pop()}/accept`);
  }
  const members = (await priya.call("GET", `${c}/members`)).members as { id: string; name: string }[];
  for (const p of [priya, ravi, meena, amma]) p.memberId = members.find((m) => m.name === p.name)!.id;
  console.log("  circle + 6 people");

  // Emergency card and tiered contacts (M7).
  await priya.call("PUT", `${c}/emergency/info`, {
    conditions: "Type 2 diabetes, high blood pressure",
    allergies: "Penicillin",
    medicationsNote: "Metformin, Amlodipine (see Medicines)",
    bloodGroup: "B+",
    doctorName: "Dr. Iyer",
    doctorPhone: "+91 98480 12345",
    preferredHospital: "Apollo Hospital, Jubilee Hills",
    communicationNote: "Speaks Telugu and some English; hard of hearing on the left side",
    homeAccessNote: "Spare key with Mrs. Reddy next door",
  });
  await priya.call("POST", `${c}/emergency/contacts`, { name: "Ravi Rao", phone: "+91 90000 00001", relationship: "Son (same city)", tier: 1, memberId: ravi.memberId });
  await priya.call("POST", `${c}/emergency/contacts`, { name: "Mrs. Reddy", phone: "+91 90000 00009", relationship: "Neighbour", tier: 1 });
  await priya.call("POST", `${c}/emergency/contacts`, { name: "Priya Rao", phone: "+44 7700 900123", relationship: "Daughter (London)", tier: 2, memberId: priya.memberId });
  console.log("  emergency card + contacts");

  // Medicines (M3). Times are around "now" so the day view has a mix of states.
  const earlier = inIndia(10); // due shortly
  const soon = inIndia(90);
  const later = inIndia(360);
  const today = earlier.date;
  await priya.call("POST", `${c}/medications`, { name: "Metformin", dosage: "1 tablet (500 mg)", instructions: "Take with food", prescriber: "Dr. Iyer", startDate: today, times: [earlier.time, later.time], supplyCount: 40, refillThreshold: 10 });
  await priya.call("POST", `${c}/medications`, { name: "Amlodipine", dosage: "5 mg", instructions: "Morning, after breakfast", prescriber: "Dr. Iyer", startDate: today, times: [soon.time], supplyCount: 4, refillThreshold: 5 });
  await priya.call("POST", `${c}/medications`, { name: "Paracetamol", dosage: "1 tablet (500 mg)", instructions: "For pain, at most 3 a day", asNeeded: true, times: [], supplyCount: 20 });
  const doses = (await amma.call("GET", `${c}/doses?date=${today}`)).doses as { id: string; localTime: string }[];
  const first = doses.find((d) => d.localTime === earlier.time);
  if (first) await amma.call("POST", `${c}/doses/${first.id}/record`, { status: "taken" });
  console.log("  medicines + today's doses (one confirmed by Amma herself)");

  // Appointments (M5): an upcoming one nobody is driving to yet.
  await priya.call("POST", `${c}/appointments`, {
    title: "Cardiology check-up",
    clinician: "Dr. Rao, Apollo Hospital",
    location: "Jubilee Hills, Hyderabad",
    startsAt: inIndia(2 * 24 * 60).iso,
    reason: "Routine follow-up, BP review",
    questions: "Is the dizziness in the mornings related to Amlodipine?\nShould she keep walking every evening?",
    transportNeeded: true,
  });
  await priya.call("POST", `${c}/appointments`, { title: "Eye test", kind: "in_person", clinician: "Vision Care", startsAt: inIndia(6 * 24 * 60).iso, transportNeeded: true });
  console.log("  appointments");

  // Tasks (M5): unassigned, taken, recurring.
  await priya.call("POST", `${c}/tasks`, { title: "Collect the new Amlodipine prescription", category: "medication", priority: "high", dueAt: inIndia(24 * 60).iso });
  await priya.call("POST", `${c}/tasks`, { title: "Pay the electricity bill", category: "bills", dueAt: inIndia(3 * 24 * 60).iso, assigneeMemberId: ravi.memberId });
  await priya.call("POST", `${c}/tasks`, { title: "Refill the weekly pill organiser", category: "medication", recurrence: "weekly", dueAt: inIndia(4 * 24 * 60).iso, assigneeMemberId: meena.memberId });
  const groceries = (await priya.call("POST", `${c}/tasks`, { title: "Buy groceries (atta, dal, fruit)", category: "shopping" })).task;
  await ravi.call("POST", `${c}/tasks/${groceries.id}/claim`, { action: "claim" });
  await ravi.call("POST", `${c}/tasks/${groceries.id}/complete`, { note: "Also got her favourite biscuits" });
  console.log("  tasks");

  // A caregiver visit this morning, finished with a handover (Scenario C), and one planned.
  const visit = (await meena.call("POST", `${c}/visits`, { startNow: true, purpose: "Morning care" })).visit;
  await meena.call("POST", `${c}/visits/${visit.id}/check-out`, {
    observations: "Ate breakfast well, walked to the gate and back. Slightly breathless on the stairs.",
    handoverNote: "Evening tablets are in the blue box on the kitchen shelf.",
    unresolvedIssues: "Bathroom tap is leaking — needs a plumber.",
  });
  await meena.call("POST", `${c}/visits`, { plannedStart: inIndia(24 * 60).iso, purpose: "Morning care" });
  console.log("  visits");

  // Updates (M6).
  await ravi.call("POST", `${c}/updates`, { body: "Called Amma this evening — she sounded cheerful and had dinner with Mrs. Reddy." });
  await meena.call("POST", `${c}/updates`, { body: "Mild knee pain after the walk. Applied the balm Dr. Iyer recommended.", category: "health" });
  await priya.call("POST", `${c}/updates`, { body: "I'll be in Hyderabad from the 20th for two weeks.", important: true });
  console.log("  updates");

  // A clearly labelled practice emergency drill, responded to and resolved (Scenario E).
  const drill = (await amma.call("POST", `${c}/emergency/requests`, { practice: true, message: "Practice drill — testing the help button" })).request;
  await ravi.call("POST", `${c}/emergency/requests/${drill.id}/acknowledge`);
  await ravi.call("POST", `${c}/emergency/requests/${drill.id}/resolve`, { note: "Practice drill complete — everyone was reached." });
  console.log("  practice emergency drill");

  // Run the background worker once so reminders and alerts appear (transport needed, unassigned task, low stock).
  if (CRON_SECRET) {
    await fetch(`${BASE}/api/internal/tick`, { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } });
    console.log("  worker tick (reminders and alerts)");
  }

  console.log(`\nDone. Sign in at ${BASE}/login with any of these (password: "${PASSWORD}"):`);
  for (const p of [priya, ravi, meena, amma, doctor, neighbour]) console.log(`  ${p.email.padEnd(26)} ${p.name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
