// Minimal HTTP client for black-box tests: talks to a running CareNest only through its public
// HTTP interface (no imports from src/). Each Actor keeps its own cookie, like a browser.

import { randomInt, randomUUID } from "node:crypto";

export const BASE = process.env.BLACKBOX_URL?.replace(/\/$/, "") ?? "";

// Black-box tests inspect arbitrary response JSON, so it is deliberately untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export type Res = { status: number; headers: Headers; json: Json; text: string };

export class Actor {
  cookie = "";
  // A stable fake client address per actor, so per-IP limits don't couple unrelated tests.
  readonly ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
  constructor(public name = "Tester") {}

  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Res> {
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== "GET") headers.origin ??= BASE;
    if (extra.origin === "") delete headers.origin;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const pair = setCookie.split(";")[0];
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await res.text();
    let json: Json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  get = (path: string) => this.call("GET", path);
  post = (path: string, body: unknown = {}) => this.call("POST", path, body);
  put = (path: string, body: unknown) => this.call("PUT", path, body);
  patch = (path: string, body: unknown) => this.call("PATCH", path, body);
  del = (path: string) => this.call("DELETE", path);

  email = `bb-${randomUUID()}@example.test`;
  async register(timeZone = "Europe/London") {
    const res = await this.post("/api/v1/auth/register", { email: this.email, name: this.name, password: "correct horse battery staple", timeZone });
    if (res.status !== 201) throw new Error(`register failed ${res.status} ${res.text}`);
    return this;
  }
}

/** A circle for "Amma" with the given people invited and joined in the given roles. */
export async function circleWith(owner: Actor, members: [Actor, string][] = []) {
  const created = await owner.post("/api/v1/circles", {
    name: "Amma's care",
    recipient: { displayName: "Lakshmi Rao", preferredName: "Amma", timeZone: "Asia/Kolkata", country: "IN" },
  });
  const circleId: string = created.json.circle.id;
  for (const [actor, role] of members) {
    const inv = await owner.post(`/api/v1/circles/${circleId}/invitations`, { email: actor.email, role });
    const token = String(inv.json.inviteUrl).split("/").pop();
    const acc = await actor.post(`/api/v1/invitations/${token}/accept`);
    if (acc.status !== 200) throw new Error(`accept failed ${acc.status} ${acc.text}`);
  }
  return circleId;
}
