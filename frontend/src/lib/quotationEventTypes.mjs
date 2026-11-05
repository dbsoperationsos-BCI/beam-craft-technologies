/**
 * The Event Type box on the client's quotation header: the quotation's Main Event, and how many
 * other events it has - "Wedding +2 events" - rather than a list of them.
 *
 * Derived from the shoots the quotation carries, never a field kept by hand, so adding, removing or
 * reordering an event, or moving the Main Event, changes it with nothing else to update. Kept free of
 * React so `node --test` can hold the rules.
 */

/**
 * The event types to name, in the order they are named: the Main Event first, then every other
 * event in the quotation's own order, each type once (compared without case or surrounding space).
 * A quotation raised before events could be marked main starts with its first event instead.
 */
export function eventTypeNames(shoots = []) {
  const list = Array.isArray(shoots) ? shoots : [];
  const main = list.find((shoot) => shoot?.isMainEvent) || null;
  const ordered = main ? [main, ...list.filter((shoot) => shoot !== main)] : list;
  const seen = new Set();
  const names = [];
  for (const shoot of ordered) {
    const name = String(shoot?.shoot ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * How many events the quotation actually has - every event with a type, duplicates included. The
 * "+N" is counted against this, not against the de-duplicated names: two Bride Haldi events and a
 * Bride Making are three events, so one name shown leaves "+2", never "+1".
 */
export function eventCount(shoots = []) {
  return (Array.isArray(shoots) ? shoots : []).filter((shoot) => String(shoot?.shoot ?? "").trim()).length;
}

/**
 * How many events are left unnamed once `shown` names are on the line: the quotation's events less
 * one for each name shown. Never below nought, and never below what the names left out stand for.
 */
export function remainingEvents(names = [], shown = names.length, total = names.length) {
  const count = Math.max(1, Math.min(names.length, Math.floor(Number(shown) || 0)));
  return Math.max(0, Math.max(Number(total) || 0, names.length) - count);
}

/**
 * The Event Type line: the Main Event's type, then how many other events the quotation has -
 * "Wedding" for one event, "Wedding +1 event", "Wedding +2 events". The Main Event is the first of
 * `eventTypeNames`; `total` is the quotation's event count (`eventCount`), duplicates included, so
 * two Bride Haldi events and a Bride Making with Bride Haldi the Main Event read "Bride Haldi +2
 * events". The Main Event itself is never counted.
 */
export function mainEventTypeSummary(names = [], total = names.length) {
  if (!names.length) return "";
  const rest = remainingEvents(names, 1, total);
  return rest > 0 ? `${names[0]} +${rest} ${rest === 1 ? "event" : "events"}` : names[0];
}
