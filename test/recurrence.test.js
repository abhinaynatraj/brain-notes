import { describe, it, expect } from "vitest";
import { nextOccurrence } from "../src/recurrence.js";

describe("nextOccurrence", () => {
  it("daily adds one day", () => {
    expect(nextOccurrence("2026-06-01T09:00:00", { kind: "daily", interval: 1 }))
      .toBe("2026-06-02T09:00:00");
  });
  it("every_n_days respects interval", () => {
    expect(nextOccurrence("2026-06-01T09:00:00", { kind: "every_n_days", interval: 3 }))
      .toBe("2026-06-04T09:00:00");
  });
  it("weekly adds seven days", () => {
    expect(nextOccurrence("2026-06-01T09:00:00", { kind: "weekly", interval: 1 }))
      .toBe("2026-06-08T09:00:00");
  });
  it("weekdays skips weekend (Fri -> Mon)", () => {
    // 2026-06-05 is a Friday
    expect(nextOccurrence("2026-06-05T09:00:00", { kind: "weekdays" }))
      .toBe("2026-06-08T09:00:00");
  });
  it("monthly adds one month", () => {
    expect(nextOccurrence("2026-06-15T09:00:00", { kind: "monthly", interval: 1 }))
      .toBe("2026-07-15T09:00:00");
  });
  it("returns null for null recurrence", () => {
    expect(nextOccurrence("2026-06-01T09:00:00", null)).toBeNull();
  });
});
