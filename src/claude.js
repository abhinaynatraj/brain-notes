const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const RECURRENCE_KINDS = new Set(["daily", "weekly", "monthly", "weekdays", "every_n_days"]);

function checkDate(v, field) {
  if (v == null) return null;
  if (typeof v !== "string" || !ISO_RE.test(v)) throw new Error(`bad ${field}`);
  return v;
}

export function validateCleanup(obj) {
  if (!obj || typeof obj.title !== "string" || !obj.title.trim()) {
    throw new Error("missing title");
  }
  let recurrence = null;
  if (obj.recurrence != null) {
    const r = obj.recurrence;
    if (!r.kind || !RECURRENCE_KINDS.has(r.kind)) throw new Error("bad recurrence kind");
    recurrence = { kind: r.kind, interval: Number(r.interval) || 1 };
    if (typeof r.weekday === "number") recurrence.weekday = r.weekday;
  }
  return {
    title: obj.title.trim(),
    notes: obj.notes != null ? String(obj.notes) : null,
    due_at: checkDate(obj.due_at, "due_at"),
    reminder_at: checkDate(obj.reminder_at, "reminder_at"),
    recurrence,
  };
}

export function fallbackCleanup(rawText) {
  return {
    title: rawText.trim().replace(/\s+/g, " "),
    notes: null, due_at: null, reminder_at: null, recurrence: null,
  };
}

const SYSTEM_PROMPT = `You turn a user's loose, rambling note into ONE crisp todo.
Return ONLY a JSON object with keys: title, notes, due_at, reminder_at, recurrence.

- title: a short, clean imperative action — a few words, not the whole sentence.
  Strip filler ("need to", "remember to", "ugh", "sometime"), strip the time
  phrase (it goes in reminder_at), and Capitalize It Normally.
  Example: "need to call the dentist sometime next tuesday afternoon ugh"
  -> title "Call the dentist".
- notes: any leftover detail worth keeping (location, person, context), else null.
- reminder_at: ALWAYS set this to "YYYY-MM-DDTHH:mm:ss" whenever the note mentions
  or implies ANY time or day — "tomorrow", "next tuesday", "at 6pm", "around noon",
  "before the 5:30 game", "this weekend". Pick a sensible concrete time
  (noon=12:00, afternoon=14:00, morning=09:00, evening=18:00, "before X"=30 min
  before X). Only use null if there is genuinely no time reference at all.
- due_at: set only when there is a deadline distinct from the reminder; usually null.
- recurrence: null, or {kind, interval, weekday?} where kind is one of
  daily, weekly, monthly, weekdays, every_n_days. Set it whenever the note repeats
  ("every day", "every other day", "weekly", "every monday").

Resolve all relative times against the provided "now" and timezone. Output JSON only, no prose.`;

export async function cleanupWithClaude(env, { rawText, now, timezone }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `now=${now} timezone=${timezone}\nNote: ${rawText}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no json in response");
  return validateCleanup(JSON.parse(match[0]));
}

// Convenience: never throws — falls back on any failure.
export async function cleanupOrFallback(env, args) {
  try {
    return await cleanupWithClaude(env, args);
  } catch (e) {
    // TEMP diagnostic: surface WHY the cleanup fell back (visible in `wrangler tail`).
    console.log("cleanup fallback:", e && e.message, "| key set:", !!env.ANTHROPIC_API_KEY);
    return fallbackCleanup(args.rawText);
  }
}
