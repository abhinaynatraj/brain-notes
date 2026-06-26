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
