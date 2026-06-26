# Today Summary View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an All/Today toggle to Brain Notes that shows a grouped summary of open todos which are overdue or due today, and switch the cleanup model to Claude Haiku.

**Architecture:** Frontend-only. A pure browser ES module (`public/today.js`) buckets the already-loaded `todos` array into overdue/today groups; `public/app.js` gains a `view` toggle and a `renderToday()` renderer that reuses the existing `todoEl()` row component. One line changes the model id in `src/claude.js`.

**Tech Stack:** Vanilla JS (browser ES modules), hand-written CSS, Vitest (plain `test:unit` runner). No backend/API/schema changes.

## Global Constraints

- The project path contains a space, so unit tests run via `npm run test:unit` (plain vitest, `vitest.config.node.js`), NOT the workers pool. Pure-logic tests live in `test/unit/` and import source with a relative path.
- `public/today.js` is served to the browser as a static asset and imported by `public/app.js` — it MUST be plain browser-compatible ES module syntax (no Node APIs). It lives in `public/` (only `public/` is served; `src/` is the Worker and is not browser-reachable).
- Times throughout are naive local ISO strings `YYYY-MM-DDTHH:mm:ss` (what `localNow()` and the stored `reminder_at`/`due_at` use). Compare by calendar date.
- Bucketing rule: a todo whose effective date is an earlier calendar day than today → `overdue`; same calendar day → `today` (even if the clock time has already passed); a later day → excluded (null). Undated → excluded.
- Effective time = `reminder_at` if set, else `due_at`, else null.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Today bucketing logic (pure, TDD)

**Files:**
- Create: `public/today.js`
- Test: `test/unit/today.test.js`

**Interfaces:**
- Produces:
  - `todoWhen(todo)` → string|null — returns `todo.reminder_at` if truthy, else `todo.due_at` if truthy, else `null`.
  - `bucketForToday(whenIso, nowIso)` → `"overdue"` | `"today"` | `null` — buckets one effective time against now, by calendar date.
  - `buildToday(todos, nowIso)` → `{ overdue: Todo[], today: Todo[] }` — filters to open todos, buckets, drops nulls, sorts each group ascending by effective time.

- [ ] **Step 1: Write the failing test `test/unit/today.test.js`** (note `../../public/` import path)

```js
import { describe, it, expect } from "vitest";
import { todoWhen, bucketForToday, buildToday } from "../../public/today.js";

const NOW = "2026-06-26T10:00:00";

describe("todoWhen", () => {
  it("prefers reminder_at, then due_at, then null", () => {
    expect(todoWhen({ reminder_at: "2026-06-26T09:00:00", due_at: "2026-06-27T00:00:00" })).toBe("2026-06-26T09:00:00");
    expect(todoWhen({ reminder_at: null, due_at: "2026-06-27T00:00:00" })).toBe("2026-06-27T00:00:00");
    expect(todoWhen({ reminder_at: null, due_at: null })).toBeNull();
  });
});

describe("bucketForToday", () => {
  it("undated is excluded", () => {
    expect(bucketForToday(null, NOW)).toBeNull();
    expect(bucketForToday("", NOW)).toBeNull();
  });
  it("an earlier calendar day is overdue", () => {
    expect(bucketForToday("2026-06-25T23:00:00", NOW)).toBe("overdue");
  });
  it("earlier time the same day is still today (not overdue)", () => {
    expect(bucketForToday("2026-06-26T08:00:00", NOW)).toBe("today");
  });
  it("later time the same day is today", () => {
    expect(bucketForToday("2026-06-26T18:00:00", NOW)).toBe("today");
  });
  it("a later calendar day is excluded", () => {
    expect(bucketForToday("2026-06-27T01:00:00", NOW)).toBeNull();
  });
});

describe("buildToday", () => {
  it("groups, excludes done/undated/future, and sorts ascending", () => {
    const todos = [
      { id: "a", status: "open", reminder_at: "2026-06-26T18:00:00", due_at: null },
      { id: "b", status: "open", reminder_at: "2026-06-26T08:00:00", due_at: null },
      { id: "c", status: "open", reminder_at: "2026-06-25T09:00:00", due_at: null }, // overdue
      { id: "d", status: "done", reminder_at: "2026-06-26T09:00:00", due_at: null }, // done -> excluded
      { id: "e", status: "open", reminder_at: null, due_at: null },                  // undated -> excluded
      { id: "f", status: "open", reminder_at: "2026-06-27T09:00:00", due_at: null }, // future -> excluded
    ];
    const out = buildToday(todos, NOW);
    expect(out.overdue.map((t) => t.id)).toEqual(["c"]);
    expect(out.today.map((t) => t.id)).toEqual(["b", "a"]); // 08:00 before 18:00
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- today`
Expected: FAIL — cannot resolve `../../public/today.js` / functions not defined.

- [ ] **Step 3: Implement `public/today.js`**

```js
// Pure bucketing for the Today summary view. Operates on naive local ISO
// strings "YYYY-MM-DDTHH:mm:ss" and compares by calendar date.

export function todoWhen(todo) {
  return todo.reminder_at || todo.due_at || null;
}

// "YYYY-MM-DD" date portion of a naive local ISO string.
function dateOf(iso) {
  return iso.slice(0, 10);
}

export function bucketForToday(whenIso, nowIso) {
  if (!whenIso) return null;
  const d = dateOf(whenIso);
  const today = dateOf(nowIso);
  if (d < today) return "overdue";
  if (d === today) return "today";
  return null; // future day
}

export function buildToday(todos, nowIso) {
  const overdue = [];
  const today = [];
  for (const t of todos) {
    if (t.status !== "open") continue;
    const when = todoWhen(t);
    const bucket = bucketForToday(when, nowIso);
    if (bucket === "overdue") overdue.push(t);
    else if (bucket === "today") today.push(t);
  }
  const byWhen = (a, b) => (todoWhen(a) < todoWhen(b) ? -1 : todoWhen(a) > todoWhen(b) ? 1 : 0);
  overdue.sort(byWhen);
  today.sort(byWhen);
  return { overdue, today };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- today`
Expected: PASS (all `today` tests).

- [ ] **Step 5: Run the full unit suite to confirm nothing else broke**

Run: `npm run test:unit`
Expected: previous unit tests still pass, plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add public/today.js test/unit/today.test.js
git commit -m "feat: Today summary bucketing logic (overdue / today)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 2: All/Today toggle + Today renderer in the UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `public/index.html` (bump the SW cache version is NOT here — see note)

**Interfaces:**
- Consumes: `buildToday(todos, nowIso)` and `todoWhen(todo)` from `public/today.js`; existing `todoEl(t)`, `el()`, `escapeHtml()`, `localNow()`, `loadTodos()`, `todos` array, `renderList()` in `app.js`.
- Produces: a module-level `view` state and `renderCurrentView()` used by data refreshers.

- [ ] **Step 1: Import the bucketing helpers at the top of `public/app.js`**

Add as the first line of the file (before the existing first comment is fine, but place it at the very top so it's an unambiguous module import):

```js
import { buildToday, todoWhen } from "/today.js";
```

Note: `app.js` is loaded with `<script type="module">`, so top-level `import` works. Use the absolute `/today.js` path (served from `public/`).

- [ ] **Step 2: Add `view` state and a `renderCurrentView()` dispatcher**

In `public/app.js`, find the data-actions section (right after `let todos = [];` near line 128). Add below it:

```js
let view = "all"; // "all" | "today"

function renderCurrentView() {
  if (view === "today") renderToday();
  else renderList();
}
```

- [ ] **Step 3: Point the data refreshers at the current view**

In `public/app.js`, `loadTodos()` currently ends by calling `renderList()`. Change that call to `renderCurrentView()`. The function should read:

```js
async function loadTodos() {
  const res = await api("/api/todos");
  todos = await res.json();
  renderCurrentView();
}
```

(No other change in `loadTodos`. `toggleStatus` and `deleteTodo` already call `loadTodos()`, so they will refresh whichever view is active.)

- [ ] **Step 4: Add the `renderToday()` renderer**

In `public/app.js`, add this function right after `renderList()` (which ends near line 160):

```js
function fmtWhenShort(iso) {
  // Reuse the chip formatter's style: "Jun 26, 09:00" or date-only.
  return fmtWhen(iso);
}

function todayGroup(label, items) {
  const wrap = el("div");
  const header = el("div", { class: "section-label" }, `${label} · ${items.length}`);
  wrap.appendChild(header);
  const list = el("div", { class: "list" });
  items.forEach((t) => list.appendChild(todoEl(t)));
  wrap.appendChild(list);
  return wrap;
}

function renderToday() {
  const list = document.getElementById("list");
  if (!list) return;
  const { overdue, today } = buildToday(todos, localNow());
  list.innerHTML = "";
  if (!overdue.length && !today.length) {
    list.appendChild(el("div", { class: "empty" },
      `<div class="empty-mark">✓</div><p>Nothing pending for today. Nice.</p>`));
    return;
  }
  if (overdue.length) list.appendChild(todayGroup("Overdue", overdue));
  if (today.length) list.appendChild(todayGroup("Today", today));
}
```

- [ ] **Step 5: Render the toggle pills and wire them**

In `public/app.js`, inside `renderApp()`, the template has a `<form class="capture" ...>` block followed by `<main id="list"></main>`. Insert the toggle between the closing `</form>` and `<main id="list">`. Find this part of the template string:

```js
      <p class="hint">Write it however it comes out — it’ll be tidied into a crisp todo.</p>
    </form>

    <main id="list"></main>`;
```

and replace it with:

```js
      <p class="hint">Write it however it comes out — it’ll be tidied into a crisp todo.</p>
    </form>

    <div class="viewtabs" id="viewtabs">
      <button class="viewtab" data-view="all">All</button>
      <button class="viewtab" data-view="today">Today</button>
    </div>

    <main id="list"></main>`;
```

Then, still in `renderApp()`, after the existing event wiring (after the `notifyBtn` handler near the end of `renderApp`, before `ta.focus()`), add:

```js
  const tabs = document.getElementById("viewtabs");
  function syncTabs() {
    tabs.querySelectorAll(".viewtab").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === view));
  }
  tabs.querySelectorAll(".viewtab").forEach((b) => {
    b.addEventListener("click", () => {
      view = b.dataset.view;
      syncTabs();
      renderCurrentView();
    });
  });
  syncTabs();
```

(Leave the existing `loadTodos()` call at the end of `renderApp()` as-is; it will render via `renderCurrentView()` → the default `all` view.)

- [ ] **Step 6: Add styles for the toggle in `public/styles.css`**

Append to `public/styles.css` (before the `@media (prefers-reduced-motion ...)` block is fine; appending at end is also fine):

```css
/* ---------- View tabs (All / Today) ---------- */
.viewtabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  margin: 0 0 18px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 999px;
}
.viewtab {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--muted);
  font: 500 13px/1 var(--sans);
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 0.2s var(--ease), color 0.2s var(--ease);
}
.viewtab.active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow);
}
```

- [ ] **Step 7: Bump the service worker cache version so the new JS ships to installed PWAs**

In `public/sw.js`, change the cache name (the `today.js` module and updated `app.js` must not be served stale from the old cache). Find:

```js
const CACHE = "brain-notes-v1";
```
and change to:
```js
const CACHE = "brain-notes-v2";
```
Also add `/today.js` to the `SHELL` array so it is precached. Find the `SHELL` line and add `/today.js`:
```js
const SHELL = ["/", "/index.html", "/app.js", "/styles.css", "/manifest.json", "/icons/icon-192.png", "/today.js"];
```

- [ ] **Step 8: Verify locally — boot the app and exercise the toggle**

Run (in one shell): `npm run dev`
Then load `http://localhost:8787`, sign in via the dev magic-link printed in the console, add a couple of todos with times (one in the past day if possible), and:
- Confirm the **All / Today** pills appear and toggle.
- Confirm **Today** shows Overdue + Today groups with counts; **All** shows the full list.
- Confirm completing/deleting a todo in Today updates the groups.
Stop dev with Ctrl-C.

Expected: toggling works, no console errors, the `import "/today.js"` resolves (200 in the network tab).

- [ ] **Step 9: Commit**

```bash
git add public/app.js public/styles.css public/sw.js
git commit -m "feat: All/Today view toggle with grouped daily summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 3: Switch cleanup model to Claude Haiku

**Files:**
- Modify: `src/claude.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change (only the model id string changes).

- [ ] **Step 1: Change the model id**

In `src/claude.js`, find:

```js
      model: "claude-sonnet-4-6",
```
and change to:
```js
      model: "claude-haiku-4-5",
```

- [ ] **Step 2: Confirm the Claude unit tests still pass (validation unchanged)**

Run: `npm run test:unit -- claude`
Expected: PASS (validation logic is unchanged; only the model string differs).

- [ ] **Step 3: Commit**

```bash
git add src/claude.js
git commit -m "perf: use Claude Haiku for todo cleanup (cheaper parsing)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 4: Deploy and verify in production

**Files:** none (operational).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all unit + workers tests pass.

- [ ] **Step 2: Deploy**

Run: `npm run deploy`
Expected: prints the live URL and a new Version ID.

- [ ] **Step 3: Production smoke test**

On `https://brain-notes.abhinay-natraj.workers.dev`:
- Add a todo with a time today (e.g. "call the bank at 3pm today") → confirm it's cleaned (Haiku) with a title + ⏰ chip.
- Tap **Today** → confirm it appears under the Today group; tap **All** → full list.
- If you have an overdue item, confirm it shows under Overdue.
- Optionally run `npx wrangler tail` and confirm there is NO `cleanup fallback` line (Haiku call succeeds).

---

## Self-Review Notes

- **Spec coverage:** Today view (Tasks 1–2), overdue+today grouping (Task 1 `buildToday`), All/Today toggle no-reload no-persist (Task 2 `view` state), reuse `todoEl` (Task 2 `todayGroup`), empty state (Task 2 `renderToday`), Haiku switch (Task 3), unit tests for bucketing (Task 1), visual verification + deploy (Tasks 2, 4). All covered.
- **Path correction vs spec:** the spec named `src/today.js`; corrected to `public/today.js` because only `public/` is browser-served and `app.js` imports it client-side. The unit test imports `../../public/today.js`. Logic is identical to the spec.
- **Type consistency:** `todoWhen`, `bucketForToday(whenIso, nowIso)`, `buildToday(todos, nowIso)` names/signatures match across Task 1 (definition + tests) and Task 2 (consumption). `renderCurrentView`/`view`/`renderToday` consistent within Task 2.
- **No placeholders:** every code step has full code; commands have expected output.
- **SW cache bump** (Task 2 Step 7) ensures installed PWAs fetch the new `today.js` + `app.js` rather than stale v1 cache.
