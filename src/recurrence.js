// Works on naive local-time ISO strings "YYYY-MM-DDTHH:mm:ss".
// Date math uses UTC accessors on a Date built from the string to avoid
// the host timezone shifting the calendar day.

function parse(iso) {
  const [d, t] = iso.split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m, s] = (t || "00:00:00").split(":").map(Number);
  return new Date(Date.UTC(Y, M - 1, D, h, m, s || 0));
}

function format(dt) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}` +
    `T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

export function nextOccurrence(iso, recurrence) {
  if (!recurrence || !recurrence.kind) return null;
  const dt = parse(iso);
  const interval = recurrence.interval || 1;
  switch (recurrence.kind) {
    case "daily":
      dt.setUTCDate(dt.getUTCDate() + interval);
      break;
    case "every_n_days":
      dt.setUTCDate(dt.getUTCDate() + interval);
      break;
    case "weekly":
      dt.setUTCDate(dt.getUTCDate() + 7 * interval);
      break;
    case "monthly":
      dt.setUTCMonth(dt.getUTCMonth() + interval);
      break;
    case "weekdays": {
      do {
        dt.setUTCDate(dt.getUTCDate() + 1);
      } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
      break;
    }
    default:
      return null;
  }
  return format(dt);
}
