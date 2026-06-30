// Works on UTC instant ISO strings (e.g. "2026-06-29T16:00:00.000Z"); also
// tolerates the older naive form. Date math uses UTC accessors and the result
// is emitted as a UTC ISO instant so recurrence preserves the timezone contract.

function parse(iso) {
  const [d, t] = iso.replace("Z", "").split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m, s] = (t || "00:00:00").split(":").map((v) => parseInt(v, 10));
  return new Date(Date.UTC(Y, M - 1, D, h, m, s || 0));
}

function format(dt) {
  return dt.toISOString();
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
    case "monthly": {
      // setUTCMonth overflows (Jan 31 + 1mo -> Mar 3). Clamp to the last day of
      // the target month so e.g. the 31st becomes the 28th/30th, not next month.
      const day = dt.getUTCDate();
      dt.setUTCDate(1);
      dt.setUTCMonth(dt.getUTCMonth() + interval);
      const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      dt.setUTCDate(Math.min(day, lastDay));
      break;
    }
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
