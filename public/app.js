// Brain Notes — single-page client. Capture, list, status, theme.

const app = document.getElementById("app");
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localNow = () =>
  new Date().toLocaleString("sv").replace(" ", "T").slice(0, 19); // "YYYY-MM-DDTHH:mm:ss" local

// ---------- tiny helpers ----------
const ICONS = {
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
};

function el(tag, attrs = {}, html) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  if (html != null) n.innerHTML = html;
  return n;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", { class: "toast" }); document.body.appendChild(t); }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    ...opts,
  });
  if (res.status === 401) {
    renderLogin();
    throw new Error("unauthorized");
  }
  return res;
}

// ---------- theme ----------
const THEME_ORDER = ["system", "light", "dark"];
const THEME_LABEL = { system: "Auto", light: "Light", dark: "Dark" };
function applyTheme(name) {
  const dark =
    name === "dark" ||
    (name === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
function currentTheme() { return localStorage.getItem("theme") || "system"; }
function cycleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme()) + 1) % THEME_ORDER.length];
  localStorage.setItem("theme", next);
  applyTheme(next);
  const btn = document.getElementById("themeBtn");
  if (btn) btn.textContent = THEME_LABEL[next];
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentTheme() === "system") applyTheme("system");
});

// ---------- date formatting for chips ----------
function fmtWhen(iso) {
  // iso is "YYYY-MM-DDTHH:mm:ss" (local, naive)
  const [d, t] = iso.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const time = (t || "").slice(0, 5);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const today = localNow().slice(0, 10);
  const datePart = d === today ? "Today" : `${months[m - 1]} ${day}`;
  const hasTime = time && time !== "00:00";
  return hasTime ? `${datePart}, ${time}` : datePart;
}

const RECUR_LABEL = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly",
  weekdays: "Weekdays", every_n_days: "Repeats",
};

// ---------- todo rendering ----------
function todoChips(t) {
  const chips = [];
  if (t.reminder_at) chips.push(`<span class="chip accent">⏰ ${escapeHtml(fmtWhen(t.reminder_at))}</span>`);
  else if (t.due_at) chips.push(`<span class="chip">📅 ${escapeHtml(fmtWhen(t.due_at))}</span>`);
  if (t.recurrence) {
    try {
      const r = JSON.parse(t.recurrence);
      chips.push(`<span class="chip">🔁 ${escapeHtml(RECUR_LABEL[r.kind] || "Repeats")}</span>`);
    } catch {}
  }
  return chips.length ? `<div class="chips">${chips.join("")}</div>` : "";
}

function todoEl(t) {
  const done = t.status === "done";
  const row = el("div", { class: "todo" + (done ? " done" : "") });
  row.dataset.id = t.id;
  row.innerHTML = `
    <button class="check" aria-label="${done ? "Mark as open" : "Mark as done"}">${ICONS.check}</button>
    <div class="todo-main">
      <div class="todo-title">${escapeHtml(t.title)}</div>
      ${t.notes ? `<div class="todo-notes">${escapeHtml(t.notes)}</div>` : ""}
      ${todoChips(t)}
    </div>
    <div class="row-actions">
      <button class="ghostbtn del" aria-label="Delete">${ICONS.trash}</button>
    </div>`;
  row.querySelector(".check").addEventListener("click", () => toggleStatus(t, row));
  row.querySelector(".del").addEventListener("click", () => deleteTodo(t, row));
  return row;
}

// ---------- data actions ----------
let todos = [];

async function loadTodos() {
  const res = await api("/api/todos");
  todos = await res.json();
  renderList();
}

function renderList() {
  const list = document.getElementById("list");
  if (!list) return;
  const open = todos.filter((t) => t.status === "open");
  const done = todos.filter((t) => t.status === "done");
  list.innerHTML = "";

  if (!open.length && !done.length) {
    list.appendChild(el("div", { class: "empty" },
      `<div class="empty-mark">“</div><p>Nothing yet. Jot a thought above and it becomes a todo.</p>`));
    return;
  }

  if (open.length) {
    const wrap = el("div", { class: "list" });
    open.forEach((t) => wrap.appendChild(todoEl(t)));
    list.appendChild(wrap);
  }
  if (done.length) {
    list.appendChild(el("div", { class: "section-label" }, "Done"));
    const wrap = el("div", { class: "list" });
    done.forEach((t) => wrap.appendChild(todoEl(t)));
    list.appendChild(wrap);
  }
}

async function submitCapture(text) {
  const list = document.getElementById("list");
  // optimistic pending row at the top
  const pending = el("div", { class: "todo pending" }, `
    <div class="check"></div>
    <div class="todo-main"><div class="todo-title"><span class="shimmer">cleaning up…</span></div></div>`);
  // if the list is showing the empty state, clear it first
  if (list.querySelector(".empty")) list.innerHTML = "";
  let firstList = list.querySelector(".list");
  if (!firstList) { firstList = el("div", { class: "list" }); list.prepend(firstList); }
  firstList.prepend(pending);

  try {
    await api("/api/todos", {
      method: "POST",
      body: JSON.stringify({ raw_text: text, now: localNow(), timezone: TZ }),
    });
    await loadTodos();
  } catch (e) {
    pending.remove();
    if (e.message !== "unauthorized") toast("Couldn’t save that — try again.");
  }
}

async function toggleStatus(t, row) {
  const next = t.status === "done" ? "open" : "done";
  // animate the row out, then refresh (it moves between sections)
  row.classList.add("is-leaving");
  try {
    await api(`/api/todos/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    await loadTodos();
    if (next === "done") toast("Done ✓");
  } catch (e) {
    row.classList.remove("is-leaving");
    if (e.message !== "unauthorized") toast("Couldn’t update.");
  }
}

async function deleteTodo(t, row) {
  row.classList.add("is-leaving");
  try {
    await api(`/api/todos/${t.id}`, { method: "DELETE" });
    await loadTodos();
  } catch (e) {
    row.classList.remove("is-leaving");
    if (e.message !== "unauthorized") toast("Couldn’t delete.");
  }
}

// ---------- views ----------
function renderApp() {
  app.innerHTML = `
    <header class="topbar">
      <h1 class="wordmark">Brain Notes<span class="dot">.</span></h1>
      <div class="toolbar">
        <button class="iconbtn" id="notifyBtn">Reminders</button>
        <button class="iconbtn" id="themeBtn">${THEME_LABEL[currentTheme()]}</button>
        <button class="iconbtn" id="logoutBtn">Sign out</button>
      </div>
    </header>

    <form class="capture" id="capture" autocomplete="off">
      <div class="capture-field">
        <textarea id="raw" rows="1" placeholder="Remind me to call the dentist next Tuesday afternoon…"></textarea>
        <button class="send" type="submit" id="sendBtn" aria-label="Add todo">${ICONS.send}</button>
      </div>
      <p class="hint">Write it however it comes out — it’ll be tidied into a crisp todo.</p>
    </form>

    <main id="list"></main>`;

  const ta = document.getElementById("raw");
  const form = document.getElementById("capture");

  // auto-grow textarea
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px"; };
  ta.addEventListener("input", grow);
  // Enter submits, Shift+Enter newline
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    ta.value = "";
    grow();
    submitCapture(text);
  });

  document.getElementById("themeBtn").addEventListener("click", cycleTheme);
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    renderLogin();
  });
  document.getElementById("notifyBtn").addEventListener("click", () => {
    if (typeof enablePush === "function") enablePush();
    else toast("Reminders need the installed app.");
  });

  ta.focus();
  loadTodos();
}

function renderLogin() {
  app.innerHTML = `
    <div class="auth">
      <h1 class="wordmark">Brain Notes<span class="dot">.</span></h1>
      <p class="auth-tag">A thought in, a clear todo out.</p>
      <form id="login">
        <input id="email" type="email" inputmode="email" autocomplete="email"
          placeholder="you@example.com" required />
        <button class="btn-primary" type="submit">Send me a sign-in link</button>
      </form>
      <p class="auth-msg" id="authMsg"></p>
    </div>`;

  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    if (!email) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const msg = document.getElementById("authMsg");
      msg.textContent = "Check your inbox for a sign-in link.";
      msg.classList.add("sent");
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById("email").focus();
}

// ---------- PWA: service worker + push ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; detect by touch.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  // iOS only delivers Web Push to a home-screen-installed PWA (iOS 16.4+).
  if (isIOS() && !isStandalone()) {
    toast("Add Brain Notes to your Home Screen first, then enable reminders.");
    return;
  }
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast("Reminders aren’t supported on this browser.");
    return;
  }
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSW());
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Reminders need notification permission."); return; }

    const keyRes = await fetch("/api/push/vapid-public-key", { credentials: "same-origin" });
    const { key } = await keyRes.json();
    if (!key) { toast("Reminders aren’t configured on the server yet."); return; }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    const subRes = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    if (!subRes.ok) { toast("Couldn’t save the subscription — try again."); return; }
    toast("Reminders enabled ✓");
  } catch (e) {
    toast("Couldn’t enable reminders.");
  }
}

// ---------- boot ----------
(async () => {
  if ("serviceWorker" in navigator && typeof registerSW === "function") {
    try { await registerSW(); } catch {}
  }
  try {
    const res = await fetch("/api/todos", { credentials: "same-origin" });
    if (res.status === 401) renderLogin();
    else { renderApp(); }
  } catch {
    renderLogin();
  }
})();
