/**
 * The client gallery's People tab, decided without the DOM: which tabs the gallery home offers and
 * in what order, what the People tab shows for a given answer from the server, which folder cards
 * it offers for the chosen people, and how those people are named in a heading.
 */

// The gallery home's tabs, in the order they are drawn. Selected carries its count beside it.
export const HOME_TABS = ["all", "people", "selected"];

// How many people may be chosen together - the same number the server accepts on `?personId=`.
// Several people mean the photos all of them are in together, and each is its own condition on
// the query, so the rail stops at ten rather than letting a press cost the server fifty.
export const MAX_PEOPLE = 10;

/**
 * The chosen people after a press on `personId`: pressed again they leave, otherwise they join -
 * unless the rail is full, when the set is returned as it was and `refused` says so.
 */
export function togglePerson(current = [], personId) {
  if (current.includes(personId)) return { next: current.filter((id) => id !== personId), refused: false };
  if (current.length >= MAX_PEOPLE) return { next: current, refused: true };
  return { next: [...current, personId], refused: false };
}

/**
 * What the People tab has to show.
 *
 * - `loading`: nothing has come back yet.
 * - `unavailable`: face recognition is switched off for this gallery.
 * - `processing`: nobody found yet, but the worker still has photos to look at.
 * - `empty`: the photos were looked at and nobody was found.
 * - `ready`: people to choose from - `processing` may still be true beside it, when more may come.
 */
export function peopleState({ loaded = false, available = true, processing = false, people = [] } = {}) {
  if (!loaded) return "loading";
  if (people.length) return "ready";
  if (!available) return "unavailable";
  if (processing) return "processing";
  return "empty";
}

/**
 * The people the rail draws: the page the server sent for it, plus anybody chosen who is not on
 * that page.
 *
 * The rail is only ever handed the first few people - a gallery may hold thousands, and the rest
 * are reached through the picker - so somebody chosen from deep in that list would otherwise be
 * filtering the gallery from behind More, where the client cannot see them to take them out. They
 * are looked up in `known`, which is everybody the browser has been told about so far, and the
 * whole list is put back in the gallery's own numbering so the rail reads in order.
 */
export function railPeople(page = [], activePersonIds = [], known = new Map()) {
  const byId = new Map(page.map((person) => [person.id, person]));
  for (const id of activePersonIds) {
    if (byId.has(id)) continue;
    const person = known.get?.(id);
    if (person) byId.set(id, person);
  }
  const numberOf = (person) => Number(String(person.label || "").match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
  return [...byId.values()].sort((left, right) => numberOf(left) - numberOf(right));
}

/**
 * The chosen people named in the order they were chosen - "Person 1, Person 3" - for the heading
 * of a folder opened from the People tab. Empty with nobody chosen, and an id the list no longer
 * has is left out.
 */
export function personFilterLabel(activePersonIds = [], people = []) {
  return activePersonIds.map((id) => people.find((person) => person.id === id)?.label).filter(Boolean).join(", ");
}

/**
 * How many of the not-chosen people the People rail leads with, beside the chosen ones it always
 * shows.
 *
 * `slots` is how many items fit across the strip (null until it has been measured), `total` how
 * many people the gallery found, `held` how many of them the rail was handed, and `chosen` how many
 * are chosen. When everybody fits - and the rail holds everybody - they are all shown and there is
 * no More. Otherwise More takes one of the slots and the people the rest, so it only ever stands for
 * people who genuinely did not fit. All is outside the strip and is never one of the slots.
 */
export function railSlotsForRest({ slots = null, total = 0, held = 0, chosen = 0, fallback = 0 } = {}) {
  if (slots === null) return Math.max(0, fallback - chosen);
  if (total <= slots && held >= total) return Math.max(0, held - chosen);
  // Never more than the rail holds: on a screen with room past its first page, every held person is
  // shown and More stands for the ones not yet fetched.
  return Math.max(0, Math.min(slots - 1, held) - chosen);
}
