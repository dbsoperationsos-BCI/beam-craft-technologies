/**
 * Whether a client link's failure is an expired link, for the shared expired page.
 *
 * Every client link that can lapse - a quotation, a Photo Selection gallery, a Signature Album, an
 * album proof, an event gallery - answers 410 once it has. That is all the page is told and all it
 * says: an expired link reveals nothing about what it was for, whose it was or when it lapsed, so
 * the answer is an empty marker, and any `expiredLink` details a server sends are never read. A
 * 410 is an expired link; anything else - an unknown or mistyped one - keeps its page's own "not
 * available".
 */
export function expiredLinkFrom(error) {
  const expired = Number(error?.status) === 410 || error?.expired === true;
  return expired ? {} : null;
}

/**
 * How long a link the server has just let through still has, as the page's expiry badge says it:
 * `{ label: "Expires in 4d 18h 32m" }` - days, hours and minutes to the link's stored expiry, a unit
 * left out where it is nought ("Expires in 3d 20m", "Expires in 12h 45m", "Expires in 42m"), and
 * "Expires in under 1m" for the last minute. The caller ticks `now` so it runs.
 *
 * The same answer comes split for the badge's two lines as well: `lead` ("Expires in 3d" - the days,
 * where there are any) over `rest` ("22h 39m"), so the badge stays narrow. Nothing is counted twice;
 * the lines are the label's own pieces, and `rest` is "" when only whole days are left.
 *
 * Only ever read on a link that opened, so it decides nothing: when a link has lapsed the server
 * answers 410 and the shared expired page is shown instead. Null where there is no readable expiry,
 * or where it has already passed (the server is the one that says so), so nothing is shown.
 */
export function linkTimeLeft(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const left = new Date(expiresAt).getTime() - new Date(now).getTime();
  if (Number.isNaN(left) || left <= 0) return null;
  const minutes = Math.floor(left / 60000);
  if (minutes < 1) return { label: "Expires in under 1m", lead: "Expires in", rest: "under 1m" };
  const parts = [[Math.floor(minutes / 1440), "d"], [Math.floor((minutes % 1440) / 60), "h"], [minutes % 60, "m"]]
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`);
  const days = parts[0].endsWith("d") ? parts[0] : "";
  return {
    label: `Expires in ${parts.join(" ")}`,
    lead: days ? `Expires in ${days}` : "Expires in",
    rest: (days ? parts.slice(1) : parts).join(" "),
  };
}
