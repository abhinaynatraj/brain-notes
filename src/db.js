export async function findOrCreateUser(env, email) {
  // INSERT OR IGNORE is idempotent: concurrent first-logins for the same email
  // can't both throw on the UNIQUE(email) constraint. Re-fetch to get the row
  // regardless of which request won the insert.
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .bind(id, email, created_at).run();
  return env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
}

export async function createSession(env, userId, ttlSeconds = 60 * 60 * 24 * 30) {
  const id = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expires_at).run();
  return id;
}

export async function getUserBySession(env, sessionId) {
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  ).bind(sessionId, new Date().toISOString()).first();
  return row || null;
}

export async function insertTodo(env, userId, rawText, cleaned) {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todos (id, user_id, raw_text, title, notes, status, due_at, reminder_at, recurrence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
  ).bind(
    id, userId, rawText, cleaned.title, cleaned.notes,
    cleaned.due_at, cleaned.reminder_at,
    cleaned.recurrence ? JSON.stringify(cleaned.recurrence) : null,
    nowIso, nowIso
  ).run();
  return getTodo(env, userId, id);
}

export async function getTodo(env, userId, id) {
  return env.DB.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").bind(id, userId).first();
}

export async function listTodos(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todos WHERE user_id = ?
     ORDER BY status = 'done', COALESCE(due_at, '9999'), created_at`
  ).bind(userId).all();
  return results;
}

export async function deleteTodo(env, userId, id) {
  await env.DB.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").bind(id, userId).run();
}
