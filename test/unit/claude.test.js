import { describe, it, expect } from "vitest";
import { validateCleanup, fallbackCleanup } from "../../src/claude.js";

describe("validateCleanup", () => {
  it("accepts a well-formed object", () => {
    const out = validateCleanup({
      title: "Call dentist", notes: null,
      due_at: "2026-06-02T00:00:00", reminder_at: "2026-06-02T14:00:00",
      recurrence: null,
    });
    expect(out.title).toBe("Call dentist");
    expect(out.reminder_at).toBe("2026-06-02T14:00:00");
  });
  it("coerces missing optional fields to null", () => {
    const out = validateCleanup({ title: "Buy milk" });
    expect(out).toEqual({ title: "Buy milk", notes: null, due_at: null, reminder_at: null, recurrence: null });
  });
  it("rejects when title missing", () => {
    expect(() => validateCleanup({ due_at: "2026-06-02T00:00:00" })).toThrow();
  });
  it("rejects a bad date string", () => {
    expect(() => validateCleanup({ title: "x", due_at: "next tuesday" })).toThrow();
  });
  it("rejects an unknown recurrence kind", () => {
    expect(() => validateCleanup({ title: "x", recurrence: { kind: "fortnightly" } })).toThrow();
  });
});

describe("fallbackCleanup", () => {
  it("uses raw text as title with no dates", () => {
    expect(fallbackCleanup("buy   milk later")).toEqual({
      title: "buy milk later", notes: null, due_at: null, reminder_at: null, recurrence: null,
    });
  });
});
