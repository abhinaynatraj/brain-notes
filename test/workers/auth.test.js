import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { requestLogin, verifyLogin } from "../../src/auth.js";
import { getUserBySession } from "../../src/db.js";

async function migrate() {
  const stmts = [
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS login_tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)",
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
}

beforeEach(async () => {
  await migrate();
  await env.DB.prepare("DELETE FROM users").run();
  await env.DB.prepare("DELETE FROM login_tokens").run();
  await env.DB.prepare("DELETE FROM sessions").run();
});

describe("magic-link auth", () => {
  it("rejects invalid email", async () => {
    const res = await requestLogin(new Request("http://x/api/auth/request", {
      method: "POST", body: JSON.stringify({ email: "nope" }),
    }), env);
    expect(res.status).toBe(400);
  });

  it("issues a token, verifies it, and creates a working session", async () => {
    await requestLogin(new Request("http://x/api/auth/request", {
      method: "POST", body: JSON.stringify({ email: "a@b.com" }),
    }), env);
    const row = await env.DB.prepare("SELECT token FROM login_tokens WHERE email = ?").bind("a@b.com").first();
    expect(row.token).toBeTruthy();

    const verify = await verifyLogin(new Request(`http://x/api/auth/verify?token=${row.token}`), env);
    expect(verify.status).toBe(302);
    const cookie = verify.headers.get("set-cookie");
    const sessionId = cookie.match(/session=([^;]+)/)[1];

    const user = await getUserBySession(env, decodeURIComponent(sessionId));
    expect(user.email).toBe("a@b.com");
  });

  it("rejects a reused token", async () => {
    await requestLogin(new Request("http://x/api/auth/request", {
      method: "POST", body: JSON.stringify({ email: "c@d.com" }),
    }), env);
    const { token } = await env.DB.prepare("SELECT token FROM login_tokens WHERE email = ?").bind("c@d.com").first();
    await verifyLogin(new Request(`http://x/api/auth/verify?token=${token}`), env);
    const second = await verifyLogin(new Request(`http://x/api/auth/verify?token=${token}`), env);
    expect(second.status).toBe(400);
  });
});
