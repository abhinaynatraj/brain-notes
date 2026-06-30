// Pure bucketing for the Today summary view. Times are stored as UTC instants
// ("…Z"); we bucket by the viewer's LOCAL calendar date.

export function todoWhen(todo) {
  return todo.reminder_at || todo.due_at || null;
}

// Local "YYYY-MM-DD" for a UTC instant (or a Date / ms value).
export function localDateKey(value) {
  const dt = value instanceof Date ? value : new Date(value);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// nowMs is a millisecond timestamp (Date.now() in the browser).
export function bucketForToday(whenIso, nowMs) {
  if (!whenIso) return null;
  const when = new Date(whenIso);
  if (isNaN(when.getTime())) return null;
  const d = localDateKey(when);
  const today = localDateKey(new Date(nowMs));
  if (d < today) return "overdue";
  if (d === today) return "today";
  return null; // future local day
}

export function buildToday(todos, nowMs) {
  const overdue = [];
  const today = [];
  for (const t of todos) {
    if (t.status !== "open") continue;
    const bucket = bucketForToday(todoWhen(t), nowMs);
    if (bucket === "overdue") overdue.push(t);
    else if (bucket === "today") today.push(t);
  }
  const byWhen = (a, b) => {
    const wa = todoWhen(a) || "", wb = todoWhen(b) || "";
    return wa < wb ? -1 : wa > wb ? 1 : 0;
  };
  overdue.sort(byWhen);
  today.sort(byWhen);
  return { overdue, today };
}
