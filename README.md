# Brain Notes

A natural-language todo PWA. Jot a thought as a loose sentence; Claude cleans it
into a crisp todo and extracts the due date, reminder time, and recurrence.
Todos sync across devices, fire Web Push reminders, recur, and toggle done —
wrapped in a deliberate light/dark interface.

Built as a single **Cloudflare Worker** that serves a vanilla-JS PWA and a JSON
API, backed by **D1** (SQLite). A per-minute **Cron Trigger** delivers due
reminders. Text cleanup runs through the **Claude API**.

## Stack

- Cloudflare Workers + D1 + Wrangler
- Vanilla JS PWA, hand-written CSS, service worker (no build step)
- Web Push (VAPID) via `@block65/webcrypto-web-push`
- Magic-link auth (passwordless), email via Resend
- Claude API (Anthropic Messages) for the fuzzy-text → todo cleanup
- Tests: Vitest (+ `@cloudflare/vitest-pool-workers` / Miniflare)

## Project layout

```
src/
  index.js       Worker entry: router + auth gate + scheduled() cron
  router.js      tiny path/method router
  auth.js        magic-link request/verify, sessions
  db.js          D1 helpers (users, sessions, todos)
  email.js       magic-link email (Resend; logs the link in dev)
  claude.js      Claude cleanup + strict validation + safe fallback
  recurrence.js  next-occurrence date math (pure)
  todos.js       todo CRUD + recurrence spawning
  push.js        Web Push subscribe/unsubscribe + cron due-reminder delivery
  util.js        json(), cookies, random tokens
public/          the PWA (index.html, app.js, styles.css, sw.js, manifest, icons)
test/
  unit/          pure-logic tests (plain vitest)
  workers/       D1/Worker-bound tests (pool-workers via a space-free mirror)
schema.sql       D1 tables
```

## Local setup

```bash
npm install

# Create the D1 database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create brain_notes

# Load the schema into the LOCAL D1 (used by `wrangler dev`)
npm run db:init

# Secrets for local dev: copy the example and fill in what you have.
cp .dev.vars.example .dev.vars   # .dev.vars is gitignored — never commit it
```

`.dev.vars` keys:

| Key | What it's for | Needed for local dev? |
|-----|---------------|------------------------|
| `ANTHROPIC_API_KEY` | Claude cleanup. Without it, the app falls back to storing your raw text as the title (no date/recurrence extraction). | Optional |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push signing. | Optional (push won't fire) |
| `EMAIL_API_KEY` / `EMAIL_FROM` | Resend, for magic-link emails. Without `EMAIL_API_KEY` the sign-in link is printed to the dev console instead of emailed. | Optional |

Run it:

```bash
npm run dev          # http://localhost:8787
```

To sign in locally without email configured: submit your email, then copy the
`http://localhost:8787/api/auth/verify?token=...` line from the `wrangler dev`
console and open it.

## Tests

```bash
npm test             # runs both suites
npm run test:unit    # pure-logic tests only
npm run test:workers # D1/Worker-bound tests only
```

> Note: the Cloudflare test pool (workerd) can't resolve module paths that
> contain a space, and this project's path does. `test:workers` therefore mirrors
> the repo into a space-free temp dir with its own `node_modules` and runs there
> (see `scripts/test-workers.sh`). `test:unit` runs in place.

## Deploy

```bash
# 1. Ensure wrangler.toml has a real database_id (from `d1 create` above).

# 2. Set production secrets (each prompts for the value):
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT      # e.g. mailto:you@example.com
npx wrangler secret put EMAIL_API_KEY      # Resend API key
npx wrangler secret put EMAIL_FROM         # e.g. "Brain Notes <noreply@yourdomain>"
npx wrangler secret put APP_URL            # your prod origin, e.g. https://brain-notes.<you>.workers.dev

# 3. Load the schema into the REMOTE D1:
npm run db:init:remote

# 4. Deploy:
npm run deploy
```

### Generating VAPID keys

Web Push needs a VAPID keypair. Follow the
[`@block65/webcrypto-web-push`](https://www.npmjs.com/package/@block65/webcrypto-web-push)
README to generate keys in the format it expects, then set them as the three
`VAPID_*` secrets above. The browser fetches the public key from
`/api/push/vapid-public-key` when a user enables reminders.

### iOS reminders

Web Push on iOS only works for a PWA added to the Home Screen (iOS 16.4+). The
"Reminders" button detects iOS-not-installed and prompts "Add to Home Screen"
rather than failing silently. After installing, open Brain Notes from the Home
Screen and tap Reminders to subscribe.

## Security notes

- Secrets live in `.dev.vars` (gitignored) and Cloudflare Worker secrets — never
  in committed files. Only `.dev.vars.example` (placeholder names) is tracked.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (off only on
  localhost). Logout invalidates the session row server-side.
- Magic-link tokens are single-use and expire in 15 minutes. Sign-in never
  reveals whether an email exists.
