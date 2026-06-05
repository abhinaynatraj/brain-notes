import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { selectDueReminders, sendDueReminders } from "../../src/push.js";

async function migrate() {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, raw_text TEXT NOT NULL,
     title TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'open', completed_at TEXT,
     due_at TEXT, reminder_at TEXT, recurrence TEXT, reminder_sent_at TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
     endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL)`
  ).run();
}
beforeEach(async () => {
  await migrate();
  await env.DB.prepare("DELETE FROM todos").run();
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
});
afterEach(() => { vi.restoreAllMocks(); });

async function seed(id, reminder_at, status = "open", reminder_sent_at = null, user = "u") {
  await env.DB.prepare(
    `INSERT INTO todos (id, user_id, raw_text, title, status, reminder_at, reminder_sent_at, created_at, updated_at)
     VALUES (?, ?, 'r', 't', ?, ?, ?, '2026-01-01', '2026-01-01')`
  ).bind(id, user, status, reminder_at, reminder_sent_at).run();
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

describe("sendDueReminders", () => {
  it("stamps reminder_sent_at even when the user has no subscriptions (no infinite retry)", async () => {
    // No push_subscriptions rows for user "u": the send loop is a no-op, but the
    // reminder must still be marked sent so the cron doesn't re-fire it forever.
    await seed("due", "2026-05-29T08:00:00");
    const count = await sendDueReminders(env, "2026-05-29T09:00:00");
    expect(count).toBe(1);
    const row = await env.DB.prepare("SELECT reminder_sent_at FROM todos WHERE id = ?").bind("due").first();
    expect(row.reminder_sent_at).toBe("2026-05-29T09:00:00");
  });

  it("does not re-fire an already-stamped reminder on the next tick", async () => {
    await seed("due", "2026-05-29T08:00:00");
    await sendDueReminders(env, "2026-05-29T09:00:00");
    const second = await sendDueReminders(env, "2026-05-29T09:01:00");
    expect(second).toBe(0); // nothing left to send
  });
});
