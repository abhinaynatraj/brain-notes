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
router.post("/api/auth/logout", (req, env) => logout(req, env));
router.get("/api/push/vapid-public-key", (req, env) => vapidPublicKey(req, env));

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
      const pub = router.match(request.method, pathname);
      if (pub) return pub.handler(request, env);

      const user = await getUserBySession(env, parseCookies(request).session);
      if (!user) return json({ error: "unauthorized" }, 401);

      const key = `${request.method} ${pathname}`;
      if (authed[key]) return authed[key](request, env, user);

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
