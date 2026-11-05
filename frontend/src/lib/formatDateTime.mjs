/**
 * A date and time in the studio's own format: "12 Sep 2026, 04:30 pm".
 *
 * One copy, because it is a rule about how this application writes a date rather than a detail of any one
 * screen - and because the awkward part is easy to get wrong twice.
 *
 * **`hourCycle: "h12"`, not `hour12: true`.** Under `en-GB`, `hour12` selects an 0-11 cycle, which renders
 * noon as "00:06 pm". That has been fixed once here rather than in each place a time is printed.
 */
export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h12",
  }).format(date);
}

export default formatDateTime;
