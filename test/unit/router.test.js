import { describe, it, expect } from "vitest";
import { createRouter } from "../../src/router.js";

describe("createRouter", () => {
  it("matches a static route by method + path", () => {
    const r = createRouter();
    const h = () => "ok";
    r.get("/api/todos", h);
    const m = r.match("GET", "/api/todos");
    expect(m.handler).toBe(h);
    expect(m.params).toEqual({});
  });

  it("does not match a different method", () => {
    const r = createRouter();
    r.get("/api/todos", () => {});
    expect(r.match("POST", "/api/todos")).toBeNull();
  });

  it("extracts a path param", () => {
    const r = createRouter();
    const h = () => {};
    r.patch("/api/todos/:id", h);
    const m = r.match("PATCH", "/api/todos/abc-123");
    expect(m.handler).toBe(h);
    expect(m.params).toEqual({ id: "abc-123" });
  });

  it("returns null when nothing matches", () => {
    const r = createRouter();
    r.get("/api/todos", () => {});
    expect(r.match("GET", "/api/nope")).toBeNull();
  });

  it("treats a literal dot as a dot, not a wildcard", () => {
    const r = createRouter();
    r.get("/api/v1.0/health", () => {});
    expect(r.match("GET", "/api/v1.0/health")).not.toBeNull();
    // A different char where the dot is must NOT match.
    expect(r.match("GET", "/api/v1X0/health")).toBeNull();
  });
});
