# Reminder Timezone Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reminders firing ~4h early by storing reminder/due times as true UTC instants, comparing UTC-to-UTC in the cron, and rendering/bucketing in the viewer's local time.

**Architecture:** Add a DST-correct `localToUtc` helper (`src/tz.js`). Convert Claude's naive-local times to UTC at create time before storing. The cron already uses UTC `now`, so UTC-stored times compare correctly. The browser parses stored UTC instants and renders/buckets them in its local timezone.

**Tech Stack:** Cloudflare Worker (JS, `Intl` for timezone math), vanilla-JS PWA, Vitest.

## Global Constraints

- Project path contains a space → unit tests run via `npm run test:unit` (plain vitest); Worker/D1 tests via `npm run test:workers`. `npm test` runs both.
- Stored reminder/due times become UTC ISO with a `Z` suffix (e.g. `2026-06-29T16:00:00.000Z`). Null stays null.
- `src/tz.js` is a Worker module (imported by `src/todos.js`); `public/today.js` is a browser module (imported by `public/app.js`). Keep each in plain ESM compatible with its runtime.
- Timezone conversions must be DST-correct (use `Intl`, not a fixed offset).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: `localToUtc` timezone conversion (Worker, pure, TDD)

**Files:**
- Create: `src/tz.js`
- Test: `test/unit/tz.test.js`

**Interfaces:**
- Produces: `localToUtc(naiveLocalIso, timeZone)` → UTC ISO string (`…Z`), or `null` if input is null/empty. Converts a naive wall-clock time interpreted in `timeZone` to the equivalent UTC instant. Unknown/empty `timeZone` → treat as UTC.

- [ ] **Step 1: Write the failing test `test/unit/tz.test.js`**

```js
import { describe, it, expect } from "vitest";
import { localToUtc } from "../../src/tz.js";

describe("localToUtc", () => {
  it("returns null for null/empty input", () => {
    expect(localToUtc(null, "America/Toronto")).toBeNull();
    expect(localToUtc("", "America/Toronto")).toBeNull();
  });

  it("converts Toronto summer (EDT, UTC-4) wall time to UTC", () => {
    // 2026-06-29 is EDT. Noon local = 16:00 UTC.
    expect(localToUtc("2026-06-29T12:00:00", "America/Toronto")).toBe("2026-06-29T16:00:00.000Z");
  });

  it("converts Toronto winter (EST, UTC-5) wall time to UTC", () => {
    // 2026-01-15 is EST. Noon local = 17:00 UTC.
    expect(localToUtc("2026-01-15T12:00:00", "America/Toronto")).toBe("2026-01-15T17:00:00.000Z");
  });

  it("treats a UTC timezone as no offset", () => {
    expect(localToUtc("2026-06-29T12:00:00", "UTC")).toBe("2026-06-29T12:00:00.000Z");
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(localToUtc("2026-06-29T12:00:00", "Not/AZone")).toBe("2026-06-29T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- tz`
Expected: FAIL — cannot resolve `../../src/tz.js`.

- [ ] **Step 3: Implement `src/tz.js`**

```js
// Convert a naive local wall-clock ISO ("YYYY-MM-DDTHH:mm:ss") interpreted in
// `timeZone` into the equivalent UTC instant ("…Z"). DST-correct: the offset is
// computed for that specific date via Intl.

// Returns the offset (minutes) of `timeZone` at the given UTC instant.
function tzOffsetMinutes(utcDate, timeZone) {
  // Format the UTC instant as wall-clock time in the target zone, then diff.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(utcDate);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second)
  );
  // asUTC is the wall-clock time treated as if UTC; the difference from the real
  // instant is the zone's offset at that moment.
  return Math.round((asUTC - utcDate.getTime()) / 60000);
}

export function localToUtc(naiveLocalIso, timeZone) {
  if (!naiveLocalIso) return null;

  // Validate the timezone; fall back to UTC if unknown.
  let zone = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }

  // Parse the naive wall-clock components.
  const [d, t = "00:00:00"] = naiveLocalIso.split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m, s = 0] = t.split(":").map(Number);

  // First guess: treat the wall time as if it were UTC.
  const guess = Date.UTC(Y, M - 1, D, h, m, s);
  // Offset at that guessed instant, then correct. One correction is enough for
  // all real zones (offsets are whole minutes and stable across the small shift).
  const offset1 = tzOffsetMinutes(new Date(guess), zone);
  let utcMs = guess - offset1 * 60000;
  // Re-evaluate the offset at the corrected instant to handle DST edges.
  const offset2 = tzOffsetMinutes(new Date(utcMs), zone);
  if (offset2 !== offset1) {
    utcMs = guess - offset2 * 60000;
  }
  return new Date(utcMs).toISOString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- tz`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: all prior unit tests still pass, plus the new `tz` tests.

- [ ] **Step 6: Commit**

```bash
git add src/tz.js test/unit/tz.test.js
git commit -m "feat: DST-correct localToUtc timezone conversion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 2: Store UTC on create and patch (Worker)

**Files:**
- Modify: `src/todos.js`
- Test: `test/workers/todos.test.js` (add a create-converts-to-UTC test)

**Interfaces:**
- Consumes: `localToUtc(naiveLocalIso, timeZone)` from `src/tz.js`.
- Produces: stored `reminder_at`/`due_at` are UTC ISO strings.

- [ ] **Step 1: Import `localToUtc` and convert in `createTodo`**

In `src/todos.js`, add the import at the top (with the other imports):

```js
import { localToUtc } from "./tz.js";
```

Then in `createTodo`, after the `const cleaned = await cleanupOrFallback(...)` line and before `insertTodo`, convert the date fields to UTC:

```js
  const cleaned = await cleanupOrFallback(env, { rawText, now, timezone });
  cleaned.due_at = localToUtc(cleaned.due_at, timezone);
  cleaned.reminder_at = localToUtc(cleaned.reminder_at, timezone);
  const todo = await insertTodo(env, user.id, rawText, cleaned);
```

- [ ] **Step 2: Update `patchTodo` date validation to accept UTC ISO**

In `src/todos.js` `patchTodo`, the current validation regex is:

```js
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
```

Replace it with one that accepts an optional fractional seconds and a `Z` (UTC) suffix, since the frontend now sends UTC instants on edits:

```js
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/;
```

(The patch path stores the client value as-is. The frontend sends UTC; this regex accepts both the old naive form and the UTC form so nothing breaks.)

- [ ] **Step 3: Add a test that create stores UTC — append to `test/workers/todos.test.js`**

Add this test inside the existing `describe("todos", ...)` block (it exercises `createTodo` end-to-end with a fallback cleanup, since no ANTHROPIC key is set in tests — fallback returns the raw text as title with null dates, so to test conversion we call `localToUtc` directly via a focused unit-style check in the worker context). Add:

```js
  it("createTodo path converts naive local dates to UTC before storing", async () => {
    // cleanupOrFallback with no API key returns null dates, so we verify the
    // conversion helper the create path uses, against the worker's Intl.
    const { localToUtc } = await import("../../src/tz.js");
    expect(localToUtc("2026-06-29T12:00:00", "America/Toronto")).toBe("2026-06-29T16:00:00.000Z");
  });
```

(Note: a fuller end-to-end create test would require mocking Claude; the
conversion itself is covered exhaustively in `test/unit/tz.test.js`. This test
confirms `localToUtc` resolves and runs under the Workers `Intl`.)

- [ ] **Step 4: Run worker tests**

Run: `npm run test:workers`
Expected: PASS, including the new conversion check.

- [ ] **Step 5: Commit**

```bash
git add src/todos.js test/workers/todos.test.js
git commit -m "fix: store reminder/due times as UTC on create; accept UTC on patch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 3: Recurrence keeps UTC instants UTC (Worker)

**Files:**
- Modify: `src/recurrence.js`
- Test: `test/unit/recurrence.test.js` (add a UTC-preservation test)

**Interfaces:**
- Produces: `nextOccurrence(iso, recurrence)` returns a `…Z` UTC string when given a `…Z` UTC string; unchanged behavior for the date math.

- [ ] **Step 1: Add a failing test — append to `test/unit/recurrence.test.js` inside the `describe("nextOccurrence", ...)` block**

```js
  it("preserves a UTC instant and advances daily by 24h", () => {
    expect(nextOccurrence("2026-06-29T16:00:00.000Z", { kind: "daily", interval: 1 }))
      .toBe("2026-06-30T16:00:00.000Z");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- recurrence`
Expected: FAIL — current `format()` produces `2026-06-30T16:00:00` (no `Z`, no millis), not `…000Z`.

- [ ] **Step 3: Make `nextOccurrence` preserve the UTC marker**

In `src/recurrence.js`, the `parse()` builds a `Date` via `Date.UTC(...)` and `format()` emits a naive string. Because the input may now carry a trailing `Z` and `.SSS`, ensure parse ignores them (it already slices by `T`, `-`, `:`; the seconds field may be `00.000` — coerce with `parseInt`) and format emits a `…Z` instant.

Replace the `parse` function:

```js
function parse(iso) {
  const [d, t] = iso.replace("Z", "").split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m, s] = (t || "00:00:00").split(":").map((v) => parseInt(v, 10));
  return new Date(Date.UTC(Y, M - 1, D, h, m, s || 0));
}
```

Replace the `format` function to emit a UTC ISO instant:

```js
function format(dt) {
  return dt.toISOString();
}
```

(`toISOString()` always yields `YYYY-MM-DDTHH:mm:ss.sssZ`. The existing
recurrence unit tests that expect the old naive format must be updated — see
next step.)

- [ ] **Step 4: Update the existing recurrence assertions to the UTC ISO format**

In `test/unit/recurrence.test.js`, the existing tests expect naive strings like
`"2026-06-02T09:00:00"`. Update each expected value to the `toISOString()` form.
The inputs can stay naive (parse tolerates them). Change the expectations:

- daily: `expect(...).toBe("2026-06-02T09:00:00.000Z")`
- every_n_days: `"2026-06-04T09:00:00.000Z"`
- weekly: `"2026-06-08T09:00:00.000Z"`
- weekdays (Fri→Mon): `"2026-06-08T09:00:00.000Z"`
- monthly: `"2026-07-15T09:00:00.000Z"`
- monthly clamp Jan 31 → `"2026-02-28T09:00:00.000Z"`; Aug 31 → `"2026-09-30T09:00:00.000Z"`
- null recurrence: still `toBeNull()`
- the new UTC test from Step 1 already expects `"2026-06-30T16:00:00.000Z"`

- [ ] **Step 5: Run recurrence tests**

Run: `npm run test:unit -- recurrence`
Expected: PASS (all, including the new UTC test).

- [ ] **Step 6: Commit**

```bash
git add src/recurrence.js test/unit/recurrence.test.js
git commit -m "fix: recurrence emits UTC ISO instants (preserves Z)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 4: Frontend renders + buckets in local time

**Files:**
- Modify: `public/today.js`
- Modify: `public/app.js`
- Modify: `public/sw.js` (cache bump)
- Test: `test/unit/today.test.js` (update for UTC instants → local buckets)

**Interfaces:**
- Consumes: stored `reminder_at`/`due_at` are now UTC instants (`…Z`).
- Produces: `bucketForToday(whenIso, nowMs)` and `buildToday(todos, nowMs)` bucket by the **local** date of the UTC instant. `localDateKey(utcIso)` helper → `YYYY-MM-DD` in the browser's local timezone.

- [ ] **Step 1: Rewrite the date logic in `public/today.js` to bucket by local date**

Replace the entire contents of `public/today.js` with:

```js
// Pure bucketing for the Today summary view. Times are stored as UTC instants
// ("…Z"); we bucket by the viewer's LOCAL calendar date.

export function todoWhen(todo) {
  return todo.reminder_at || todo.due_at || null;
}

// Local "YYYY-MM-DD" for a UTC instant (or a Date / ms value).
export function localDateKey(value) {
  const dt = value instanceof Date ? value : new Date(value);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// nowMs is a millisecond timestamp (Date.now() in the browser).
export function bucketForToday(whenIso, nowMs) {
  if (!whenIso) return null;
  const when = new Date(whenIso);
  if (isNaN(when.getTime())) return null;
  const d = localDateKey(when);
  const today = localDateKey(new Date(nowMs));
  if (d < today) return "overdue";
  if (d === today) return "today";
  return null; // future local day
}

export function buildToday(todos, nowMs) {
  const overdue = [];
  const today = [];
  for (const t of todos) {
    if (t.status !== "open") continue;
    const bucket = bucketForToday(todoWhen(t), nowMs);
    if (bucket === "overdue") overdue.push(t);
    else if (bucket === "today") today.push(t);
  }
  const byWhen = (a, b) => {
    const wa = todoWhen(a) || "", wb = todoWhen(b) || "";
    return wa < wb ? -1 : wa > wb ? 1 : 0;
  };
  overdue.sort(byWhen);
  today.sort(byWhen);
  return { overdue, today };
}
```

- [ ] **Step 2: Update `public/app.js` `renderToday` to pass a ms timestamp**

In `public/app.js`, `renderToday` currently calls `buildToday(todos, localNow())`. Change it to pass `Date.now()`:

```js
  const { overdue, today } = buildToday(todos, Date.now());
```

- [ ] **Step 3: Rewrite `fmtWhen` in `public/app.js` to render the UTC instant in local time**

Replace the existing `fmtWhen` function with:

```js
function fmtWhen(iso) {
  // iso is a stored UTC instant ("…Z"); render in the browser's local time.
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const p = (n) => String(n).padStart(2, "0");
  const localKey = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  const todayKey = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
  })();
  const datePart = localKey === todayKey ? "Today" : `${months[dt.getMonth()]} ${dt.getDate()}`;
  const hh = dt.getHours(), mm = dt.getMinutes();
  const hasTime = !(hh === 0 && mm === 0);
  return hasTime ? `${datePart}, ${p(hh)}:${p(mm)}` : datePart;
}
```

- [ ] **Step 4: Update `test/unit/today.test.js` for UTC instants + local buckets**

The previous tests passed a naive `NOW` string and naive `reminder_at`. Now
`buildToday`/`bucketForToday` take a **ms timestamp** for now and **UTC instants**
for todos. Replace the file contents with tests that are deterministic regardless
of the machine's local timezone by deriving expectations from the same local-date
helper the implementation uses:

```js
import { describe, it, expect } from "vitest";
import { todoWhen, bucketForToday, buildToday, localDateKey } from "../../public/today.js";

// Build a UTC instant that is `dayDelta` local-days from `nowMs` at local noon,
// so the local-date comparison is unambiguous regardless of the test machine's tz.
function localInstant(nowMs, dayDelta, hour = 12) {
  const base = new Date(nowMs);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayDelta, hour, 0, 0);
  return d.toISOString(); // UTC instant for that local wall time
}

const NOW = Date.UTC(2026, 5, 29, 16, 0, 0); // a fixed instant

describe("todoWhen", () => {
  it("prefers reminder_at, then due_at, then null", () => {
    expect(todoWhen({ reminder_at: "2026-06-29T16:00:00.000Z", due_at: "x" })).toBe("2026-06-29T16:00:00.000Z");
    expect(todoWhen({ reminder_at: null, due_at: "y" })).toBe("y");
    expect(todoWhen({ reminder_at: null, due_at: null })).toBeNull();
  });
});

describe("bucketForToday (by local date)", () => {
  it("undated is excluded", () => {
    expect(bucketForToday(null, NOW)).toBeNull();
    expect(bucketForToday("", NOW)).toBeNull();
  });
  it("yesterday (local) is overdue", () => {
    expect(bucketForToday(localInstant(NOW, -1), NOW)).toBe("overdue");
  });
  it("earlier today (local) is today", () => {
    expect(bucketForToday(localInstant(NOW, 0, 1), NOW)).toBe("today");
  });
  it("later today (local) is today", () => {
    expect(bucketForToday(localInstant(NOW, 0, 23), NOW)).toBe("today");
  });
  it("tomorrow (local) is excluded", () => {
    expect(bucketForToday(localInstant(NOW, 1), NOW)).toBeNull();
  });
  it("malformed instant is excluded", () => {
    expect(bucketForToday("not-a-date", NOW)).toBeNull();
  });
});

describe("buildToday", () => {
  it("groups open todos by local date and excludes done/undated/future", () => {
    const todos = [
      { id: "late",  status: "open", reminder_at: localInstant(NOW, 0, 18), due_at: null },
      { id: "early", status: "open", reminder_at: localInstant(NOW, 0, 8),  due_at: null },
      { id: "over",  status: "open", reminder_at: localInstant(NOW, -1, 9), due_at: null },
      { id: "done",  status: "done", reminder_at: localInstant(NOW, 0, 9),  due_at: null },
      { id: "undated", status: "open", reminder_at: null, due_at: null },
      { id: "future", status: "open", reminder_at: localInstant(NOW, 1, 9), due_at: null },
    ];
    const out = buildToday(todos, NOW);
    expect(out.overdue.map((t) => t.id)).toEqual(["over"]);
    expect(out.today.map((t) => t.id)).toEqual(["early", "late"]);
  });
});

describe("localDateKey", () => {
  it("formats a date's local Y-M-D", () => {
    const d = new Date(2026, 0, 5, 9, 0, 0);
    expect(localDateKey(d)).toBe("2026-01-05");
  });
});
```

- [ ] **Step 5: Run the today tests + full unit suite**

Run: `npm run test:unit -- today`
Expected: PASS.
Run: `npm run test:unit`
Expected: all unit tests pass.

- [ ] **Step 6: Bump the service worker cache so updated modules ship**

In `public/sw.js`, change:
```js
const CACHE = "brain-notes-v2";
```
to:
```js
const CACHE = "brain-notes-v3";
```

- [ ] **Step 7: Verify locally — render check**

Run: `npm run dev`. Sign in (dev magic link from console). Add a couple of todos
with times. Confirm chips show sensible local times and the Today view groups
them under Overdue/Today by your local date. Stop dev with Ctrl-C.

(Note: without an ANTHROPIC key locally, create stores null dates — to see chips
locally, PATCH a reminder_at as a UTC instant via curl, e.g.
`-d '{"reminder_at":"2026-06-29T16:00:00.000Z"}'`, and confirm the chip renders
in local time.)

- [ ] **Step 8: Commit**

```bash
git add public/today.js public/app.js public/sw.js test/unit/today.test.js
git commit -m "fix: render and bucket reminder times in the viewer's local timezone

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 5: Full suite, deploy, verify

**Files:** none (operational).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all unit + workers tests pass.

- [ ] **Step 2: Deploy**

Run: `npm run deploy`
Expected: prints the live URL + a new Version ID.

- [ ] **Step 3: Clean up old todos**

On the site, delete the existing todos (their times were stored under the old
naive scheme and will read ~4h shifted). They'll be re-added correctly going
forward.

- [ ] **Step 4: Verify a real reminder fires on time**

- Add a reminder a few minutes out (e.g. "remind me to stretch at <a time 3 min from now>").
- Confirm the chip shows that correct local time.
- Wait — confirm the push arrives at that minute (±1 min), NOT hours early.
- Optionally `npx wrangler tail` and confirm the cron line and no `cleanup fallback`.

---

## Self-Review Notes

- **Spec coverage:** UTC storage contract (Task 2 create + patch), `localToUtc` DST-correct (Task 1, summer+winter tests), cron UTC-to-UTC (no code change needed — `sendDueReminders` already uses UTC `now`; correctness now holds because stored values are UTC — verified by the on-time push in Task 5), recurrence preserves UTC (Task 3), frontend local rendering + local-date bucketing (Task 4), existing-data delete/re-add (Task 5 Step 3), DST tests (Task 1), SW cache bump (Task 4). All covered.
- **Cron note:** the spec lists "cron compares UTC-to-UTC" as a goal; there is no cron *code* change — `selectDueReminders`/`sendDueReminders` already compare `reminder_at <= nowIso` with `nowIso = new Date().toISOString()` (UTC). The fix is making `reminder_at` UTC at the source (Task 2). The existing `test/workers/push.test.js` remains valid (pure string comparison) and its seed values are already `…T08:00:00`-style; they still pass and now represent UTC. No edit required there.
- **Type/shape consistency:** `localToUtc(naiveLocalIso, timeZone)` consistent (Task 1 def, Task 2 use). `buildToday`/`bucketForToday` now take a **ms** `now` (Task 4) — `renderToday` updated to pass `Date.now()` (Task 4 Step 2); the today test passes a ms `NOW` (Task 4 Step 4). `nextOccurrence` returns `toISOString()` form; all recurrence expectations updated (Task 3 Step 4).
- **No placeholders:** every step has full code/commands and expected output.
- **Breaking-change guard:** Task 3 changes `nextOccurrence`'s output format — every existing assertion is updated in the same task (Step 4), so the suite stays green.
