import { describe, it, expect } from "vitest";
import { todoWhen, bucketForToday, buildToday, localDateKey } from "../../public/today.js";

// Build a UTC instant that is `dayDelta` local-days from `nowMs` at local `hour`,
// so the local-date comparison is unambiguous regardless of the test machine's tz.
function localInstant(nowMs, dayDelta, hour = 12) {
  const base = new Date(nowMs);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayDelta, hour, 0, 0);
  return d.toISOString(); // UTC instant for that local wall time
}

const NOW = Date.UTC(2026, 5, 29, 16, 0, 0); // a fixed instant

describe("todoWhen", () => {
  it("prefers reminder_at, then due_at, then null", () => {
    expect(todoWhen({ reminder_at: "2026-06-29T16:00:00.000Z", due_at: "x" })).toBe("2026-06-29T16:00:00.000Z");
    expect(todoWhen({ reminder_at: null, due_at: "y" })).toBe("y");
    expect(todoWhen({ reminder_at: null, due_at: null })).toBeNull();
  });
});

describe("bucketForToday (by local date)", () => {
  it("undated is excluded", () => {
    expect(bucketForToday(null, NOW)).toBeNull();
    expect(bucketForToday("", NOW)).toBeNull();
  });
  it("yesterday (local) is overdue", () => {
    expect(bucketForToday(localInstant(NOW, -1), NOW)).toBe("overdue");
  });
  it("earlier today (local) is today", () => {
    expect(bucketForToday(localInstant(NOW, 0, 1), NOW)).toBe("today");
  });
  it("later today (local) is today", () => {
    expect(bucketForToday(localInstant(NOW, 0, 23), NOW)).toBe("today");
  });
  it("tomorrow (local) is excluded", () => {
    expect(bucketForToday(localInstant(NOW, 1), NOW)).toBeNull();
  });
  it("malformed instant is excluded", () => {
    expect(bucketForToday("not-a-date", NOW)).toBeNull();
  });
});

describe("buildToday", () => {
  it("groups open todos by local date and excludes done/undated/future", () => {
    const todos = [
      { id: "late",  status: "open", reminder_at: localInstant(NOW, 0, 18), due_at: null },
      { id: "early", status: "open", reminder_at: localInstant(NOW, 0, 8),  due_at: null },
      { id: "over",  status: "open", reminder_at: localInstant(NOW, -1, 9), due_at: null },
      { id: "done",  status: "done", reminder_at: localInstant(NOW, 0, 9),  due_at: null },
      { id: "undated", status: "open", reminder_at: null, due_at: null },
      { id: "future", status: "open", reminder_at: localInstant(NOW, 1, 9), due_at: null },
    ];
    const out = buildToday(todos, NOW);
    expect(out.overdue.map((t) => t.id)).toEqual(["over"]);
    expect(out.today.map((t) => t.id)).toEqual(["early", "late"]);
  });
});

describe("localDateKey", () => {
  it("formats a date's local Y-M-D", () => {
    const d = new Date(2026, 0, 5, 9, 0, 0);
    expect(localDateKey(d)).toBe("2026-01-05");
  });
});
