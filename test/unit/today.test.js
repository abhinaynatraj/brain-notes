import { describe, it, expect } from "vitest";
import { todoWhen, bucketForToday, buildToday } from "../../public/today.js";

const NOW = "2026-06-26T10:00:00";

describe("todoWhen", () => {
  it("prefers reminder_at, then due_at, then null", () => {
    expect(todoWhen({ reminder_at: "2026-06-26T09:00:00", due_at: "2026-06-27T00:00:00" })).toBe("2026-06-26T09:00:00");
    expect(todoWhen({ reminder_at: null, due_at: "2026-06-27T00:00:00" })).toBe("2026-06-27T00:00:00");
    expect(todoWhen({ reminder_at: null, due_at: null })).toBeNull();
  });
});

describe("bucketForToday", () => {
  it("undated is excluded", () => {
    expect(bucketForToday(null, NOW)).toBeNull();
    expect(bucketForToday("", NOW)).toBeNull();
  });
  it("an earlier calendar day is overdue", () => {
    expect(bucketForToday("2026-06-25T23:00:00", NOW)).toBe("overdue");
  });
  it("earlier time the same day is still today (not overdue)", () => {
    expect(bucketForToday("2026-06-26T08:00:00", NOW)).toBe("today");
  });
  it("later time the same day is today", () => {
    expect(bucketForToday("2026-06-26T18:00:00", NOW)).toBe("today");
  });
  it("a later calendar day is excluded", () => {
    expect(bucketForToday("2026-06-27T01:00:00", NOW)).toBeNull();
  });
});

describe("buildToday", () => {
  it("groups, excludes done/undated/future, and sorts ascending", () => {
    const todos = [
      { id: "a", status: "open", reminder_at: "2026-06-26T18:00:00", due_at: null },
      { id: "b", status: "open", reminder_at: "2026-06-26T08:00:00", due_at: null },
      { id: "c", status: "open", reminder_at: "2026-06-25T09:00:00", due_at: null }, // overdue
      { id: "d", status: "done", reminder_at: "2026-06-26T09:00:00", due_at: null }, // done -> excluded
      { id: "e", status: "open", reminder_at: null, due_at: null },                  // undated -> excluded
      { id: "f", status: "open", reminder_at: "2026-06-27T09:00:00", due_at: null }, // future -> excluded
    ];
    const out = buildToday(todos, NOW);
    expect(out.overdue.map((t) => t.id)).toEqual(["c"]);
    expect(out.today.map((t) => t.id)).toEqual(["b", "a"]); // 08:00 before 18:00
  });
});
