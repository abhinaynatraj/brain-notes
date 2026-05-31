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
