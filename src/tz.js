// Convert a naive local wall-clock ISO ("YYYY-MM-DDTHH:mm:ss") interpreted in
// `timeZone` into the equivalent UTC instant ("…Z"). DST-correct: the offset is
// computed for that specific date via Intl.

// Returns the offset (minutes) of `timeZone` at the given UTC instant.
function tzOffsetMinutes(utcDate, timeZone) {
  // Format the UTC instant as wall-clock time in the target zone, then diff.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(utcDate);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second)
  );
  // asUTC is the wall-clock time treated as if UTC; the difference from the real
  // instant is the zone's offset at that moment.
  return Math.round((asUTC - utcDate.getTime()) / 60000);
}

export function localToUtc(naiveLocalIso, timeZone) {
  if (!naiveLocalIso) return null;

  // Validate the timezone; fall back to UTC if unknown.
  let zone = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }

  // Parse the naive wall-clock components.
  const [d, t = "00:00:00"] = naiveLocalIso.split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m, s = 0] = t.split(":").map(Number);

  // First guess: treat the wall time as if it were UTC.
  const guess = Date.UTC(Y, M - 1, D, h, m, s);
  // Offset at that guessed instant, then correct. One correction is enough for
  // all real zones (offsets are whole minutes and stable across the small shift).
  const offset1 = tzOffsetMinutes(new Date(guess), zone);
  let utcMs = guess - offset1 * 60000;
  // Re-evaluate the offset at the corrected instant to handle DST edges.
  const offset2 = tzOffsetMinutes(new Date(utcMs), zone);
  if (offset2 !== offset1) {
    utcMs = guess - offset2 * 60000;
  }
  return new Date(utcMs).toISOString();
}
