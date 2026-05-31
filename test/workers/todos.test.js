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
    expect(open[0].reminder_at).toBe("2026-06-02T09:00:00");
  });

  it("non-recurring done does not spawn", async () => {
    const todo = await insertTodo(env, USER, "once", { title: "Once", notes: null, due_at: null, reminder_at: null, recurrence: null });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    await patchTodo(req, env, { id: USER }, todo.id);
    expect((await listTodos(env, USER)).length).toBe(1);
  });
});
