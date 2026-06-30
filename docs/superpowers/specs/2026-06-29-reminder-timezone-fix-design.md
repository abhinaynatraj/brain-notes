# Reminder Timezone Fix — Design Spec

**Date:** 2026-06-29
**Status:** Approved (design), pending implementation plan

## Problem

Reminders fire at the wrong time — about 4 hours early for a Toronto (UTC−4)
user. A reminder set for "12:00 today" pushes at ~08:00 local.

**Root cause:** reminder/due times are stored as **naive local-time strings**
(e.g. `2026-06-29T12:00:00`, meaning noon in the user's timezone), but the cron
compares them against a **UTC** `now`:

```js
// src/push.js
export async function sendDueReminders(env, nowIso = new Date().toISOString()) { ... }
// selectDueReminders: WHERE reminder_at <= ?   // ? is UTC, reminder_at is naive-local
```

At 08:00 Toronto (= 12:00 UTC), `"2026-06-29T12:00:00" <= "2026-06-29T12:00:00.000Z"`
is true, so a noon-local reminder fires at 8am. The offset equals the user's UTC
offset.

The app already receives the user's IANA timezone at create time
(`body.timezone`, e.g. `America/Toronto`) and forwards it to Claude, but never
stores it, so the cron cannot interpret stored times.

## Decision

**Store reminder/due times as true UTC instants.** One source of truth. The
cron compares UTC-to-UTC. The frontend converts UTC → the browser's local time
for display and for the Today view's date bucketing.

## Goals

1. Convert each extracted `reminder_at`/`due_at` (naive local + the user's
   timezone) into a UTC ISO instant **at creation time**, and store that.
2. Cron compares stored UTC `reminder_at` against UTC `now` — no offset error.
3. Frontend displays times in the viewer's local timezone (chips + Today
   bucketing), converting from the stored UTC.
4. `PATCH` of `due_at`/`reminder_at` accepts and stores UTC, consistently.
5. DST-correct: conversions must use real timezone rules, not a fixed offset.

## Non-Goals

- No per-todo or per-user stored timezone column (we convert to UTC up front,
  so the stored value is timezone-independent).
- No retroactive migration of existing todos (the user has a handful; they will
  be deleted/re-added, see "Existing data" below).
- No change to how Claude extracts times (it still returns naive local; the
  Worker converts its output).

## Storage contract (the core change)

**Before:** `reminder_at` / `due_at` stored as naive local `YYYY-MM-DDTHH:mm:ss`.

**After:** `reminder_at` / `due_at` stored as UTC ISO with a `Z` suffix,
`YYYY-MM-DDTHH:mm:ssZ` (or full `…sssZ`). Null stays null.

This makes the stored value a real instant. Everything else follows from it.

## Components

### 1. Local-naive + IANA tz → UTC (Worker, pure, unit-tested) — `src/tz.js`

`localToUtc(naiveLocalIso, timeZone)` → UTC ISO string (or null for null input).

- Input: `"2026-06-29T12:00:00"` + `"America/Toronto"`.
- Output: `"2026-06-29T16:00:00.000Z"`.
- Algorithm (offset via `Intl`, DST-correct): compute the timezone's offset for
  that wall-clock instant using `Intl.DateTimeFormat(..., { timeZone })` parts,
  derive the UTC epoch, return `new Date(epoch).toISOString()`.
- Implementation approach: format the candidate UTC date into the target tz and
  measure the difference to recover the offset (standard "get timezone offset
  for a date" technique), applied so the resulting UTC, when rendered in
  `timeZone`, reproduces the input wall-clock time. Handles DST because the
  offset is computed for that specific date.
- Invalid/empty timezone → treat as UTC (offset 0); invalid input → return the
  input unchanged is NOT acceptable — return null only for null/empty, otherwise
  best-effort parse. (Edge handling pinned in the plan's tests.)

This is the one piece with real subtlety; it gets thorough unit tests including
a DST-summer date and a winter date for the same zone, plus a UTC passthrough.

### 2. createTodo converts before storing — `src/todos.js`

After `cleanupOrFallback` returns `{title, notes, due_at, reminder_at, recurrence}`
(naive local), convert `due_at` and `reminder_at` via `localToUtc(..., timezone)`
before `insertTodo`. `timezone` is already in scope (`body.timezone || "UTC"`).

### 3. patchTodo converts client-supplied dates — `src/todos.js`

The PATCH path currently validates `due_at`/`reminder_at` as naive ISO and
stores them raw. Change the contract so the **client sends UTC** (with `Z`) for
edits, OR sends naive-local + timezone and the Worker converts. Decision: the
frontend will send **UTC ISO** directly on PATCH (it already has the instant),
so patchTodo validates an ISO-8601 UTC string and stores it. Validation regex
updated to accept the trailing `Z` (and optional milliseconds).

### 4. recurrence next-instance stays correct — `src/recurrence.js`

`nextOccurrence` does calendar math on an ISO string and re-formats. It must
keep producing a UTC instant when given a UTC instant. Since the stored value is
now UTC and `nextOccurrence` already uses UTC accessors internally, feeding it a
`…Z` string and appending `Z` on output keeps it consistent. Verified by a test
that a daily UTC reminder advances by exactly 24h and stays UTC.

### 5. Frontend display in local time — `public/app.js` + `public/today.js`

- `fmtWhen(iso)` currently parses a naive string. Change it to parse the stored
  UTC instant (`new Date(iso)`, which honors the `Z`) and format in the
  browser's local timezone (hours/minutes/day from the local Date getters).
  "Today" is decided by comparing the instant's **local** date to the local
  today.
- Today bucketing (`public/today.js`): `bucketForToday` currently compares naive
  date-string prefixes. Change to compare the **local calendar date** of the UTC
  instant against the local today. So `buildToday` and `bucketForToday` take UTC
  instants and a "now" instant and bucket by local date. This keeps overdue /
  today correct for the viewer's timezone.
- The `now`/`timezone` the frontend sends on create are unchanged (Claude still
  needs them); only display/bucketing parse UTC now.

### 6. PATCH from the frontend sends UTC

Where the app sends `reminder_at`/`due_at` edits, it sends a UTC ISO string.
(Today the app does not expose date editing in the UI beyond status toggles, so
this is mostly forward-looking; the contract is fixed now to avoid re-introducing
the bug when editing is added.)

## Data Flow (after fix)

1. Create: browser sends `raw_text`, local `now`, `timezone`. Claude returns
   naive-local `reminder_at`. Worker converts → UTC, stores UTC.
2. Cron: compares stored UTC `reminder_at` ≤ UTC `now`. Fires at the correct
   instant.
3. List/Today: browser receives UTC instants, renders them in local time, and
   buckets Today by local date.

## Error Handling

- `localToUtc(null|"", tz)` → null. Unknown `tz` → UTC (offset 0), logged once.
- A todo whose stored `reminder_at` fails to parse as a date is treated as
  undated for bucketing (excluded) rather than throwing.
- No new network failure modes.

## Testing

- `src/tz.js` (`test/unit/tz.test.js`, plain vitest): localToUtc for
  America/Toronto summer (EDT, −4) and winter (EST, −5) — same wall time maps to
  different UTC; UTC input passthrough; null/empty → null; a UTC timezone input.
- `src/recurrence.js`: a UTC reminder advances correctly and stays UTC (extend
  existing recurrence tests).
- `public/today.js`: bucketing by **local** date from a UTC instant — a UTC
  instant that is "yesterday/today/tomorrow" in the viewer's local tz buckets
  correctly. (Tests run with a fixed `now` instant and assert against local-date
  logic; to stay deterministic, the test injects `now` and uses instants whose
  local-vs-UTC date difference is unambiguous.)
- Cron correctness is structural (UTC ≤ UTC) and covered by the existing
  push due-selection test, re-pointed at UTC strings.
- Manual: create a reminder a few minutes out, confirm the push arrives at the
  right local minute (not hours early).

## Existing data

The few existing todos store naive-local times as if UTC. After this change
they will be interpreted as UTC instants and render ~4h shifted. Simplest
remedy: delete and re-add them. No migration script (YAGNI for a single user
with a handful of items). This is called out so it isn't a surprise.

## Files

- Create: `src/tz.js`, `test/unit/tz.test.js`.
- Modify: `src/todos.js` (convert on create + patch validation/UTC),
  `public/app.js` (`fmtWhen` local rendering + PATCH sends UTC),
  `public/today.js` (bucket by local date of a UTC instant),
  `test/unit/today.test.js` (update for UTC instants),
  `test/workers/push.test.js` (UTC strings),
  `test/unit/recurrence.test.js` (UTC stays UTC),
  `public/sw.js` (cache bump so updated modules ship).

## Build Order (high level — detailed plan to follow)

1. `src/tz.js` localToUtc + DST tests (TDD).
2. createTodo + patchTodo store UTC; update push test to UTC.
3. Frontend: `fmtWhen` local rendering + `today.js` local-date bucketing; update
   their tests; SW cache bump.
4. Recurrence UTC consistency check.
5. Deploy; delete/re-add existing todos; verify a real reminder fires on time.
