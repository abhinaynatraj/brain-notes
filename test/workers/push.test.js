import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { selectDueReminders } from "../../src/push.js";

async function migrate() {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, raw_text TEXT NOT NULL,
     title TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'open', completed_at TEXT,
     due_at TEXT, reminder_at TEXT, recurrence TEXT, reminder_sent_at TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  ).run();
}
beforeEach(async () => { await migrate(); await env.DB.prepare("DELETE FROM todos").run(); });

async function seed(id, reminder_at, status = "open", reminder_sent_at = null) {
  await env.DB.prepare(
    `INSERT INTO todos (id, user_id, raw_text, title, status, reminder_at, reminder_sent_at, created_at, updated_at)
     VALUES (?, 'u', 'r', 't', ?, ?, ?, '2026-01-01', '2026-01-01')`
  ).bind(id, status, reminder_at, reminder_sent_at).run();
}

describe("selectDueReminders", () => {
  it("returns only due, unsent, open todos", async () => {
    await seed("past-open", "2026-05-29T08:00:00");
    await seed("future-open", "2099-01-01T08:00:00");
    await seed("past-done", "2026-05-29T08:00:00", "done");
    await seed("past-sent", "2026-05-29T08:00:00", "open", "2026-05-29T08:01:00");
    const due = await selectDueReminders(env, "2026-05-29T09:00:00");
    expect(due.map((t) => t.id)).toEqual(["past-open"]);
  });
});
