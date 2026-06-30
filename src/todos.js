import { json } from "./util.js";
import { cleanupOrFallback } from "./claude.js";
import { nextOccurrence } from "./recurrence.js";
import { insertTodo, getTodo, listTodos, deleteTodo, deleteTodos } from "./db.js";
import { localToUtc } from "./tz.js";

export async function createTodo(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const rawText = (body.raw_text || "").trim();
  if (!rawText) return json({ error: "empty" }, 400);
  const now = body.now || new Date().toISOString().slice(0, 19);
  const timezone = body.timezone || "UTC";
  const cleaned = await cleanupOrFallback(env, { rawText, now, timezone });
  // Claude returns naive local times; store true UTC instants so the cron
  // (which compares against a UTC now) fires at the correct moment.
  cleaned.due_at = localToUtc(cleaned.due_at, timezone);
  cleaned.reminder_at = localToUtc(cleaned.reminder_at, timezone);
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

  // Validate client-supplied date fields: must be null or an ISO datetime.
  // Accepts both the naive form and a UTC instant ("…Z", optional millis) since
  // edits now send UTC. Rejecting empty/garbage strings keeps the cron's
  // `reminder_at <= now` scan from matching a "" that fires immediately.
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/;
  for (const f of ["due_at", "reminder_at"]) {
    if (f in body && body[f] !== null && (typeof body[f] !== "string" || !ISO_RE.test(body[f]))) {
      return json({ error: `invalid ${f}` }, 400);
    }
  }

  // Editable fields — column names come from this hardcoded allowlist (NOT user
  // input), so interpolating them into the SQL is safe from injection. Applied
  // in a single UPDATE to avoid one D1 round trip per edited field.
  const fields = ["title", "notes", "due_at", "reminder_at"];
  const edits = fields.filter((f) => f in body);
  if (edits.length) {
    const setClause = [...edits.map((f) => `${f} = ?`), "updated_at = ?"].join(", ");
    const binds = [...edits.map((f) => body[f]), nowIso, id, user.id];
    await env.DB.prepare(`UPDATE todos SET ${setClause} WHERE id = ? AND user_id = ?`)
      .bind(...binds).run();
  }
  return json(await getTodo(env, user.id, id));
}

export async function removeTodo(request, env, user, id) {
  await deleteTodo(env, user.id, id);
  return json({ ok: true });
}

export async function clearTodos(request, env, user) {
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope !== "done" && scope !== "all") {
    return json({ error: "invalid scope" }, 400);
  }
  const deleted = await deleteTodos(env, user.id, scope);
  return json({ deleted });
}
