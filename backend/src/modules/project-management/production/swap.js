const prisma = require("../../../config/db");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const { clientNameOf } = require("../../../services/projectClientNames");
const { accessFor, loadForWrite, fail, liveWhere } = require("./access");
const { logActivity } = require("./activity");
const { shootWindow, overlaps, minutesOf } = require("./availability");
const C = require("./crew");
const { shootServices, activeEmployees, refuseNonShooters, activeVendors } = require("./plan");
const { VENDOR_LABEL_SELECT, vendorLabel } = require("../../../services/vendorLabel");

/**
 * Two services' people swapped, from the Production Schedule's drag: the person on `from` goes to
 * `to` and the one on `to` (or nobody) comes back - on one shoot or across two. Both plans are the
 * caller's to change (`canEditPlan`), both seats are on their shoot's own services, and it is one
 * transaction with both production rows locked before anything is read - in one order, by shoot id,
 * so two swaps between the same shoots in opposite directions wait for each other rather than
 * deadlock - so a save beside it waits and is never overwritten from an older read.
 *
 * **An employee moved onto another shoot must be free at its time.** Every other shoot they are on at an
 * overlapping time - a service or its Assist - refuses the swap with a 409 naming that shoot, its
 * project and the service (`clash`), so the studio changes that one first; named only where the
 * caller may change that shoot's plan too, and otherwise said as "another shoot", so a swap is never
 * a way to learn where somebody is booked on a project the caller cannot see. The seat they are leaving
 * does not count against them, and neither does the shoot they are going to. An employee moved across
 * must also still be working, be in the Technical department and not already be on another service of the shoot
 * they go to - one employee works one service of a shoot; a vendor need only be active, as `savePlan`
 * holds them, and is never refused for a time clash or for working several services.
 *
 * Each seat keeps its cameras for an employee who takes it; a vendor takes none and starts on Waiting.
 * A person dropped on an empty service leaves their own empty - on a submitted plan too, which then
 * reads Work in Progress until it is filled again. Logged on both shoots.
 */
const SEAT_SELECT = {
  id: true, serviceDefinitionId: true, role: true, employeeId: true, vendorId: true, vendorStatus: true,
  employee: { select: { employeeName: true } }, vendor: { select: VENDOR_LABEL_SELECT },
};

const nameOf = (seat) => seat?.employee?.employeeName || vendorLabel(seat?.vendor) || null;

/*
 * One employee works one service of a shoot (`crew.doubledPerson`): an employee moved onto a shoot
 * where they already work another service is refused, named with that service. A vendor is not held to
 * it, and neither is a drone service (`crew.isDrone`) - moved onto one, or already on one.
 */
async function refuseDoubled(tx, seat, target, to) {
  if (!seat?.employeeId || C.isDrone(to.serviceName)) return;
  const seats = await tx.projectProductionServiceCrew.findMany({
    where: { productionId: target.id, role: C.LEAD, employeeId: seat.employeeId },
    select: { serviceDefinitionId: true, serviceDefinition: { select: { name: true } } },
  });
  const other = seats.find((row) => row.serviceDefinitionId !== to.serviceDefinitionId && !C.isDrone(row.serviceDefinition?.name));
  if (other) throw fail(400, `${nameOf(seat) || "This person"} is already on ${other.serviceDefinition?.name || "another service"} of that shoot. One person works one service.`);
}

/**
 * The first shoot among `others` that holds `employeeId` at a time overlapping `window`, with what they
 * are on there - leaving out the seat they are giving up (`leaving`). Pure, so the rule is tested alone.
 */
function clash(employeeId, window, others, leaving = null, caller = null) {
  for (const other of others) {
    if (!overlaps(window, shootWindow(other.shoot))) continue;
    const seats = (other.serviceCrew || []).filter((row) => row.employeeId === employeeId
      && !(leaving && other.id === leaving.productionId && row.serviceDefinitionId === leaving.serviceDefinitionId));
    const assisting = (other.teamMembers || []).some((row) => row.employeeId === employeeId);
    if (!seats.length && !assisting) continue;
    return {
      // Whether the caller may see which shoot it is: they may change its plan as well.
      visible: !caller || accessFor(other, caller).canEditPlan,
      shootId: other.shoot?.shootId || null,
      shoot: other.shoot?.shoot || null,
      eventId: other.salesProject?.eventId || null,
      project: clientNameOf(other.salesProject) || other.salesProject?.eventId || null,
      service: seats[0]?.serviceDefinition?.name || "Assist",
    };
  }
  return null;
}

/** The shoots an employee is on, on the days either side of `production`'s - the candidates for `clash`. */
async function shootsOf(tx, employeeId, production) {
  const window = shootWindow(production.shoot);
  if (!window) return { window: null, others: [] };
  const DAY = 24 * 60 * 60 * 1000;
  const day = window.start - minutesOf(production.shoot.eventStartTime) * 60 * 1000;
  const others = await tx.projectProduction.findMany({
    where: {
      id: { not: production.id },
      ...liveWhere,
      shoot: { deletedAt: null, dateCreated: { gte: new Date(day - DAY), lte: new Date(day + DAY) }, eventStartTime: { not: null }, eventEndTime: { not: null } },
      OR: [{ serviceCrew: { some: { employeeId } } }, { teamMembers: { some: { employeeId } } }],
    },
    select: {
      id: true,
      shoot: { select: { shootId: true, shoot: true, dateCreated: true, eventStartTime: true, eventEndTime: true } },
      salesProject: { select: { eventId: true, whatsappGroupName: true, productionManagerEmployeeId: true } },
      serviceCrew: { where: { employeeId }, select: { employeeId: true, serviceDefinitionId: true, serviceDefinition: { select: { name: true } } } },
      teamMembers: { where: { employeeId }, select: { employeeId: true } },
    },
  });
  return { window, others };
}

/** The 409 for somebody who is on another shoot at that time, with what the screen shows of it. */
function clashFailure(person, found) {
  if (!found.visible) {
    const error = fail(409, `${person} already has another shoot at that time. Change that first, then swap.`);
    error.details = { person };
    return error;
  }
  const where = [found.shoot && `${found.shoot}${found.shootId ? ` (${found.shootId})` : ""}`, found.project && `of ${found.project}`].filter(Boolean).join(" ");
  const error = fail(409, `${person} already has a shoot at that time: ${where || "another shoot"}, on ${found.service}. Change that first, then swap.`);
  const { visible, ...shown } = found;
  error.details = { person, ...shown };
  return error;
}

/** Locks a shoot's production row - a write, before any read, so this transaction reads it as it now is. */
const lock = (tx, shootId) => tx.projectProduction.updateMany({ where: { shootId, ...liveWhere }, data: { updatedAt: new Date() } });

async function productionFor(tx, shootId, caller) {
  const production = await loadForWrite(tx, shootId);
  if (!accessFor(production, caller).canEditPlan) throw fail(403, "Only this project's Production Manager can change the plan.");
  const shoot = await tx.projectShoot.findUnique({ where: { id: production.shootId }, select: { dateCreated: true, eventStartTime: true, eventEndTime: true } });
  return { ...production, shoot: { ...(production.shoot || {}), ...(shoot || {}) } };
}

async function seatOn(tx, production, serviceDefinitionId) {
  const services = await shootServices(tx, production);
  if (!services.has(serviceDefinitionId)) throw fail(400, "Swap people only on this shoot's own services.");
  const seat = await tx.projectProductionServiceCrew.findFirst({ where: { productionId: production.id, serviceDefinitionId, role: C.LEAD }, select: SEAT_SELECT });
  return { seat, serviceName: services.get(serviceDefinitionId) };
}

/** Somebody moved onto `target`'s shoot, checked as `savePlan` checks a newly named person - and for clashes. */
async function checkMover(tx, seat, target, leaving, statuses, caller) {
  if (!seat) return;
  if (seat.vendorId) { await activeVendors(tx, [seat.vendorId], "the services"); return; }
  await activeEmployees(tx, [seat.employeeId], "the services", statuses);
  await refuseNonShooters(tx, [seat.employeeId]);
  const { window, others } = await shootsOf(tx, seat.employeeId, target);
  const found = window ? clash(seat.employeeId, window, others, leaving, caller) : null;
  if (found) throw clashFailure(nameOf(seat) || "This person", found);
}

/** `seat`'s place filled by `person` (another seat's employee or vendor), or emptied where there is nobody. */
async function fill(tx, production, serviceDefinitionId, seat, person) {
  if (!person) {
    if (seat) await tx.projectProductionServiceCrew.delete({ where: { id: seat.id } });
    return;
  }
  const data = person.vendorId
    ? { employeeId: null, vendorId: person.vendorId, vendorStatus: person.vendorStatus || "WAITING" }
    : { employeeId: person.employeeId, vendorId: null, vendorStatus: null };
  if (seat) {
    await tx.projectProductionServiceCrew.update({ where: { id: seat.id }, data });
    // A vendor brings their own kit: the seat's cameras were the employee's who had it.
    if (person.vendorId) await tx.projectProductionServiceCrewCamera.deleteMany({ where: { crewId: seat.id } });
  } else {
    await tx.projectProductionServiceCrew.create({ data: { productionId: production.id, serviceDefinitionId, role: C.LEAD, ...data } });
  }
}

async function swapSeats(from, to, caller, deps = {}) {
  const { client = prisma, statuses = workingEmployeeStatuses } = deps;
  if (from.shootId === to.shootId && from.serviceDefinitionId === to.serviceDefinitionId) throw fail(400, "Drop the person on a different service.");
  return client.$transaction(async (tx) => {
    const sameShoot = from.shootId === to.shootId;
    for (const shootId of [...new Set([from.shootId, to.shootId])].sort()) await lock(tx, shootId);
    const source = await productionFor(tx, from.shootId, caller);
    const target = sameShoot ? source : await productionFor(tx, to.shootId, caller);
    const a = await seatOn(tx, source, from.serviceDefinitionId);
    const b = await seatOn(tx, target, to.serviceDefinitionId);
    if (!a.seat) throw fail(400, "There is nobody on that service to move.");

    if (!sameShoot) {
      await checkMover(tx, a.seat, target, { productionId: source.id, serviceDefinitionId: from.serviceDefinitionId }, statuses, caller);
      await checkMover(tx, b.seat, source, { productionId: target.id, serviceDefinitionId: to.serviceDefinitionId }, statuses, caller);
      await refuseDoubled(tx, a.seat, target, { serviceDefinitionId: to.serviceDefinitionId, serviceName: b.serviceName });
      await refuseDoubled(tx, b.seat, source, { serviceDefinitionId: from.serviceDefinitionId, serviceName: a.serviceName });
    }

    // A vendor moved within one shoot keeps their answer - it is the same shoot they confirmed; one moved
    // to another shoot starts on Waiting there.
    const moving = (seat) => seat && { employeeId: seat.employeeId, vendorId: seat.vendorId, vendorStatus: sameShoot ? seat.vendorStatus : null };
    await fill(tx, source, from.serviceDefinitionId, a.seat, moving(b.seat));
    await fill(tx, target, to.serviceDefinitionId, b.seat, moving(a.seat));

    const line = `${nameOf(a.seat) || "Someone"} (${a.serviceName}) swapped with ${nameOf(b.seat) || "nobody"} (${b.serviceName})`;
    await logActivity(tx, source.id, "PLAN_SAVED", `Changed: services crew - ${line}`, caller);
    if (!sameShoot) await logActivity(tx, target.id, "PLAN_SAVED", `Changed: services crew - ${line}`, caller);
    return { message: `${nameOf(a.seat) || "Someone"} and ${nameOf(b.seat) || "the empty seat"} swapped.` };
  });
}

module.exports = { swapSeats, clash };
