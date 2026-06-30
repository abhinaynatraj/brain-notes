import { describe, it, expect } from "vitest";
import { localToUtc } from "../../src/tz.js";

describe("localToUtc", () => {
  it("returns null for null/empty input", () => {
    expect(localToUtc(null, "America/Toronto")).toBeNull();
    expect(localToUtc("", "America/Toronto")).toBeNull();
  });

  it("converts Toronto summer (EDT, UTC-4) wall time to UTC", () => {
    // 2026-06-29 is EDT. Noon local = 16:00 UTC.
    expect(localToUtc("2026-06-29T12:00:00", "America/Toronto")).toBe("2026-06-29T16:00:00.000Z");
  });

  it("converts Toronto winter (EST, UTC-5) wall time to UTC", () => {
    // 2026-01-15 is EST. Noon local = 17:00 UTC.
    expect(localToUtc("2026-01-15T12:00:00", "America/Toronto")).toBe("2026-01-15T17:00:00.000Z");
  });

  it("treats a UTC timezone as no offset", () => {
    expect(localToUtc("2026-06-29T12:00:00", "UTC")).toBe("2026-06-29T12:00:00.000Z");
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(localToUtc("2026-06-29T12:00:00", "Not/AZone")).toBe("2026-06-29T12:00:00.000Z");
  });
});
