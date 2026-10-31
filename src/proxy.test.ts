import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/server/auth/request";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("redirects signed-out visitors to login, preserving the destination", () => {
    const res = proxy(new NextRequest("http://localhost/app/account?tab=devices"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login?next=%2Fapp%2Faccount%3Ftab%3Ddevices");
  });

  it("lets requests with a session cookie through to full validation", () => {
    const req = new NextRequest("http://localhost/app", { headers: { cookie: `${SESSION_COOKIE}=abc` } });
    expect(proxy(req).headers.get("x-middleware-next")).toBe("1");
  });
});
