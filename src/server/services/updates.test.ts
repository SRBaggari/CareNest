import { describe, expect, it } from "vitest";
import { visibleCategories } from "./updates";

describe("visibleCategories", () => {
  it("shows health and mood notes only to people who may see health details", () => {
    expect(visibleCategories({ can: () => true })).toEqual(["general", "health", "mood"]);
    expect(visibleCategories({ can: (c) => c !== "health.view" })).toEqual(["general"]);
  });
});
