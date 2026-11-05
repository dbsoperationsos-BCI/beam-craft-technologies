/**
 * The 12-hour picker's arithmetic, kept out of the component so it can be tested without one.
 *
 * The field shows an hour (1-12), a minute and AM / PM; the value it holds and hands back is always
 * `HH:MM` on the 24-hour clock, which is what every form and the server already read. 12 AM is
 * midnight (00) and 12 PM is noon (12) - the two cases a naive conversion gets wrong.
 */

/** The dial's hour labels, clockwise from the top: 12, 1, 2 ... 11. */
export const HOURS = ["12", ...Array.from({ length: 11 }, (_, index) => String(index + 1))];
/** The dial's minute labels, every five minutes from the top. Any minute can still be picked. */
export const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

/*
 * ── The dial ──────────────────────────────────────────────────────────────────────────────────
 *
 * Angles are degrees clockwise from twelve o'clock, which is how a clock is read: 90° is 3, 180° is
 * 6. `dx` / `dy` are the pointer's offset from the dial's centre in screen terms, so `dy` grows
 * downwards.
 */

/** Where the pointer is on the dial, as an angle in [0, 360). */
export function angleOf(dx, dy) {
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

/** The hour nearest an angle, "1"-"12": each hour owns 30°, centred on its number. */
export function hourAt(angle) {
  return String(Math.round(angle / 30) % 12 || 12);
}

/** The minute nearest an angle, "00"-"59": each minute owns 6°. */
export function minuteAt(angle) {
  return String(Math.round(angle / 6) % 60).padStart(2, "0");
}

/** The angle a chosen hour or minute points the hand at. */
export function angleFor(mode, part) {
  const number = Number(part) || 0;
  return mode === "hour" ? (number % 12) * 30 : number * 6;
}

/** A point on a circle of `radius` round `centre`, at `angle` - where a label or the hand's end sits. */
export function pointAt(angle, radius, centre) {
  const radians = (angle * Math.PI) / 180;
  return { x: centre + radius * Math.sin(radians), y: centre - radius * Math.cos(radians) };
}

/** An hour or minute typed by hand, checked: `"7"` is 7 o'clock, `"13"` is no hour at all. */
export function typedHour(text) {
  const hour = Number(String(text).trim());
  return Number.isInteger(hour) && hour >= 1 && hour <= 12 ? String(hour) : "";
}

export function typedMinute(text) {
  const trimmed = String(text).trim();
  const minute = Number(trimmed);
  return trimmed !== "" && Number.isInteger(minute) && minute >= 0 && minute <= 59 ? String(minute).padStart(2, "0") : "";
}

/** `"14:05"` as `{ hour: "2", minute: "05", meridiem: "PM" }`; anything unreadable as empty parts. */
export function partsOf(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { hour: "", minute: "", meridiem: "" };
  const hours = Number(match[1]);
  return { hour: String(hours % 12 || 12), minute: match[2], meridiem: hours < 12 ? "AM" : "PM" };
}

/** The parts back as `"HH:MM"` on the 24-hour clock, or `""` until an hour has been chosen. */
export function valueOf({ hour, minute, meridiem }) {
  if (!hour) return "";
  const hours = (Number(hour) % 12) + (meridiem === "PM" ? 12 : 0);
  return `${String(hours).padStart(2, "0")}:${minute || "00"}`;
}

/** How the time reads on the field: `6:30 PM`, or `""` for none. */
export function displayOf(value) {
  const { hour, minute, meridiem } = partsOf(value);
  return hour ? `${hour}:${minute} ${meridiem}` : "";
}
