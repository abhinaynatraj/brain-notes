import { json } from "./util.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    // reminder cron wired in Task 6
  },
};
