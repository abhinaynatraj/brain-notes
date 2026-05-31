// STUB — real implementation lands in Task 6 (Web Push + cron).
import { json } from "./util.js";

export async function vapidPublicKey() {
  return json({ key: "" });
}

export async function subscribePush(request, env, user) {
  return json({ ok: true }, 201);
}

export async function unsubscribePush(request, env, user) {
  return json({ ok: true });
}

export async function sendDueReminders(env, nowIso) {
  return 0;
}
