import { buildPushPayload } from "@block65/webcrypto-web-push";
import { json } from "./util.js";

export async function vapidPublicKey(request, env) {
  return json({ key: env.VAPID_PUBLIC_KEY });
}

export async function subscribePush(request, env, user) {
  const { subscription } = await request.json().catch(() => ({}));
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return json({ error: "bad subscription" }, 400);
  }
  // Avoid duplicate rows (and duplicate notifications) for the same endpoint.
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .bind(user.id, subscription.endpoint).run();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString()).run();
  return json({ ok: true }, 201);
}

export async function unsubscribePush(request, env, user) {
  const { endpoint } = await request.json().catch(() => ({}));
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .bind(user.id, endpoint).run();
  return json({ ok: true });
}

// Selects todos whose reminder is due and not yet sent. Returns rows.
export async function selectDueReminders(env, nowIso) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todos
     WHERE reminder_at IS NOT NULL AND reminder_at <= ?
       AND reminder_sent_at IS NULL AND status = 'open'`
  ).bind(nowIso).all();
  return results;
}

async function sendToUser(env, userId, payload) {
  const { results: subs } = await env.DB.prepare(
    "SELECT * FROM push_subscriptions WHERE user_id = ?"
  ).bind(userId).all();
  for (const sub of subs) {
    try {
      const built = await buildPushPayload(
        { data: payload, options: { ttl: 600 } },
        { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      );
      const res = await fetch(sub.endpoint, built);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
      }
    } catch (e) {
      console.error("push send failed", e);
    }
  }
}

export async function sendDueReminders(env, nowIso = new Date().toISOString()) {
  const due = await selectDueReminders(env, nowIso);
  for (const todo of due) {
    await sendToUser(env, todo.user_id, { title: "Brain Notes", body: todo.title, todoId: todo.id });
    await env.DB.prepare("UPDATE todos SET reminder_sent_at = ? WHERE id = ?")
      .bind(nowIso, todo.id).run();
  }
  return due.length;
}
