import { json } from "./util.js";
import { cleanupOrFallback } from "./claude.js";
import { nextOccurrence } from "./recurrence.js";
import { insertTodo, getTodo, listTodos, deleteTodo } from "./db.js";

export async function createTodo(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const rawText = (body.raw_text || "").trim();
  if (!rawText) return json({ error: "empty" }, 400);
  const now = body.now || new Date().toISOString().slice(0, 19);
  const timezone = body.timezone || "UTC";
  const cleaned = await cleanupOrFallback(env, { rawText, now, timezone });
  const todo = await insertTodo(env, user.id, rawText, cleaned);
  return json(todo, 201);
}

export async function getTodos(request, env, user) {
  return json(await listTodos(env, user.id));
}

export async function patchTodo(request, env, user, id) {
  const existing = await getTodo(env, user.id, id);
  if (!existing) return json({ error: "not found" }, 404);
  const body = await request.json().catch(() => ({}));
  const nowIso = new Date().toISOString();

  if (body.status != null && body.status !== "open" && body.status !== "done") {
    return json({ error: "invalid status" }, 400);
  }

  // Status toggle with recurrence spawning.
  if (body.status && body.status !== existing.status) {
    if (body.status === "done" && existing.recurrence) {
      const rec = JSON.parse(existing.recurrence);
      const base = existing.reminder_at || existing.due_at;
      if (base) {
        const nextRem = existing.reminder_at ? nextOccurrence(existing.reminder_at, rec) : null;
        const nextDue = existing.due_at ? nextOccurrence(existing.due_at, rec) : null;
        await insertTodo(env, user.id, existing.raw_text, {
          title: existing.title, notes: existing.notes,
          due_at: nextDue, reminder_at: nextRem, recurrence: rec,
        });
      }
    }
    const completed_at = body.status === "done" ? nowIso : null;
    await env.DB.prepare("UPDATE todos SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(body.status, completed_at, nowIso, id, user.id).run();
  }

  // Editable fields — keys come from this hardcoded allowlist (NOT user input),
  // so the column name in the template literal is safe from SQL injection.
  const fields = ["title", "notes", "due_at", "reminder_at"];
  for (const f of fields) {
    if (f in body) {
      await env.DB.prepare(`UPDATE todos SET ${f} = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(body[f], nowIso, id, user.id).run();
    }
  }
  return json(await getTodo(env, user.id, id));
}

export async function removeTodo(request, env, user, id) {
  await deleteTodo(env, user.id, id);
  return json({ ok: true });
}
