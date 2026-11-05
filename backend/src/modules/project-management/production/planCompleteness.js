const S = require("./steps");
const { LEAD, VENDOR_CONFIRMED } = require("./crew");
const { inStudioOrder } = require("./serviceOrder");

/**
 * The **mandatory** parts of a shoot's production plan, each filled or not - what its tile counts as
 * the plan's progress until the shoot reads **Planned**, and what the Plan tab lists as still to fill:
 *
 *   Production Coordinator
 *   Travel Mode        an outdoor shoot's; an indoor shoot has no travel at all
 *   Studio Start Date  an outdoor shoot's, when the crew leaves the studio; an indoor one never does
 *   Studio Start Time  the same
 *   each service       its Person - an employee or a vendor; where the person is a **vendor**, their
 *                      own answer too: a vendor Waiting has not held the day yet, so the service is
 *                      not planned until they are Confirmed
 *
 * And nothing else. The camera on each service, the chosen mode's detail (a number plate, the office
 * vehicle, a ticket, a line for Other), the assistants and the remarks are all part of the plan and
 * none of them is counted: a plan with its coordinator, its travel mode and a person on every service
 * is planned, and it used to read three quarters filled because a camera had not been picked yet.
 *
 * Submitting is its own gate (`plan.js`) and still asks for the chosen mode's detail, so a plan can
 * be complete here and not yet submitted - it reads Work in Progress until it is.
 *
 * `record` is a `project_production` row with its shoot's services (`shoot.postProductionAllocations`),
 * its crew (`serviceCrew`), and the counts of its team and tickets (`_count`).
 */
function planChecklist(record) {
  const items = [
    // No Production Team to fill: the team is the coordinator and whoever works each service.
    ["Production Coordinator", Boolean(record.productionCoordinatorEmployeeId || record.productionCoordinatorName)],
  ];
  // Mandatory on an outdoor shoot. Its detail - plate, vehicle, ticket, the line for Other - is asked
  // for when the plan is submitted, and is not one of the answers counted here.
  if (!S.indoorOf(record)) {
    items.push(["Travel Mode", Boolean(record.travelMode)]);
    // When the crew leaves the studio - the start of the journey, so the same shoots that travel.
    items.push(["Studio Start Date", Boolean(record.studioStartDate)]);
    items.push(["Studio Start Time", Boolean(record.studioStartTime)]);
  }
  const crew = record.serviceCrew || [];
  // The same order the sheet and the plan list them in, so "<Service> - Person" is asked for in
  // the order the person crewing the shoot is reading.
  for (const service of inStudioOrder(record.shoot?.postProductionAllocations)) {
    const lead = crew.find((entry) => entry.serviceDefinitionId && entry.serviceDefinitionId === service.serviceDefinitionId && entry.role === LEAD);
    items.push([`${service.serviceName} - Person`, Boolean(lead && (lead.employeeId || lead.vendorId))]);
    // A vendor's status is asked of the vendor alone - an employee in that seat has none to give.
    if (lead?.vendorId) items.push([`${service.serviceName} - Vendor confirmed`, lead.vendorStatus === VENDOR_CONFIRMED]);
  }
  return items;
}

/** What the plan still lacks, in the order it asks; empty once complete. */
const planMissing = (record) => planChecklist(record).filter(([, done]) => !done).map(([label]) => label);

/** How much of the plan is filled: `{ filled, total, percent }`. */
function planProgress(record) {
  const items = planChecklist(record);
  const filled = items.filter(([, done]) => done).length;
  return { filled, total: items.length, percent: items.length ? Math.round((filled / items.length) * 100) : 0 };
}

module.exports = { planChecklist, planMissing, planProgress };
