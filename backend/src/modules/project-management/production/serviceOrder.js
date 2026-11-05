/*
 * The studio's own order for a shoot's services, which is the order they are crewed in.
 *
 * The order is the service master data's (`sortOrder`, dragged in Settings -> Project -> Services),
 * not the order somebody booked them in: the Production Schedule sheet, the plan's Service Crew and
 * the plan's own checklist are read the same way whatever a project happened to add first. It is
 * held there rather than as a list of names here, so renaming a service keeps its place and the
 * studio can reorder without a release.
 *
 * It lives in its own file because both `read.js` and `planCompleteness.js` order by it, and
 * `read.js` already requires `planCompleteness` - putting it in either would be a circular import.
 *
 * A read that orders by this has to select the service's `sortOrder` beside its id, or every
 * service ranks the same and the order falls back to the name.
 */

/*
 * A service that is not in Settings has no order to read and goes last - never first, where a null
 * would sort it - and that is where it already reads as the one nobody can be assigned to.
 */
const studioServiceRank = (service) => (service?.serviceDefinition ? service.serviceDefinition.sortOrder : Number.MAX_SAFE_INTEGER);

/*
 * The services in that order, as a new array: the caller's own list is left as it was.
 *
 * Services sharing a position fall back to their name, compared as plain strings rather than by the
 * host's locale, so the sheet reads the same on the VPS as it does on a laptop and never shuffles
 * between two reads.
 */
const byStudioOrder = (one, other) => {
  const ranked = studioServiceRank(one) - studioServiceRank(other);
  if (ranked !== 0) return ranked;
  const left = String(one.serviceName || "");
  const right = String(other.serviceName || "");
  return left < right ? -1 : left > right ? 1 : 0;
};

const inStudioOrder = (services = []) => [...services].sort(byStudioOrder);

module.exports = { inStudioOrder, studioServiceRank };
