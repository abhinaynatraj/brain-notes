# Brain Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a natural-language todo PWA where fuzzy sentences become crisp todos via Claude, with cross-device sync, Web Push reminders, recurring todos, status toggling, and deliberate dark/light theming.

**Architecture:** A single Cloudflare Worker serves the vanilla-JS PWA as static assets and exposes a JSON API. D1 (SQLite) stores users, sessions, todos, and push subscriptions. A Cron Trigger fires every minute to deliver due Web Push reminders. Claude API cleans raw text into structured todos; its response is schema-validated with a safe fallback.

**Tech Stack:** Cloudflare Workers, D1, Wrangler, Vitest + `@cloudflare/vitest-pool-workers` (Miniflare), vanilla JS, hand-written CSS, Web Push (VAPID via `@block65/webcrypto-web-push`), Claude API (Anthropic Messages API).

---

## File Structure

```
brain-notes/
├── wrangler.toml                 # Worker + D1 + cron + static assets config
├── package.json                  # deps + scripts (dev, test, deploy)
├── vitest.config.js              # Miniflare test pool config
├── .dev.vars.example             # documents required secrets (committed; real .dev.vars ignored)
├── schema.sql                    # D1 table definitions
├── src/
│   ├── index.js                  # Worker entry: fetch() router + scheduled() cron
│   ├── router.js                 # tiny path/method router
│   ├── auth.js                   # magic-link request/verify, session create/validate
│   ├── todos.js                  # todo CRUD handlers
│   ├── claude.js                 # Claude call + strict response validation + fallback
│   ├── recurrence.js             # next-instance date math (pure, timezone-aware)
│   ├── push.js                   # subscribe/unsubscribe + send-due-reminders (cron core)
│   ├── email.js                  # send magic-link email (via Worker fetch to provider)
│   ├── db.js                     # D1 query helpers
│   └── util.js                   # json(), random tokens, cookie parse/serialize
├── public/                       # static PWA assets served by the Worker
│   ├── index.html
│   ├── app.js                    # SPA logic: capture, list, settings, login
│   ├── styles.css                # hand-written CSS + theme custom properties
│   ├── sw.js                     # service worker: offline shell + push handler
│   ├── manifest.json
│   └── icons/                    # PWA icons (placeholder generated)
└── test/
    ├── recurrence.test.js
    ├── claude.test.js
    ├── auth.test.js
    ├── todos.test.js
    └── push.test.js
```

**Responsibility boundaries:** pure logic (`recurrence.js`, `claude.js` validation) is separated from I/O (`db.js`, `email.js`, `push.js` network) so the highest-value logic is unit-testable without mocking the network. `index.js`/`router.js` only wire requests to handlers.

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `wrangler.toml`, `vitest.config.js`, `.dev.vars.example`, `schema.sql`, `src/index.js`, `src/util.js`, `public/index.html`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "brain-notes",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "deploy": "wrangler deploy",
    "db:init": "wrangler d1 execute brain_notes --local --file=./schema.sql",
    "db:init:remote": "wrangler d1 execute brain_notes --remote --file=./schema.sql"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.80.0"
  },
  "dependencies": {
    "@block65/webcrypto-web-push": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create `wrangler.toml`**

```toml
name = "brain-notes"
main = "src/index.js"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./public"
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "brain_notes"
database_id = "PLACEHOLDER_FILLED_BY_WRANGLER_AFTER_CREATE"

[triggers]
crons = ["* * * * *"]

[vars]
APP_URL = "http://localhost:8787"
```

- [ ] **Step 3: Create `.dev.vars.example`** (documents secrets; real `.dev.vars` is gitignored)

```
# Copy to .dev.vars and fill in. NEVER commit .dev.vars.
ANTHROPIC_API_KEY=sk-ant-...
SESSION_SECRET=generate-a-long-random-string
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
EMAIL_API_KEY=
EMAIL_FROM=Brain Notes <noreply@yourdomain>
```

- [ ] **Step 4: Create `vitest.config.js`**

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
        },
      },
    },
  },
});
```

- [ ] **Step 5: Create `schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  completed_at TEXT,
  due_at TEXT,
  reminder_at TEXT,
  recurrence TEXT,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id, status);
CREATE INDEX IF NOT EXISTS idx_todos_reminder ON todos(reminder_at, reminder_sent_at, status);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

- [ ] **Step 6: Create `src/util.js`**

```js
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseCookies(req) {
  const header = req.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Secure`;
  if (httpOnly) c += "; HttpOnly";
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  return c;
}
```

- [ ] **Step 7: Create minimal `src/index.js`**

```js
import { json } from "./util.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    // reminder cron wired in Task 6
  },
};
```

- [ ] **Step 8: Create minimal `public/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Brain Notes</title>
  </head>
  <body>
    <main id="app">Brain Notes</main>
  </body>
</html>
```

- [ ] **Step 9: Install deps and create the local D1 database**

Run: `npm install`
Then: `npx wrangler d1 create brain_notes`
Expected: prints a `database_id`. Paste it into `wrangler.toml` replacing `PLACEHOLDER_FILLED_BY_WRANGLER_AFTER_CREATE`.
Then: `npm run db:init`
Expected: tables created in local D1.

- [ ] **Step 10: Verify the worker boots**

Run: `npm run dev` (then in another shell) `curl -s localhost:8787/api/health`
Expected: `{"ok":true}`. Stop dev with Ctrl-C.

- [ ] **Step 11: Commit**

```bash
git add package.json wrangler.toml vitest.config.js .dev.vars.example schema.sql src/index.js src/util.js public/index.html
git commit -m "chore: scaffold Worker + D1 + PWA shell"
git push
```

> NOTE on `database_id`: it is an identifier for *your* D1 instance, not a secret credential — committing it in `wrangler.toml` is the standard Cloudflare pattern and safe. Real secrets stay in `.dev.vars` (gitignored) / `wrangler secret put`.

---

## Task 1: Recurrence date math (pure logic, TDD)

**Files:**
- Create: `src/recurrence.js`
- Test: `test/recurrence.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { nextOccurrence } from "../src/recurrence.js";

describe("nextOccurrence", () => {
  it("daily adds one day", () => {
    expect(nextOccurrence("2026-06-01T09:00:00", { kind: "daily", interval: 1 }))
      .toBe("2026-06-02T09:00:00");
  });
  it("every_n_days respects interval", () => {
    expect(nextOccurrence("2026-06-01T09:00:00", { kind: "every_n_days", interval: 3 }))
      .toBe("2026-06-04T09:00:00");
  });
  it("weekly adds seven days", () => {
    expect(nextOccurrence("2026-06-01T09:00:00", { kind: "weekly", interval: 1 }))
      .toBe("2026-06-08T09:00:00");
  });
  it("weekdays skips weekend (Fri -> Mon)", () => {
    // 2026-06-05 is a Friday
    expect(nextOccurrence("2026-06-05T09:00:00", { kind: "weekdays" }))
      .toBe("2026-06-08T09:00:00");
  });
  it("monthly adds one month", () => {
    expect(nextOccurrence("2026-06-15T09:00:00", { kind: "monthly", interval: 1 }))
      .toBe("2026-07-15T09:00:00");
  });
  it("returns null for null recurrence", () => {
    expect(nextOccurrence("2026-06-01T09:00:00", null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- recurrence`
Expected: FAIL — `nextOccurrence is not a function` / module not found.

- [ ] **Step 3: Implement `src/recurrence.js`**

```js
// Works on naive local-time ISO strings "YYYY-MM-DDTHH:mm:ss".
// Date math uses UTC accessors on a Date built from the string to avoid
// the host timezone shifting the calendar day.

function parse(iso) {
  const [d, t] = iso.split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m, s] = (t || "00:00:00").split(":").map(Number);
  return new Date(Date.UTC(Y, M - 1, D, h, m, s || 0));
}

function format(dt) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}` +
    `T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

export function nextOccurrence(iso, recurrence) {
  if (!recurrence || !recurrence.kind) return null;
  const dt = parse(iso);
  const interval = recurrence.interval || 1;
  switch (recurrence.kind) {
    case "daily":
      dt.setUTCDate(dt.getUTCDate() + interval);
      break;
    case "every_n_days":
      dt.setUTCDate(dt.getUTCDate() + interval);
      break;
    case "weekly":
      dt.setUTCDate(dt.getUTCDate() + 7 * interval);
      break;
    case "monthly":
      dt.setUTCMonth(dt.getUTCMonth() + interval);
      break;
    case "weekdays": {
      do {
        dt.setUTCDate(dt.getUTCDate() + 1);
      } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
      break;
    }
    default:
      return null;
  }
  return format(dt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- recurrence`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/recurrence.js test/recurrence.test.js
git commit -m "feat: recurrence next-occurrence date math"
git push
```

---

## Task 2: Claude cleanup + strict validation (TDD on the validator)

**Files:**
- Create: `src/claude.js`
- Test: `test/claude.test.js`

- [ ] **Step 1: Write the failing test** (tests the pure validator/fallback, not the network)

```js
import { describe, it, expect } from "vitest";
import { validateCleanup, fallbackCleanup } from "../src/claude.js";

describe("validateCleanup", () => {
  it("accepts a well-formed object", () => {
    const out = validateCleanup({
      title: "Call dentist", notes: null,
      due_at: "2026-06-02T00:00:00", reminder_at: "2026-06-02T14:00:00",
      recurrence: null,
    });
    expect(out.title).toBe("Call dentist");
    expect(out.reminder_at).toBe("2026-06-02T14:00:00");
  });
  it("coerces missing optional fields to null", () => {
    const out = validateCleanup({ title: "Buy milk" });
    expect(out).toEqual({ title: "Buy milk", notes: null, due_at: null, reminder_at: null, recurrence: null });
  });
  it("rejects when title missing", () => {
    expect(() => validateCleanup({ due_at: "2026-06-02T00:00:00" })).toThrow();
  });
  it("rejects a bad date string", () => {
    expect(() => validateCleanup({ title: "x", due_at: "next tuesday" })).toThrow();
  });
  it("rejects an unknown recurrence kind", () => {
    expect(() => validateCleanup({ title: "x", recurrence: { kind: "fortnightly" } })).toThrow();
  });
});

describe("fallbackCleanup", () => {
  it("uses raw text as title with no dates", () => {
    expect(fallbackCleanup("buy   milk later")).toEqual({
      title: "buy milk later", notes: null, due_at: null, reminder_at: null, recurrence: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- claude`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Implement `src/claude.js`**

```js
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const RECURRENCE_KINDS = new Set(["daily", "weekly", "monthly", "weekdays", "every_n_days"]);

function checkDate(v, field) {
  if (v == null) return null;
  if (typeof v !== "string" || !ISO_RE.test(v)) throw new Error(`bad ${field}`);
  return v;
}

export function validateCleanup(obj) {
  if (!obj || typeof obj.title !== "string" || !obj.title.trim()) {
    throw new Error("missing title");
  }
  let recurrence = null;
  if (obj.recurrence != null) {
    const r = obj.recurrence;
    if (!r.kind || !RECURRENCE_KINDS.has(r.kind)) throw new Error("bad recurrence kind");
    recurrence = { kind: r.kind, interval: Number(r.interval) || 1 };
    if (typeof r.weekday === "number") recurrence.weekday = r.weekday;
  }
  return {
    title: obj.title.trim(),
    notes: obj.notes != null ? String(obj.notes) : null,
    due_at: checkDate(obj.due_at, "due_at"),
    reminder_at: checkDate(obj.reminder_at, "reminder_at"),
    recurrence,
  };
}

export function fallbackCleanup(rawText) {
  return {
    title: rawText.trim().replace(/\s+/g, " "),
    notes: null, due_at: null, reminder_at: null, recurrence: null,
  };
}

const SYSTEM_PROMPT = `You convert a user's loose note into a single crisp todo.
Return ONLY a JSON object with keys: title, notes, due_at, reminder_at, recurrence.
- title: short imperative todo text.
- notes: extra detail or null.
- due_at / reminder_at: "YYYY-MM-DDTHH:mm:ss" in the user's local time, or null.
- recurrence: null, or {kind, interval, weekday?} where kind is one of
  daily, weekly, monthly, weekdays, every_n_days.
Resolve relative times against the provided "now" and timezone. No prose, JSON only.`;

export async function cleanupWithClaude(env, { rawText, now, timezone }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `now=${now} timezone=${timezone}\nNote: ${rawText}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no json in response");
  return validateCleanup(JSON.parse(match[0]));
}

// Convenience: never throws — falls back on any failure.
export async function cleanupOrFallback(env, args) {
  try {
    return await cleanupWithClaude(env, args);
  } catch {
    return fallbackCleanup(args.rawText);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- claude`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/claude.js test/claude.test.js
git commit -m "feat: Claude cleanup contract with strict validation + fallback"
git push
```

---

## Task 3: DB helpers + magic-link auth (TDD against Miniflare D1)

**Files:**
- Create: `src/db.js`, `src/email.js`, `src/auth.js`
- Test: `test/auth.test.js`

- [ ] **Step 1: Create `src/db.js`**

```js
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
```

- [ ] **Step 2: Create `src/email.js`** (provider-agnostic; logs in dev if no key)

```js
// Sends via an HTTP email API. EMAIL_API_KEY/EMAIL_FROM are secrets.
// If no key configured (local dev), logs the link so testing still works.
export async function sendMagicLink(env, email, link) {
  if (!env.EMAIL_API_KEY) {
    console.log(`[dev] magic link for ${email}: ${link}`);
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.EMAIL_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email,
      subject: "Your Brain Notes sign-in link",
      html: `<p>Click to sign in:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`,
    }),
  });
}
```

- [ ] **Step 3: Create `src/auth.js`**

```js
import { json, randomToken, serializeCookie } from "./util.js";
import { findOrCreateUser, createSession } from "./db.js";
import { sendMagicLink } from "./email.js";

const TOKEN_TTL_MS = 15 * 60 * 1000;

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
  const row = token && await env.DB.prepare(
    "SELECT * FROM login_tokens WHERE token = ? AND used = 0 AND expires_at > ?"
  ).bind(token, new Date().toISOString()).first();
  if (!row) return json({ error: "invalid or expired token" }, 400);
  await env.DB.prepare("UPDATE login_tokens SET used = 1 WHERE token = ?").bind(token).run();
  const user = await findOrCreateUser(env, row.email);
  const sessionId = await createSession(env, user.id);
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": serializeCookie("session", sessionId, { maxAge: 60 * 60 * 24 * 30 }),
    },
  });
}

export function logout() {
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": serializeCookie("session", "", { maxAge: 0 }) },
  });
}
```

- [ ] **Step 4: Write the failing test `test/auth.test.js`**

```js
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { requestLogin, verifyLogin } from "../src/auth.js";
import { getUserBySession } from "../src/db.js";

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
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `npm test -- auth`
Expected first: may FAIL if wiring incomplete. Fix until: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db.js src/email.js src/auth.js test/auth.test.js
git commit -m "feat: magic-link auth with sessions (TDD against D1)"
git push
```

---

## Task 4: Todo CRUD handlers (TDD against Miniflare D1)

**Files:**
- Create: `src/todos.js`
- Modify: `src/db.js` (add todo queries)
- Test: `test/todos.test.js`

- [ ] **Step 1: Add todo queries to `src/db.js`**

```js
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
```

- [ ] **Step 2: Create `src/todos.js`**

```js
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

  // Editable fields.
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
```

- [ ] **Step 3: Write the failing test `test/todos.test.js`**

```js
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { insertTodo, listTodos, getTodo } from "../src/db.js";
import { patchTodo } from "../src/todos.js";

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
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `npm test -- todos`
Expected first: FAIL. Fix wiring until: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/todos.js src/db.js test/todos.test.js
git commit -m "feat: todo CRUD with recurrence spawning on completion"
git push
```

---

## Task 5: Router wiring + auth gate

**Files:**
- Create: `src/router.js`
- Modify: `src/index.js`

- [ ] **Step 1: Create `src/router.js`**

```js
export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => routes.push({ method, pattern, handler });
  const api = { get: add("GET"), post: add("POST"), patch: add("PATCH"), delete: add("DELETE") };

  api.match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const keys = [];
      const rx = new RegExp("^" + r.pattern.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      }) + "$");
      const m = pathname.match(rx);
      if (m) {
        const params = {};
        keys.forEach((k, i) => (params[k] = m[i + 1]));
        return { handler: r.handler, params };
      }
    }
    return null;
  };
  return api;
}
```

- [ ] **Step 2: Rewrite `src/index.js` to wire everything**

```js
import { json, parseCookies } from "./util.js";
import { createRouter } from "./router.js";
import { getUserBySession } from "./db.js";
import { requestLogin, verifyLogin, logout } from "./auth.js";
import { createTodo, getTodos, patchTodo, removeTodo } from "./todos.js";
import { subscribePush, unsubscribePush, vapidPublicKey } from "./push.js";
import { sendDueReminders } from "./push.js";

const router = createRouter();
router.post("/api/auth/request", (req, env) => requestLogin(req, env));
router.get("/api/auth/verify", (req, env) => verifyLogin(req, env));
router.post("/api/auth/logout", () => logout());
router.get("/api/push/vapid-public-key", (req, env) => vapidPublicKey(req, env));

// Authenticated routes resolved via the `user` passed by the gate below.
const authed = {
  "POST /api/todos": createTodo,
  "GET /api/todos": getTodos,
  "POST /api/push/subscribe": subscribePush,
  "POST /api/push/unsubscribe": unsubscribePush,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/health") return json({ ok: true });

    if (pathname.startsWith("/api/")) {
      // Public matches first.
      const pub = router.match(request.method, pathname);
      if (pub) return pub.handler(request, env);

      // Everything else under /api requires a session.
      const user = await getUserBySession(env, parseCookies(request).session);
      if (!user) return json({ error: "unauthorized" }, 401);

      const key = `${request.method} ${pathname}`;
      if (authed[key]) return authed[key](request, env, user);

      // Param routes: /api/todos/:id
      const m = pathname.match(/^\/api\/todos\/([^/]+)$/);
      if (m) {
        if (request.method === "PATCH") return patchTodo(request, env, user, m[1]);
        if (request.method === "DELETE") return removeTodo(request, env, user, m[1]);
      }
      return json({ error: "not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
  },
};
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: all prior suites PASS. (push.js created next task; if import fails, proceed to Task 6 then re-run.)

- [ ] **Step 4: Commit**

```bash
git add src/router.js src/index.js
git commit -m "feat: wire API router with session auth gate"
git push
```

---

## Task 6: Web Push — subscribe + cron reminder delivery (TDD on the due-query)

**Files:**
- Create: `src/push.js`
- Test: `test/push.test.js`

- [ ] **Step 1: Create `src/push.js`**

```js
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { json } from "./util.js";

export async function vapidPublicKey(request, env) {
  return json({ key: env.VAPID_PUBLIC_KEY });
}

export async function subscribePush(request, env, user) {
  const { subscription } = await request.json().catch(() => ({}));
  if (!subscription?.endpoint) return json({ error: "bad subscription" }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString()).run();
  return json({ ok: true }, 201);
}

export async function unsubscribePush(request, env, user) {
  const { endpoint } = await request.json().catch(() => ({}));
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .bind(user.id, endpoint).run();
  return json({ ok: true });
}

// Selects todos whose reminder is due and not yet sent. Pure-ish: returns rows.
export async function selectDueReminders(env, nowIso) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todos
     WHERE reminder_at IS NOT NULL AND reminder_at <= ?
       AND reminder_sent_at IS NULL AND status = 'open'`
  ).bind(nowIso).all();
  return results;
}

async function sendToUser(env, userId, payload) {
  const { results: subs } = await env.DB.prepare(
    "SELECT * FROM push_subscriptions WHERE user_id = ?"
  ).bind(userId).all();
  for (const sub of subs) {
    try {
      const msg = await buildPushPayload(
        { data: JSON.stringify(payload), options: { ttl: 600 } },
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      );
      const res = await fetch(sub.endpoint, msg);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
      }
    } catch (e) {
      console.error("push send failed", e);
    }
  }
}

export async function sendDueReminders(env, nowIso = new Date().toISOString()) {
  const due = await selectDueReminders(env, nowIso);
  for (const todo of due) {
    await sendToUser(env, todo.user_id, { title: "Brain Notes", body: todo.title, todoId: todo.id });
    await env.DB.prepare("UPDATE todos SET reminder_sent_at = ? WHERE id = ?")
      .bind(nowIso, todo.id).run();
  }
  return due.length;
}
```

- [ ] **Step 2: Write the failing test `test/push.test.js`** (tests the due-selection + stamping, not real push network)

```js
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { selectDueReminders } from "../src/push.js";

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
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `npm test -- push`
Expected first: FAIL. Then: PASS (1 test).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add src/push.js test/push.test.js
git commit -m "feat: Web Push subscribe + cron-driven due-reminder delivery"
git push
```

---

## Task 7: Frontend — capture, list, status toggle, theming

**Files:**
- Modify: `public/index.html`
- Create: `public/app.js`, `public/styles.css`

- [ ] **Step 1: Replace `public/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0b0f" />
    <title>Brain Notes</title>
    <link rel="manifest" href="/manifest.json" />
    <link rel="stylesheet" href="/styles.css" />
    <script>
      // Apply theme before first paint to avoid flash.
      (function () {
        const t = localStorage.getItem("theme") || "system";
        const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.dataset.theme = dark ? "dark" : "light";
      })();
    </script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`** (minimal, theme tokens, sleek)

```css
:root {
  --bg: #ffffff; --surface: #f6f7f9; --text: #15161a; --muted: #6b7280;
  --border: #e5e7eb; --accent: #4f46e5; --accent-contrast: #ffffff;
  --radius: 14px; --shadow: 0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.04);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
}
[data-theme="dark"] {
  --bg: #0b0b0f; --surface: #16171d; --text: #e8e9ed; --muted: #9aa0ab;
  --border: #262833; --accent: #7c7cff; --accent-contrast: #0b0b0f;
  --shadow: 0 1px 3px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3);
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: var(--font); background: var(--bg); color: var(--text);
  -webkit-font-smoothing: antialiased; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
}
#app { max-width: 640px; margin: 0 auto; padding: 24px 16px 96px; }
h1 { font-size: 20px; font-weight: 650; letter-spacing: -.01em; margin: 8px 0 20px; }
.capture { display: flex; gap: 8px; margin-bottom: 24px; }
.capture textarea {
  flex: 1; resize: none; border: 1px solid var(--border); background: var(--surface);
  color: var(--text); border-radius: var(--radius); padding: 14px 16px; font: inherit;
  min-height: 52px; box-shadow: var(--shadow); outline: none;
}
.capture textarea:focus { border-color: var(--accent); }
button.primary {
  border: none; background: var(--accent); color: var(--accent-contrast);
  border-radius: var(--radius); padding: 0 18px; font: inherit; font-weight: 600; cursor: pointer;
}
.todo {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; margin-bottom: 10px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow); transition: opacity .25s, transform .25s;
}
.todo.done { opacity: .5; }
.todo .check {
  width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border);
  cursor: pointer; flex: none; margin-top: 1px; transition: background .2s, border-color .2s;
}
.todo.done .check { background: var(--accent); border-color: var(--accent); }
.todo .title { font-weight: 550; line-height: 1.3; }
.todo.done .title { text-decoration: line-through; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { font-size: 12px; color: var(--muted); background: var(--bg); border: 1px solid var(--border);
  border-radius: 999px; padding: 2px 8px; }
.section-label { font-size: 12px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted); margin: 24px 0 8px; }
.topbar { display: flex; justify-content: space-between; align-items: center; }
.iconbtn { background: none; border: 1px solid var(--border); color: var(--text);
  border-radius: 10px; padding: 6px 10px; cursor: pointer; font: inherit; font-size: 13px; }
.placeholder { opacity: .6; font-style: italic; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
```

- [ ] **Step 3: Create `public/app.js`** (SPA: login gate, capture, list, toggle, theme)

```js
const app = document.getElementById("app");
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localNow = () => new Date().toLocaleString("sv").replace(" ", "T").slice(0, 19);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    credentials: "same-origin", ...opts,
  });
  if (res.status === 401) { renderLogin(); throw new Error("unauthorized"); }
  return res;
}

function cycleTheme() {
  const order = ["system", "light", "dark"];
  const cur = localStorage.getItem("theme") || "system";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  localStorage.setItem("theme", next);
  const dark = next === "dark" || (next === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  return next;
}

function fmtChip(label) { return `<span class="chip">${label}</span>`; }

function todoChips(t) {
  const chips = [];
  if (t.reminder_at) chips.push(fmtChip("⏰ " + t.reminder_at.replace("T", " ").slice(0, 16)));
  else if (t.due_at) chips.push(fmtChip("📅 " + t.due_at.slice(0, 10)));
  if (t.recurrence) { try { chips.push(fmtChip("🔁 " + JSON.parse(t.recurrence).kind)); } catch {} }
  return chips.length ? `<div class="chips">${chips.join("")}</div>` : "";
}

function todoEl(t) {
  const el = document.createElement("div");
  el.className = "todo" + (t.status === "done" ? " done" : "");
  el.innerHTML = `<div class="check" role="button" aria-label="toggle"></div>
    <div style="flex:1"><div class="title">${escapeHtml(t.title)}</div>${todoChips(t)}</div>`;
  el.querySelector(".check").onclick = async () => {
    const status = t.status === "done" ? "open" : "done";
    await api(`/api/todos/${t.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    loadTodos();
  };
  return el;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadTodos() {
  const res = await api("/api/todos");
  const todos = await res.json();
  const open = todos.filter((t) => t.status === "open");
  const done = todos.filter((t) => t.status === "done");
  const list = document.getElementById("list");
  list.innerHTML = "";
  open.forEach((t) => list.appendChild(todoEl(t)));
  if (done.length) {
    const lbl = document.createElement("div");
    lbl.className = "section-label"; lbl.textContent = "Done";
    list.appendChild(lbl);
    done.forEach((t) => list.appendChild(todoEl(t)));
  }
}

async function submitCapture(text) {
  const list = document.getElementById("list");
  const ph = document.createElement("div");
  ph.className = "todo placeholder"; ph.innerHTML = `<div class="check"></div><div class="title">cleaning up…</div>`;
  list.prepend(ph);
  try {
    await api("/api/todos", { method: "POST", body: JSON.stringify({ raw_text: text, now: localNow(), timezone: tz }) });
  } finally { loadTodos(); }
}

function renderApp() {
  app.innerHTML = `
    <div class="topbar">
      <h1>Brain Notes</h1>
      <div>
        <button class="iconbtn" id="theme">Theme</button>
        <button class="iconbtn" id="logout">Sign out</button>
      </div>
    </div>
    <form class="capture" id="capture">
      <textarea id="raw" placeholder="Remind me to call the dentist next Tuesday afternoon…"></textarea>
      <button class="primary" type="submit">Add</button>
    </form>
    <div id="list"></div>`;
  document.getElementById("theme").onclick = () => cycleTheme();
  document.getElementById("logout").onclick = async () => {
    await api("/api/auth/logout", { method: "POST" }); renderLogin();
  };
  document.getElementById("capture").onsubmit = (e) => {
    e.preventDefault();
    const ta = document.getElementById("raw");
    const text = ta.value.trim();
    if (!text) return;
    ta.value = "";
    submitCapture(text);
  };
  loadTodos();
}

function renderLogin() {
  app.innerHTML = `
    <h1>Brain Notes</h1>
    <form class="capture" id="login">
      <input id="email" type="email" placeholder="you@example.com"
        style="flex:1;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;padding:14px 16px;font:inherit" />
      <button class="primary" type="submit">Send link</button>
    </form>
    <p id="msg" class="section-label"></p>`;
  document.getElementById("login").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    await fetch("/api/auth/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    document.getElementById("msg").textContent = "Check your email for a sign-in link.";
  };
}

// Boot: if /api/todos returns 401, show login; else app.
(async () => {
  try {
    const res = await fetch("/api/todos", { credentials: "same-origin" });
    if (res.status === 401) renderLogin();
    else renderApp();
  } catch { renderLogin(); }
})();
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. Open `localhost:8787`. Enter an email → terminal logs a magic link (dev mode). Open the link → redirected to app. Type "call the dentist next tuesday afternoon", click Add → a cleaned todo appears (requires `ANTHROPIC_API_KEY` in `.dev.vars`; without it, fallback shows raw text). Toggle the checkbox → moves to Done. Click Theme → cycles system/light/dark.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: PWA frontend — capture, list, status toggle, theming"
git push
```

---

## Task 8: PWA manifest + service worker (offline shell + push handler)

**Files:**
- Create: `public/manifest.json`, `public/sw.js`, `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Modify: `public/app.js` (register SW + push enable flow)

- [ ] **Step 1: Create `public/manifest.json`**

```json
{
  "name": "Brain Notes",
  "short_name": "Brain Notes",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0b0f",
  "theme_color": "#0b0b0f",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Generate placeholder icons**

Run:
```bash
mkdir -p public/icons
# Solid-color PNG placeholders; replace with real art later.
printf '' # if ImageMagick available:
which magick && magick -size 512x512 xc:#4f46e5 public/icons/icon-512.png && magick -size 192x192 xc:#4f46e5 public/icons/icon-192.png || echo "No ImageMagick — create two PNGs manually (192 and 512) before deploy."
```
Expected: two PNGs exist in `public/icons/`. (If no ImageMagick, drop any two square PNGs in.)

- [ ] **Step 3: Create `public/sw.js`**

```js
const CACHE = "brain-notes-v1";
const SHELL = ["/", "/index.html", "/app.js", "/styles.css", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // never cache API
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
self.addEventListener("push", (e) => {
  let data = { title: "Brain Notes", body: "" };
  try { data = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(data.title || "Brain Notes", {
    body: data.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data,
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow("/"));
});
```

- [ ] **Step 4: Add SW registration + push-enable flow to `public/app.js`** (append before the boot IIFE)

```js
async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

async function enablePush() {
  if (isIOS() && !isStandalone()) {
    alert("To get reminders on iPhone, tap Share → Add to Home Screen, then open Brain Notes from your home screen and enable notifications.");
    return;
  }
  const reg = await registerSW();
  if (!reg) return alert("Notifications not supported on this browser.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return;
  const keyRes = await fetch("/api/push/vapid-public-key", { credentials: "same-origin" });
  const { key } = await keyRes.json();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await fetch("/api/push/subscribe", {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  alert("Reminders enabled.");
}
```

- [ ] **Step 5: Add an "Enable reminders" button to the topbar in `renderApp()`**

In `public/app.js`, inside `renderApp()`'s template, change the topbar buttons block to include a notifications button, and wire it:

Replace:
```js
        <button class="iconbtn" id="theme">Theme</button>
        <button class="iconbtn" id="logout">Sign out</button>
```
with:
```js
        <button class="iconbtn" id="notify">Reminders</button>
        <button class="iconbtn" id="theme">Theme</button>
        <button class="iconbtn" id="logout">Sign out</button>
```
and after the `theme` onclick wiring add:
```js
  document.getElementById("notify").onclick = () => enablePush();
```
Also register the SW on app boot — at the end of `renderApp()` add:
```js
  registerSW();
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Confirm `/sw.js`, `/manifest.json`, `/icons/icon-192.png` all load (200). In a desktop Chrome, click Reminders → permission prompt → "Reminders enabled". (Full iOS push requires deploy + home-screen install — see Task 9.)

- [ ] **Step 7: Commit**

```bash
git add public/manifest.json public/sw.js public/icons public/app.js
git commit -m "feat: PWA manifest + service worker with offline shell and push"
git push
```

---

## Task 9: Secrets, deploy, and production verification

**Files:** none (operational). Produces a deployed app.

- [ ] **Step 1: Generate VAPID keys**

Run:
```bash
node -e "const c=require('crypto');const {publicKey,privateKey}=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({type:'spki',format:'der'});const priv=privateKey.export({type:'pkcs8',format:'der'});const b64u=b=>b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');console.log('VAPID_PUBLIC_KEY=',b64u(pub.slice(-65)));console.log('VAPID_PRIVATE_KEY=',b64u(priv.slice(-32)));"
```
Expected: prints a public (87-char) and private key. Keep them OUT of git.

> If `@block65/webcrypto-web-push` expects a specific key format, follow its README to generate keys instead — the package README is the source of truth. Adjust this step to match.

- [ ] **Step 2: Set production secrets**

Run each (paste value when prompted):
```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler secret put EMAIL_API_KEY
npx wrangler secret put EMAIL_FROM
```
Expected: each confirms "Successfully created secret".

- [ ] **Step 3: Set production `APP_URL`**

Edit `wrangler.toml` `[vars] APP_URL` to the deployed Worker URL (known after first deploy; can deploy once, read the URL, update, redeploy). Commit the non-secret change.

- [ ] **Step 4: Initialize the remote D1 schema**

Run: `npm run db:init:remote`
Expected: tables created on the remote D1.

- [ ] **Step 5: Deploy**

Run: `npm run deploy`
Expected: prints the live `*.workers.dev` URL.

- [ ] **Step 6: Production smoke test**

- Open the URL → login screen.
- Request a magic link → (with real EMAIL key) email arrives; click → app loads.
- Add "water the plants every other day at 6pm" → todo cleaned with 🔁 + ⏰ chips.
- Toggle done → next instance appears.
- On iPhone: Add to Home Screen → open → Reminders → grant → set a todo's reminder ~2 min out → confirm push fires (cron runs each minute).

- [ ] **Step 7: Commit any config changes**

```bash
git add wrangler.toml
git commit -m "chore: production APP_URL"
git push
```

- [ ] **Step 8: Update README**

Create `README.md` documenting setup (npm install, d1 create, db:init, .dev.vars from example, secrets list, dev, deploy). Then:
```bash
git add README.md
git commit -m "docs: setup and deploy instructions"
git push
```

---

## Self-Review Notes

- **Spec coverage:** fuzzy→crisp (Task 2), reminders/push (Tasks 6, 8, 9), sync (server-backed CRUD, Tasks 4–5), dark/light/system (Task 7), status change (Task 4 PATCH + Task 7 toggle), recurring (Tasks 1, 4), magic-link auth (Task 3), minimal/sleek UI (Task 7), secrets safety (Task 0 + 9). All covered.
- **Type consistency:** the cleaned-todo shape `{title, notes, due_at, reminder_at, recurrence}` is identical across `claude.js`, `db.insertTodo`, and `todos.js`. `nextOccurrence(iso, recurrence)` signature consistent across recurrence + todos. `selectDueReminders(env, nowIso)` consistent.
- **iOS push caveat** surfaced in UI (Task 8 `enablePush`) per spec.
- **Secrets:** never written to tracked files; `.dev.vars.example` documents names only; `database_id` clarified as non-secret.
