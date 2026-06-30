# Clear Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clear done / Delete all bulk-delete actions to Brain Notes via a new id-less `DELETE /api/todos?scope=done|all` endpoint and two top-toolbar buttons.

**Architecture:** A `deleteTodos(env, userId, scope)` D1 helper and a `clearTodos` request handler, routed behind the existing auth gate by an id-less DELETE branch in `index.js`. Two toolbar buttons call the endpoint; Delete all confirms first.

**Tech Stack:** Cloudflare Worker (JS, D1), vanilla-JS PWA, Vitest.

## Global Constraints

- Tests: pure logic → `npm run test:unit`; D1/Worker → `npm run test:workers`; both via `npm test`. (Project path has a space; `test-workers.sh` mirrors to a space-free dir.)
- All bulk deletes MUST be user-scoped (`WHERE user_id = ?`) — never touch another user's rows.
- `scope` is `done` or `all`; anything else → `400 {error:"invalid scope"}`.
- Endpoint returns `{ deleted: <count> }` using D1 `.run()`'s `meta.changes`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Backend — deleteTodos helper + clearTodos handler + route (TDD)

**Files:**
- Modify: `src/db.js` (add `deleteTodos`)
- Modify: `src/todos.js` (add `clearTodos`)
- Modify: `src/index.js` (route id-less DELETE)
- Test: `test/workers/todos.test.js`

**Interfaces:**
- Produces:
  - `deleteTodos(env, userId, scope)` → number — deletes the user's `done` todos (`scope==="done"`) or all the user's todos (`scope==="all"`); returns the deleted count. Unknown scope deletes nothing and returns 0.
  - `clearTodos(request, env, user)` → Response — reads `scope` from the query string; `400 {error:"invalid scope"}` if not done/all; else `{ deleted }`.

- [ ] **Step 1: Write the failing test — append to `test/workers/todos.test.js`**

The file already imports from `../../src/db.js` and `../../src/todos.js` and has a `migrate()` + `beforeEach` that clears the `todos` table. Add these imports to the existing import lines at the top (extend, do not duplicate): `deleteTodos` from db, `clearTodos` from todos. Then add this `describe` block at the end of the file (after the existing `describe("todos", ...)` block closes):

```js
import { deleteTodos } from "../../src/db.js";
import { clearTodos } from "../../src/todos.js";

describe("clear actions", () => {
  async function seedFor(user, id, status) {
    await env.DB.prepare(
      `INSERT INTO todos (id, user_id, raw_text, title, status, created_at, updated_at)
       VALUES (?, ?, 'r', 't', ?, '2026-01-01', '2026-01-01')`
    ).bind(id, user, status).run();
  }

  it("scope=done deletes only this user's done todos", async () => {
    await seedFor("u1", "a", "done");
    await seedFor("u1", "b", "open");
    await seedFor("u2", "c", "done"); // other user — must be untouched
    const n = await deleteTodos(env, "u1", "done");
    expect(n).toBe(1);
    const mine = await listTodos(env, "u1");
    expect(mine.map((t) => t.id).sort()).toEqual(["b"]);
    const other = await listTodos(env, "u2");
    expect(other.map((t) => t.id)).toEqual(["c"]);
  });

  it("scope=all deletes all this user's todos but not another user's", async () => {
    await seedFor("u1", "a", "done");
    await seedFor("u1", "b", "open");
    await seedFor("u2", "c", "open");
    const n = await deleteTodos(env, "u1", "all");
    expect(n).toBe(2);
    expect(await listTodos(env, "u1")).toEqual([]);
    expect((await listTodos(env, "u2")).map((t) => t.id)).toEqual(["c"]);
  });

  it("clearTodos rejects an invalid scope with 400", async () => {
    const req = new Request("http://x/api/todos?scope=bogus", { method: "DELETE" });
    const res = await clearTodos(req, env, { id: "u1" });
    expect(res.status).toBe(400);
  });

  it("clearTodos returns the deleted count", async () => {
    await seedFor("u1", "a", "done");
    await seedFor("u1", "b", "done");
    const req = new Request("http://x/api/todos?scope=done", { method: "DELETE" });
    const res = await clearTodos(req, env, { id: "u1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
  });
});
```

Note: `listTodos` is already imported in this test file. If the top-of-file
import line already pulls several names from `../../src/db.js`, add `deleteTodos`
to that existing line instead of adding a second import statement (duplicate
imports from the same module are fine in ESM but keep it tidy).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:workers`
Expected: FAIL — `deleteTodos` / `clearTodos` are not exported.

- [ ] **Step 3: Add `deleteTodos` to `src/db.js`**

Append to `src/db.js`:

```js
export async function deleteTodos(env, userId, scope) {
  let sql;
  if (scope === "done") {
    sql = "DELETE FROM todos WHERE user_id = ? AND status = 'done'";
  } else if (scope === "all") {
    sql = "DELETE FROM todos WHERE user_id = ?";
  } else {
    return 0;
  }
  const res = await env.DB.prepare(sql).bind(userId).run();
  return res.meta.changes || 0;
}
```

- [ ] **Step 4: Add `clearTodos` to `src/todos.js`**

First extend the existing db import in `src/todos.js` to include `deleteTodos`.
The current import line is:

```js
import { insertTodo, getTodo, listTodos, deleteTodo } from "./db.js";
```
Change it to:
```js
import { insertTodo, getTodo, listTodos, deleteTodo, deleteTodos } from "./db.js";
```

Then add this handler (anywhere among the exports, e.g. after `removeTodo`):

```js
export async function clearTodos(request, env, user) {
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope !== "done" && scope !== "all") {
    return json({ error: "invalid scope" }, 400);
  }
  const deleted = await deleteTodos(env, user.id, scope);
  return json({ deleted });
}
```

- [ ] **Step 5: Route the id-less DELETE in `src/index.js`**

Add `clearTodos` to the todos import line. Current:
```js
import { createTodo, getTodos, patchTodo, removeTodo } from "./todos.js";
```
Change to:
```js
import { createTodo, getTodos, patchTodo, removeTodo, clearTodos } from "./todos.js";
```

Then, in the authed section, add an id-less DELETE branch BEFORE the `:id`
regex match. The current block is:

```js
      const key = `${request.method} ${pathname}`;
      if (authed[key]) return authed[key](request, env, user);

      const m = pathname.match(/^\/api\/todos\/([^/]+)$/);
```

Insert the bulk-delete branch between them:

```js
      const key = `${request.method} ${pathname}`;
      if (authed[key]) return authed[key](request, env, user);

      if (pathname === "/api/todos" && request.method === "DELETE") {
        return clearTodos(request, env, user);
      }

      const m = pathname.match(/^\/api\/todos\/([^/]+)$/);
```

(The `:id` regex requires a segment after `/api/todos/`, so `/api/todos` never
matches it — no collision.)

- [ ] **Step 6: Run the worker tests to verify they pass**

Run: `npm run test:workers`
Expected: PASS — including the 4 new clear-action tests.

- [ ] **Step 7: Verify the Worker boots and the route works (no session → 401, then the route exists)**

Run:
```
cd "/Users/abhi/Projects/Personal/Brain Notes" && (npx wrangler dev --port 8816 > /tmp/wr_clear.log 2>&1 &) ; sleep 18; echo "no-auth DELETE ->"; curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "localhost:8816/api/todos?scope=done"; echo "bad scope path still gated ->"; curl -s -X DELETE "localhost:8816/api/todos?scope=bogus"; echo; pkill -f wrangler; sleep 1
```
Expected: the no-auth DELETE returns `401` (gate works; the route is reachable). The bogus-scope one also returns `{"error":"unauthorized"}` because auth runs before scope validation — that's correct (auth first).

- [ ] **Step 8: Commit**

```bash
git add src/db.js src/todos.js src/index.js test/workers/todos.test.js
git commit -m "feat: bulk-delete endpoint (clear done / delete all), user-scoped

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 2: Frontend — toolbar buttons + handlers + toolbar wrap

**Files:**
- Modify: `public/app.js` (toolbar buttons + handlers)
- Modify: `public/styles.css` (toolbar wrap)
- Modify: `public/sw.js` (cache bump)

**Interfaces:**
- Consumes: `DELETE /api/todos?scope=done|all` → `{ deleted }`; existing `api()`, `toast()`, `loadTodos()`, `todos` array in `app.js`.

- [ ] **Step 1: Add the two buttons to the toolbar template in `renderApp()`**

In `public/app.js`, the toolbar block is:

```js
      <div class="toolbar">
        <button class="iconbtn" id="notifyBtn">Reminders</button>
        <button class="iconbtn" id="themeBtn">${THEME_LABEL[currentTheme()]}</button>
        <button class="iconbtn" id="logoutBtn">Sign out</button>
      </div>
```

Replace it with (adds Clear done + Delete all before Sign out):

```js
      <div class="toolbar">
        <button class="iconbtn" id="notifyBtn">Reminders</button>
        <button class="iconbtn" id="clearDoneBtn">Clear done</button>
        <button class="iconbtn" id="deleteAllBtn">Delete all</button>
        <button class="iconbtn" id="themeBtn">${THEME_LABEL[currentTheme()]}</button>
        <button class="iconbtn" id="logoutBtn">Sign out</button>
      </div>
```

- [ ] **Step 2: Wire the handlers in `renderApp()`**

In `public/app.js`, after the existing `notifyBtn` handler (the block that ends
the toolbar wiring), add:

```js
  document.getElementById("clearDoneBtn").addEventListener("click", async () => {
    try {
      const res = await api("/api/todos?scope=done", { method: "DELETE" });
      const { deleted } = await res.json();
      await loadTodos();
      toast(deleted ? "Cleared done" : "Nothing to clear");
    } catch (e) {
      if (e.message !== "unauthorized") toast("Couldn’t clear — try again.");
    }
  });

  document.getElementById("deleteAllBtn").addEventListener("click", async () => {
    if (!todos.length) { toast("Nothing to delete"); return; }
    if (!confirm(`Delete all ${todos.length} todos? This can’t be undone.`)) return;
    try {
      await api("/api/todos?scope=all", { method: "DELETE" });
      await loadTodos();
      toast("All cleared");
    } catch (e) {
      if (e.message !== "unauthorized") toast("Couldn’t delete — try again.");
    }
  });
```

- [ ] **Step 3: Make the toolbar wrap so 5 pills don't clip on a narrow screen**

In `public/styles.css`, the toolbar rule is:

```css
.toolbar { display: flex; gap: 6px; flex: none; }
```
Change it to allow wrapping and right-alignment:
```css
.toolbar { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
```

(The `.topbar` already uses `align-items: baseline`; with the toolbar wrapping,
the pills flow to a second row on narrow screens instead of overflowing.)

- [ ] **Step 4: Bump the service worker cache so the new app.js ships**

In `public/sw.js`, change:
```js
const CACHE = "brain-notes-v3";
```
to:
```js
const CACHE = "brain-notes-v4";
```

- [ ] **Step 5: Verify locally**

Run: `npm run dev`. Sign in (dev magic link from the console). Add a few todos,
mark one done. Then:
- Tap **Clear done** → the done one disappears, toast "Cleared done".
- Tap **Clear done** again with none done → toast "Nothing to clear".
- Tap **Delete all** → confirm dialog shows the count → OK → list empties, toast
  "All cleared"; Cancel → nothing changes.
- Confirm the toolbar lays out cleanly (wraps, no clipping) at a narrow width.
Stop dev with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/styles.css public/sw.js
git commit -m "feat: Clear done / Delete all toolbar actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 3: Full suite, deploy, verify

**Files:** none (operational).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all unit + workers tests pass (including the 4 new clear-action tests).

- [ ] **Step 2: Deploy**

Run: `npm run deploy`
Expected: prints the live URL + a new Version ID.

- [ ] **Step 3: Production smoke test**

On `https://brain-notes.abhinay-natraj.workers.dev` (hard-refresh once for the v4 SW):
- Add 2 todos, mark one done → **Clear done** removes the done one only.
- **Delete all** → confirm → list empties.
- Confirm the toolbar looks right on mobile width.

---

## Self-Review Notes

- **Spec coverage:** `DELETE ?scope=done` and `?scope=all` (Task 1 `deleteTodos`), invalid scope → 400 (Task 1 `clearTodos` + test), `{deleted}` count via meta.changes (Task 1), user-scoping with cross-user isolation (Task 1 tests), id-less DELETE routing (Task 1 Step 5), toolbar buttons with asymmetric confirm — Clear done immediate, Delete all confirmed (Task 2 Step 2), zero-deleted quiet toast (Task 2 Step 2), toolbar wrap to avoid clipping (Task 2 Step 3), SW cache bump (Task 2 Step 4), failure toast + 401→login via api() (Task 2). All covered.
- **Type consistency:** `deleteTodos(env, userId, scope)` and `clearTodos(request, env, user)` names/signatures consistent across db.js, todos.js, index.js, and the tests. Return shape `{ deleted }` consistent (handler) and `number` (helper).
- **Routing safety:** id-less DELETE branch added before the `:id` regex; `/api/todos` cannot match `^/api/todos/([^/]+)$`. Auth runs before scope validation (gate first) — noted in Task 1 Step 7 expected output.
- **No placeholders:** every step has full code + commands + expected output.
