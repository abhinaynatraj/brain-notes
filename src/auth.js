import { json, randomToken, serializeCookie, parseCookies } from "./util.js";
import { findOrCreateUser, createSession } from "./db.js";
import { sendMagicLink } from "./email.js";

const TOKEN_TTL_MS = 15 * 60 * 1000;

function isLocalhost(request) {
  const h = new URL(request.url).hostname;
  return h === "localhost" || h === "127.0.0.1";
}

export async function requestLogin(request, env) {
  const { email } = await request.json().catch(() => ({}));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "invalid email" }, 400);
  }
  const token = randomToken(24);
  const expires_at = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await env.DB.prepare("INSERT INTO login_tokens (token, email, expires_at, used) VALUES (?, ?, ?, 0)")
    .bind(token, email, expires_at).run();
  const link = `${env.APP_URL}/api/auth/verify?token=${token}`;
  await sendMagicLink(env, email, link);
  return json({ ok: true }); // never reveal whether the email exists
}

export async function verifyLogin(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "invalid or expired token" }, 400);
  // Atomically claim the token: only one concurrent request can flip used 0->1,
  // so a single magic link can never mint more than one session (no TOCTOU race).
  const claim = await env.DB.prepare(
    "UPDATE login_tokens SET used = 1 WHERE token = ? AND used = 0 AND expires_at > ?"
  ).bind(token, new Date().toISOString()).run();
  if (!claim.meta.changes) return json({ error: "invalid or expired token" }, 400);
  const row = await env.DB.prepare("SELECT email FROM login_tokens WHERE token = ?").bind(token).first();
  if (!row) return json({ error: "invalid or expired token" }, 400);
  const user = await findOrCreateUser(env, row.email);
  const sessionId = await createSession(env, user.id);
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": serializeCookie("session", sessionId, { maxAge: 60 * 60 * 24 * 30, secure: !isLocalhost(request) }),
    },
  });
}

export async function logout(request, env) {
  // Invalidate server-side too, so a captured cookie can't outlive logout.
  const sessionId = parseCookies(request).session;
  if (sessionId) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  return json({ ok: true }, 200, {
    "set-cookie": serializeCookie("session", "", { maxAge: 0, secure: !isLocalhost(request) }),
  });
}
