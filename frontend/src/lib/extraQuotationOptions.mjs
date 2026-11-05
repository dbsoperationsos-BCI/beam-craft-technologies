/**
 * The choice that means "not on the studio's list".
 *
 * A sentinel rather than a real service name, so it can never collide with one the studio adds
 * later — and it is never what gets saved: the typed name is sent in its place, because a row
 * reading "Others" tells a manager approving it nothing at all.
 */
export const OTHER_SERVICE = "__other__";

/**
 * Service / Deliverable's list: every active service, then every active deliverable, each under its
 * own heading in Project Settings' order, and Others last - the way out rather than an item. The
 * value is the name, which is what an extra stores; a name that is both a service and a deliverable
 * is offered once, under Services.
 */
export function serviceAndDeliverableOptions(services = [], deliverables = []) {
  const serviceNames = services || [];
  const deliverableNames = (deliverables || []).filter((name) => !serviceNames.includes(name));
  return [
    ...(serviceNames.length ? [{ heading: "Services" }, ...serviceNames.map((name) => ({ value: name, label: name }))] : []),
    ...(deliverableNames.length ? [{ separator: true }, { heading: "Deliverables" }, ...deliverableNames.map((name) => ({ value: name, label: name }))] : []),
    ...(serviceNames.length || deliverableNames.length ? [{ separator: true }] : []),
    { value: OTHER_SERVICE, label: "Others" },
  ];
}
