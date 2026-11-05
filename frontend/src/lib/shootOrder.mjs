/**
 * The order a project's shoots are listed in.
 *
 * - Date order (`shootsByDate`): the earliest first, a shoot with no date yet after every dated one, and
 *   shoots on the same day in the order they already had. The server lists them the same way
 *   (`backend/src/services/shootOrder.js`); this keeps a list in that order while it is being changed on
 *   screen - a shoot added, a date edited - before it is read back. `dateOf` reads a shoot's date where
 *   it is not `dateCreated` (a production row's is `shootDate`).
 * - The Shoot List's dragged order (`orderShoots`, `reorderShoots`): the forms that edit a project's
 *   shoots (Bookings & Converted, Create / Edit / Start Project) let the shoots be dragged into the
 *   order the studio wants. A shoot dragged into place carries its position (`sortOrder`); those come
 *   first, in that order, and any shoot without one - every shoot until the list is first arranged, or
 *   one added afterwards - follows in date order. Only that list: Pre Production, Production, the
 *   calendar and Image Selection keep listing shoots by date.
 * - `shootListOrder` is the two together, what the Shoot List shows: date order, then the dragged
 *   positions on top - so a list nobody has arranged is plain date order, and one that was arranged
 *   keeps it when a shoot is added or re-dated.
 */
const timeOf = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export function shootsByDate(shoots, dateOf = (shoot) => shoot?.dateCreated) {
  return (Array.isArray(shoots) ? shoots : [])
    .map((shoot, index) => ({ shoot, index, time: timeOf(dateOf(shoot)) }))
    .sort((a, b) => (a.time === null) - (b.time === null) || (a.time ?? 0) - (b.time ?? 0) || a.index - b.index)
    .map((entry) => entry.shoot);
}

const positionOf = (shoot) => (Number.isInteger(shoot?.sortOrder) ? shoot.sortOrder : Number.POSITIVE_INFINITY);

/** The shoots in their Shoot List order. A stable sort, so shoots without a position keep the order they came in. */
export function orderShoots(shoots) {
  return (Array.isArray(shoots) ? shoots : [])
    .map((shoot, index) => ({ shoot, index }))
    .sort((left, right) => positionOf(left.shoot) - positionOf(right.shoot) || left.index - right.index)
    .map(({ shoot }) => shoot);
}

/** What the Shoot List shows: date order, with any dragged positions on top of it. */
export function shootListOrder(shoots, dateOf) {
  return orderShoots(shootsByDate(shoots, dateOf));
}

/**
 * The shoots in the order `keys` names, each stamped with its new position. `keyOf` reads a shoot's key
 * the way the list does; a shoot `keys` leaves out keeps its place after the named ones, as the server
 * orders it.
 */
export function reorderShoots(shoots, keys, keyOf = (shoot) => shoot.id) {
  const byKey = new Map(shoots.map((shoot) => [keyOf(shoot), shoot]));
  const named = [...new Set(keys)].filter((key) => byKey.has(key)).map((key) => byKey.get(key));
  const rest = shoots.filter((shoot) => !named.includes(shoot));
  return [...named, ...rest].map((shoot, index) => ({ ...shoot, sortOrder: index }));
}
