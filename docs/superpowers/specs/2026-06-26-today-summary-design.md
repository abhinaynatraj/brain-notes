# My Summary (Today view) — Design Spec

**Date:** 2026-06-26
**Status:** Approved (design), pending implementation plan

## Summary

Add a **Today** summary view to Brain Notes: a filtered, grouped view of the
day's pending todos (overdue + due today), reached via an **All / Today** toggle
near the top of the app. Frontend-only — no new API, no schema change. Bundled
with a one-line switch of the cleanup model to Claude Haiku for cheaper parsing.

## Goals

1. A **Today** view showing open todos that are **overdue** or **due today**,
   grouped and sorted by time.
2. An **All / Today** pill toggle to switch between the existing full list and
   the summary, with no reload and no new network call.
3. Switch the Claude cleanup model from Sonnet to **Haiku** (cheaper, ample for
   parsing).

## Non-Goals

- No AI-written prose summary (structured list only).
- No "undated/anytime" group in Today (only time-bound + overdue).
- No persistence of the selected view (resets to All on refresh).
- No new backend endpoint, no DB change, no done-todo display in Today.

## Architecture

Entirely client-side in `public/app.js`, plus one line in `src/claude.js`.

The app already loads the full todo list via `GET /api/todos` into an in-memory
`todos` array. The Today view **filters that same array** — no extra fetch. A
single module-level `view` variable (`"all"` | `"today"`) drives which renderer
runs. Toggling re-renders the list region only.

```
 [ capture box ]
 [ All | Today ]   <- pill toggle (new)
 [ list region ]   <- renderList() (All)  OR  renderToday() (Today)
```

## Components

### View toggle
- Two pills rendered between the capture form and the list region: **All**,
  **Today**. The active pill is visually marked (accent border/fill).
- Clicking a pill sets `view` and calls the matching renderer. No reload, no URL
  change. `view` defaults to `"all"` and is not persisted.

### Today bucketing (pure logic — `src/today.js`, unit-tested)
A pure helper module so the date logic is testable without the DOM:

- `todoWhen(todo)` → returns the todo's effective time string: `reminder_at` if
  set, else `due_at`, else `null`.
- `bucketForToday(whenIso, nowIso)` → given a todo's effective time and the
  user's local "now" (both naive local `YYYY-MM-DDTHH:mm:ss`), returns
  `"overdue"`, `"today"`, or `null` (not in the Today view):
  - `null`/empty `whenIso` → `null` (undated todos are excluded).
  - same calendar date as `nowIso` → `"today"`.
  - strictly before `nowIso` (earlier date, OR same/earlier — see rule) →
    `"overdue"`.
  - later date than today → `null` (future, not shown in Today).
  - **Rule:** compare by calendar date first. If `whenIso`'s date < today →
    `overdue`. If `== today` → `today` (regardless of whether the time has
    passed; a thing due later today is still "today", not overdue). If
    `> today` → excluded.
- `buildToday(todos, nowIso)` → filters to `status === "open"`, maps each to its
  bucket, drops `null`, and returns `{ overdue: [...], today: [...] }` with each
  list sorted ascending by effective time.

### Today renderer (`renderToday` in `app.js`)
- Calls `buildToday(todos, localNow())`.
- Renders an **Overdue** group then a **Today** group, each with a count in the
  header (e.g. "Overdue · 2"). Overdue time chips use the alert/accent tint.
- Each row reuses the existing `todoEl()` component, so checkbox-toggle and
  delete behave identically and refresh the counts.
- If both groups are empty → empty state: "Nothing pending for today. Nice."

### Model switch
`src/claude.js`: `model: "claude-sonnet-4-6"` → `model: "claude-haiku-4-5"`.
No other change; the request shape and validation are unchanged.

## Data Flow

1. App boot loads `todos` (unchanged).
2. User taps **Today** → `view = "today"` → `renderToday()` filters the
   in-memory `todos` via `buildToday`, renders the two groups.
3. Toggling a todo done / deleting it calls the existing PATCH/DELETE, then
   `loadTodos()` refreshes `todos` and re-runs the current view's renderer, so
   counts and groups update live.
4. Tapping **All** → `view = "all"` → `renderList()` (existing behavior).

## Error Handling

- No new network path, so no new failure modes. The existing 401→login and
  toast-on-error handling covers todo mutations from within the Today view.
- Date parsing in `src/today.js` operates on the same naive-local ISO strings
  the rest of the app uses; a malformed/empty `whenIso` yields `null` (excluded)
  rather than throwing.

## Testing

- **Unit tests** (`test/unit/today.test.js`, plain vitest) for `bucketForToday`
  and `buildToday`:
  - undated → excluded; yesterday → overdue; earlier today → today; later today
    → today; tomorrow → excluded; done todos excluded; sorting ascending;
    both-empty case.
- Toggle + rendering verified visually in the running app (light + dark), like
  the rest of the frontend.
- Model switch: covered by the existing Claude unit tests (validation
  unchanged); confirmed live with one real todo after deploy.

## Files

- Create: `src/today.js` (pure bucketing logic), `test/unit/today.test.js`.
- Modify: `public/app.js` (toggle + `renderToday` + wire into boot/refresh),
  `public/styles.css` (pill toggle + group header styles), `src/claude.js`
  (model id). `src/today.js` is imported by `app.js` as a browser ES module
  (served as a static asset), so it must use plain browser-compatible ESM.

## Build Order (high level — detailed plan to follow)

1. `src/today.js` bucketing logic + unit tests (TDD).
2. Wire the All/Today toggle + `renderToday` into `app.js`, with styles.
3. Switch the model to Haiku.
4. Verify in the running app; deploy.
