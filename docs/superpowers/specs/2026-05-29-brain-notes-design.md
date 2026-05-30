# Brain Notes — Design Spec

**Date:** 2026-05-29
**Status:** Approved (design), pending implementation plan

## Summary

Brain Notes is a personal **Todo / notes PWA** where the user captures todos as
loose natural-language sentences. A Claude API call cleans each sentence into a
crisp todo and extracts structured metadata (due date, reminder time,
recurrence). Todos sync across devices via a Cloudflare Worker + D1 backend,
support push-notification reminders, recurring todos, status changes, and a
deliberate dark/light theme.

## Goals (v1)

1. **Fuzzy text → crisp todo** — type a sentence; Claude returns a cleaned title
   plus extracted `due_at`, `reminder_at`, and `recurrence`.
2. **Reminders via Web Push** (push only for v1; email used for login only).
3. **Sync across devices** via a shared backend.
4. **Dark / light / system themes**, each designed deliberately.
5. **Status changes** — toggle open ⇄ done.
6. **Recurring todos** — Claude infers recurrence from natural language; backed
   by simple presets.

## Non-Goals (v1)

- Email reminder delivery (login email only; push handles reminders).
- Full iCal RRULE flexibility (presets + every-N-days only).
- Native iOS app (PWA installed to home screen instead).
- Collaboration / sharing of todos between users.

## Platform & Stack

- **Frontend:** Vanilla JS PWA (HTML/CSS/JS + service worker). No build step.
  Hand-written CSS with custom properties for theming. Served as static assets
  by the Worker.
- **Backend:** Single Cloudflare Worker (static asset serving + JSON API +
  cron). **D1** (SQLite) for storage.
- **AI:** Claude API, key held in a Worker secret. Prompt-cached system prompt.
- **Auth:** Email magic link (multi-user capable, passwordless).
- **Reminders:** Web Push (VAPID), triggered by a Cron Trigger (every minute).

## Visual Direction

Modern, sleek, minimal. Flexible principle, not rigid spec:

- Minimal & uncluttered — generous whitespace, one clear primary action (the
  capture box), content-first, chrome recedes.
- Sleek typography — clean variable/system sans (e.g. Inter or system stack),
  tight type scale, strong title/metadata hierarchy.
- Soft modern surfaces — subtle rounded corners, gentle shadows/borders over
  heavy lines, calm neutral palette with one restrained accent.
- Both light and dark themes designed deliberately (not just inverted).
- Fluid micro-interactions — smooth status toggle, satisfying "cleaning up…" →
  cleaned-todo transition, done items fade/slide. Respect
  `prefers-reduced-motion`.
- Mobile-first, thumb-friendly — designed for the iPhone PWA first, scales up to
  desktop cleanly.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  PWA (vanilla JS + service worker)                   │
│  • Capture box → POST /api/todos                     │
│  • Todo list (status toggle, edit, delete)           │
│  • Settings (theme, push enable, account)            │
│  • Service worker: receives push, offline shell      │
└───────────────┬─────────────────────────────────────┘
                │ HTTPS (httpOnly session cookie)
┌───────────────▼─────────────────────────────────────┐
│  Cloudflare Worker                                   │
│  • Static asset serving (the PWA)                    │
│  • /api/auth/*   magic-link login                    │
│  • /api/todos/*  CRUD + AI cleanup on create         │
│  • /api/push/*   subscribe / unsubscribe             │
│  • Calls Claude API (key in Worker secret)           │
│  • Cron (every minute) → send due Web Push           │
└───────────────┬───────────────┬─────────────────────┘
                │               │
          ┌─────▼─────┐   ┌─────▼──────┐
          │  D1 (SQL) │   │ Claude API │
          └───────────┘   └────────────┘
```

The Claude cleanup is the heart of the create flow: raw sentence in → Claude
returns `{ title, notes, due_at, reminder_at, recurrence }` → stored as a todo.
One call does title cleanup, date extraction, and recurrence inference.

## Data Model (D1)

**`users`** — `id`, `email` (unique), `created_at`.

**`login_tokens`** — `token`, `email`, `expires_at`, `used`. Backs the emailed
magic link (short-lived, single-use).

**`sessions`** — `id` (random token in httpOnly cookie), `user_id`,
`expires_at`.

**`todos`**
- `id`, `user_id`
- `raw_text` (what the user typed), `title` (Claude-cleaned), `notes` (optional
  longer detail Claude pulled out)
- `status` (`open` / `done`), `completed_at`
- `due_at` (nullable), `reminder_at` (nullable — when to push)
- `recurrence` (nullable JSON, e.g.
  `{ "kind": "weekly", "interval": 1, "weekday": 2 }`; kinds: `daily`,
  `weekly`, `monthly`, `weekdays`, `every_n_days`)
- `reminder_sent_at` (prevents cron double-fire)
- `created_at`, `updated_at`

**`push_subscriptions`** — `id`, `user_id`, `endpoint`, `p256dh`, `auth`,
`created_at`. One row per device/browser that enabled push.

**Recurrence behavior:** marking a recurring todo `done` computes the next
`due_at`/`reminder_at` from the rule and inserts a fresh `open` todo. The
completed one stays in history.

## API

### Auth
- `POST /api/auth/request` `{ email }` → create `login_tokens` row, email magic
  link. Always returns 200 (no account enumeration).
- `GET /api/auth/verify?token=…` → validate token, create session, set httpOnly
  cookie, redirect to app.
- `POST /api/auth/logout` → delete session.
- All `/api/todos/*` and `/api/push/*` require a valid session cookie.

### Todos
- `POST /api/todos` `{ raw_text }` → call Claude, store cleaned todo, return it.
- `GET /api/todos` → user's todos (open first, then recently done).
- `PATCH /api/todos/:id` → edit fields or toggle `status`. Toggling a recurring
  todo to `done` triggers next-instance creation.
- `DELETE /api/todos/:id`.

### Push
- `POST /api/push/subscribe` `{ subscription }` → store row.
- `POST /api/push/unsubscribe`.
- `GET /api/push/vapid-public-key` → public key for browser subscribe.

## Claude Cleanup Contract

The Worker sends `raw_text` plus current date/time and the user's timezone, and
instructs Claude to return **only** this JSON:

```json
{
  "title": "Call the dentist",
  "notes": null,
  "due_at": "2026-06-02T00:00:00",
  "reminder_at": "2026-06-02T14:00:00",
  "recurrence": null
}
```

- Times resolved against the user's timezone (sent from the browser).
- `recurrence` is `null` or a preset-style object (see data model).
- The Worker **validates** Claude's response against a strict schema. If Claude
  returns anything malformed, it falls back to storing the raw text as the title
  with no dates — todo creation never blocks on an AI hiccup.
- System prompt is prompt-cached to reduce cost/latency.

## Frontend

**Screens (single-page):**
- **Capture** — large text box + one button. On submit: optimistic
  "cleaning up…" placeholder → replaced by the cleaned todo on return.
- **List** — open todos first (sorted by `due_at`), collapsed "Done" section
  below. Row: checkbox (toggle status), title, due/reminder chips, recurrence
  icon, edit/delete.
- **Settings** — theme toggle, "Enable notifications" button (push subscribe +
  install prompt), account/email + logout.
- **Login** — email box → "check your email" state.

**Dark/light mode:** CSS custom properties + `data-theme` on `<html>`. Three
states: light, dark, system (`prefers-color-scheme`). Saved to `localStorage`,
applied before first paint to avoid flash.

**PWA mechanics:**
- `manifest.json` (name, icons, theme color, `display: standalone`) for
  home-screen install.
- **Service worker:** (1) caches app shell for offline load; (2) listens for
  `push` events and shows the notification; clicking focuses/opens the relevant
  todo.
- **iOS reality check, surfaced in UI:** Web Push only works after the PWA is
  added to the home screen (iOS 16.4+). The "Enable notifications" flow detects
  iOS-not-installed and shows "Add to Home Screen" instructions instead of
  silently failing.

## Reminder Delivery (Cron)

Every minute the Worker queries todos where
`reminder_at <= now AND reminder_sent_at IS NULL AND status = 'open'`, sends Web
Push to that user's subscriptions, and stamps `reminder_sent_at`. Dead
subscriptions (HTTP 410) are pruned.

## Error Handling

- Claude failure → fallback to raw title, no dates (above).
- Push send failure → logged, dead subs pruned, cron never crashes.
- Offline submit → queued in the service worker, retried when back online.
- Expired session → redirect to login.

## Security / Secrets

Never committed; held in Worker secrets (`wrangler secret put`):
- Claude API key
- Magic-link signing secret
- VAPID public/private keys

`.gitignore` covers `.dev.vars`, `.env*`, `*.pem`, `*.key`, `vapid*.json`,
`.wrangler/`, `node_modules/` from commit #1. Session cookies are httpOnly,
Secure, SameSite=Lax.

## Testing

Worker logic unit-tested with Vitest + Miniflare (local D1). Highest-value
tests:
- Claude-response schema validation + fallback path.
- Recurrence next-date math (all preset kinds, timezone-aware).
- Cron due-query selection and `reminder_sent_at` stamping.
- Auth token lifecycle (single-use, expiry).

Frontend kept thin enough to verify manually.

## Build Order (high level — detailed plan to follow)

1. Worker scaffold + D1 schema + static asset serving + `.gitignore`.
2. Magic-link auth.
3. Todo CRUD + Claude cleanup contract + fallback.
4. Frontend: capture + list + status toggle + theming.
5. Web Push: subscribe flow + cron reminder delivery.
6. Recurrence next-instance logic.
7. Polish: micro-interactions, offline queue, iOS install UX.
