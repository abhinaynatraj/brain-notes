import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { insertTodo, listTodos, getTodo } from "../../src/db.js";
import { patchTodo } from "../../src/todos.js";

async function migrate() {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, raw_text TEXT NOT NULL,
     title TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'open', completed_at TEXT,
     due_at TEXT, reminder_at TEXT, recurrence TEXT, reminder_sent_at TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  ).run();
}
beforeEach(async () => { await migrate(); await env.DB.prepare("DELETE FROM todos").run(); });

const USER = "user-1";

describe("todos", () => {
  it("inserts and lists a todo", async () => {
    await insertTodo(env, USER, "buy milk", { title: "Buy milk", notes: null, due_at: null, reminder_at: null, recurrence: null });
    const list = await listTodos(env, USER);
    expect(list.length).toBe(1);
    expect(list[0].title).toBe("Buy milk");
  });

  it("toggling a recurring todo to done spawns the next instance", async () => {
    const todo = await insertTodo(env, USER, "standup", {
      title: "Standup", notes: null, due_at: "2026-06-01T09:00:00",
      reminder_at: "2026-06-01T09:00:00", recurrence: { kind: "daily", interval: 1 },
    });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    await patchTodo(req, env, { id: USER }, todo.id);
    const list = await listTodos(env, USER);
    const open = list.filter((t) => t.status === "open");
    const done = list.filter((t) => t.status === "done");
    expect(done.length).toBe(1);
    expect(open.length).toBe(1);
    expect(open[0].reminder_at).toBe("2026-06-02T09:00:00.000Z");
  });

  it("non-recurring done does not spawn", async () => {
    const todo = await insertTodo(env, USER, "once", { title: "Once", notes: null, due_at: null, reminder_at: null, recurrence: null });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    await patchTodo(req, env, { id: USER }, todo.id);
    expect((await listTodos(env, USER)).length).toBe(1);
  });

  it("applies a combined status + field edit in one request", async () => {
    const todo = await insertTodo(env, USER, "task", { title: "Task", notes: null, due_at: null, reminder_at: null, recurrence: null });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "done", title: "Task done" }) });
    await patchTodo(req, env, { id: USER }, todo.id);
    const updated = await getTodo(env, USER, todo.id);
    expect(updated.status).toBe("done");
    expect(updated.title).toBe("Task done");
    expect(updated.completed_at).not.toBeNull();
  });

  it("rejects an invalid status", async () => {
    const todo = await insertTodo(env, USER, "x", { title: "X", notes: null, due_at: null, reminder_at: null, recurrence: null });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
    const res = await patchTodo(req, env, { id: USER }, todo.id);
    expect(res.status).toBe(400);
  });

  it("the create path's UTC conversion runs under the Workers Intl", async () => {
    // cleanupOrFallback returns null dates without an API key, so the conversion
    // itself is covered exhaustively in test/unit/tz.test.js; this confirms
    // localToUtc resolves and computes correctly inside the Workers runtime.
    const { localToUtc } = await import("../../src/tz.js");
    expect(localToUtc("2026-06-29T12:00:00", "America/Toronto")).toBe("2026-06-29T16:00:00.000Z");
    expect(localToUtc(null, "America/Toronto")).toBeNull();
  });
});
