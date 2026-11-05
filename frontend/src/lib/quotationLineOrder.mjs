/**
 * Putting one shoot's quotation lines in the order a person dragged them to, and copying a shoot's
 * lines onto its duplicate - over the one flat list the Quotation Generator keeps for all shoots.
 *
 * Order is the list's own order: the payload stores `services` and `deliverables` as arrays, and
 * the generator, the client's copy and its PDF all read a shoot's lines in array order. So setting
 * an order is rearranging the array, and it is saved, reopened and printed with no field of its own.
 * Kept free of React so `node --test` can hold it.
 */

/**
 * `rows` with the lines `ids` names put in that order, in the places those lines already held -
 * so every other shoot's lines stay exactly where they were. An id `ids` does not name is left
 * where it is; nothing is added or lost.
 */
export function reorderLines(rows, ids) {
  const wanted = new Set(ids);
  const byId = new Map(rows.filter((row) => wanted.has(row.id)).map((row) => [row.id, row]));
  const ordered = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
  if (ordered.length !== byId.size) return rows;
  let next = 0;
  return rows.map((row) => (wanted.has(row.id) ? ordered[next++] : row));
}

/**
 * The id a copied line takes on a duplicated shoot: the source shoot's id swapped for the copy's
 * where the line's id carries it (the generator builds them that way), and the copy's id appended
 * where it does not - unique either way, and recognisably the same line.
 */
function copiedId(id, fromShootId, toShootId) {
  const text = String(id || "");
  return fromShootId && text.includes(fromShootId) ? text.split(fromShootId).join(toShootId) : `${text}-${toShootId}`;
}

/**
 * The services and deliverables of shoot `fromShootId`, copied onto `toShootId`: every field as it
 * was - quantity, remarks, size, count, complimentary, price - with new ids, and a deliverable a
 * service brought (`autoFromService`) pointed at that service's copy, so removing the copied
 * service takes the copied deliverable with it and never the original's.
 */
export function copyShootLines({ services = [], deliverables = [] }, fromShootId, toShootId) {
  const serviceIds = new Map();
  const copiedServices = services.filter((row) => row.shootId === fromShootId).map((row) => {
    const id = copiedId(row.id, fromShootId, toShootId);
    serviceIds.set(row.id, id);
    return { ...structuredClone(row), id, shootId: toShootId };
  });
  const copiedDeliverables = deliverables.filter((row) => row.shootId === fromShootId).map((row) => ({
    ...structuredClone(row),
    id: copiedId(row.id, fromShootId, toShootId),
    shootId: toShootId,
    ...(row.autoFromService ? { autoFromService: serviceIds.get(row.autoFromService) || row.autoFromService } : {}),
  }));
  return { services: copiedServices, deliverables: copiedDeliverables };
}

/**
 * A quotation's shoots numbered by where they stand: Q-SID-0001 for the first, and so on.
 *
 * A Q-SID is the quotation's own label for a shoot, not an identity - its lines hang off the shoot's
 * `id`, and a project booked from the quotation gives its shoots their own ids - so it follows the
 * list, and the list never reads 0001, 0003, 0004 after a delete or a drag. A shoot already holding
 * its number is returned as the same object.
 */
export function numberQuoteShoots(shoots) {
  return shoots.map((shoot, index) => {
    const shootId = `Q-SID-${String(index + 1).padStart(4, "0")}`;
    return shoot.shootId === shootId ? shoot : { ...shoot, shootId };
  });
}
