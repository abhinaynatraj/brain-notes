# Clear Actions (Clear done / Delete all) — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan

## Summary

Add two bulk-delete actions to Brain Notes: **Clear done** (delete the user's
completed todos) and **Delete all** (delete all the user's todos). Both live in
the top toolbar. "Clear done" runs immediately; "Delete all" asks for
confirmation first.

## Goals

1. `DELETE /api/todos?scope=done` — delete the authenticated user's done todos.
2. `DELETE /api/todos?scope=all` — delete all the authenticated user's todos.
3. Toolbar buttons: **Clear done** (no confirm) and **Delete all** (confirm).
4. Always user-scoped — a bulk delete can never affect another user's data.

## Non-Goals

- No undo/restore (confirmation on the risky action is the safety net).
- No "clear by date/group" filters (just done / all).
- No new persistence or schema change.

## Architecture

A new bulk-delete endpoint behind the existing session auth gate, plus two
toolbar buttons. The router already handles `DELETE /api/todos/:id`; this adds
the id-less `DELETE /api/todos` path.

## API

`DELETE /api/todos?scope=<done|all>` (auth required):
- `scope=done` → `DELETE FROM todos WHERE user_id = ? AND status = 'done'`.
- `scope=all` → `DELETE FROM todos WHERE user_id = ?`.
- Any other/missing scope → `400 {error:"invalid scope"}`.
- Returns `{ deleted: <count> }` (rows affected).

### Wiring (`src/index.js`)
The authed section currently matches `^/api/todos/([^/]+)$` for PATCH/DELETE by
id. Add a branch: if the path is exactly `/api/todos` and method is `DELETE`,
dispatch to `clearTodos(request, env, user)`. (The existing exact-match `authed`
map handles `GET`/`POST /api/todos`; DELETE on the bare path is new.)

## Backend components

### `db.js` — `deleteTodos(env, userId, scope)`
- `scope === "done"` → delete that user's done todos; return the deleted count.
- `scope === "all"` → delete all that user's todos; return the deleted count.
- Uses D1 `.run()`'s `meta.changes` for the count. Parameterized, user-scoped.

### `todos.js` — `clearTodos(request, env, user)`
- Reads `scope` from the URL query string.
- Validates `scope` ∈ {`done`,`all`}, else `400 {error:"invalid scope"}`.
- Calls `deleteTodos(env, user.id, scope)`, returns `{ deleted }`.

## Frontend components (`public/app.js`)

Two buttons added to the top toolbar in `renderApp()`'s template, alongside
Reminders / Theme / Sign out: **Clear done** and **Delete all**. Labels kept
short; the toolbar is allowed to wrap on narrow screens (CSS) so nothing clips.

- **Clear done** → `DELETE /api/todos?scope=done` immediately (no confirm), then
  `loadTodos()`. Toast: "Cleared done" on success; if `deleted === 0`, toast
  "Nothing to clear".
- **Delete all** → `confirm("Delete all N todos? This can't be undone.")` where
  N is `todos.length`. On OK → `DELETE /api/todos?scope=all`, then
  `loadTodos()`, toast "All cleared". On cancel → no-op.
- Both use the existing `api()` helper (so a 401 routes to login) and surface a
  failure toast on a non-ok response.

### Toolbar layout
`renderApp()` toolbar gains two buttons. `public/styles.css` `.toolbar` is set
to wrap (`flex-wrap: wrap`) and right-align so 5 pills lay out cleanly on a
narrow screen instead of overflowing.

## Data Flow

1. User taps **Clear done** → DELETE `?scope=done` → server deletes done rows,
   returns count → client refreshes list + toasts.
2. User taps **Delete all** → confirm → DELETE `?scope=all` → server deletes all
   the user's rows → client refreshes (empty state) + toasts.

## Error Handling

- Invalid/missing `scope` → 400, surfaced as a toast.
- 401 (expired session) → existing `api()` helper routes to login.
- Non-ok response → toast "Couldn't clear — try again." List is reloaded either
  way so the UI reflects the true server state.

## Testing

- `db.js` `deleteTodos` (workers test): seed done + open todos for two users;
  `scope=done` deletes only this user's done (leaves open + other user
  untouched); `scope=all` deletes all this user's (leaves other user untouched);
  returned counts correct.
- `clearTodos` invalid scope → 400 (covered via the db/handler test or a small
  handler test).
- Frontend verified in the running app: both buttons, the confirm on Delete all,
  toasts, and the empty state after a full clear.

## Files

- Modify: `src/db.js` (add `deleteTodos`), `src/todos.js` (add `clearTodos`),
  `src/index.js` (route the id-less DELETE), `public/app.js` (toolbar buttons +
  handlers), `public/styles.css` (toolbar wrap), `public/sw.js` (cache bump so
  the updated app.js ships).
- Test: `test/workers/todos.test.js` (deleteTodos / clearTodos cases).

## Build Order (high level — detailed plan to follow)

1. `db.js deleteTodos` + `todos.js clearTodos` + workers tests (TDD).
2. Route the id-less DELETE in `index.js`.
3. Frontend toolbar buttons + handlers + toolbar wrap + SW cache bump.
4. Verify in the running app; deploy.
