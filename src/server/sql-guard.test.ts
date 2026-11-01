import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A raw sql`a or b` fragment inside and(eq(circleId, …), …) is not bracketed by the query builder, so
// it reads as `(circle = … and a) or b` and returns rows from every circle. This happened once
// (visits). Use or()/and() from drizzle-orm, or wrap the whole fragment in parentheses.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

describe("raw SQL fragments", () => {
  it("bracket any OR, so it can't escape the circle filter", () => {
    const offenders: string[] = [];
    for (const file of files("src/server")) {
      for (const match of readFileSync(file, "utf8").matchAll(/sql`([^`]*)`/g)) {
        const body = match[1].trim();
        if (/\bor\b/i.test(body) && !(body.startsWith("(") && body.endsWith(")"))) offenders.push(`${file}: ${body.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
