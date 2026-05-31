export async function findOrCreateUser(env, email) {
  const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (existing) return existing;
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .bind(id, email, created_at).run();
  return { id, email, created_at };
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
