const prisma = require("../../../config/db");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const { accessFor, loadForWrite, fail, liveWhere } = require("./access");
const { studioDateKey } = require("../../../services/studioTime");
const { logActivity } = require("./activity");
const { CAMERA_WHERE } = require("./read");
const C = require("./crew");
const { busyCrew } = require("./availability");
const S = require("./steps");
const T = require("./travel");
const { VENDOR_LABEL_SELECT, vendorLabel } = require("../../../services/vendorLabel");

/**
 * The Production Manager's plan for one shoot: save a draft, or submit it. Submitting needs a
 * Production Coordinator and is what opens the coordinator's steps; after that the manager can
 * still change the plan, and each save is logged.
 *
 * Every id the body adds is checked here, never trusted: employees must be working, a service's
 * camera must be in the Cameras category, its vendors active, and crew only on this shoot's own
 * services, which are not chosen here but read from the shoot (`read.js`). An id already on this
 * plan (and the coordinator it already names) is kept without being checked again, so an item retired since it was planned stays on the record and never blocks a
 * later save. A list that is sent replaces the whole list; one that is left out is not touched.
 *
 * Travel: each mode keeps only its own detail (`travel.js`), and a save that touches travel clears
 * the rest - tickets excepted, which are files and are never deleted by a mode change. A draft may
 * leave the detail empty; submitting, and every save of a submitted plan, needs it.
 */
const unique = (values = []) => [...new Set(values)];

async function activeEmployees(tx, ids, label, statuses) {
  const wanted = unique(ids);
  if (!wanted.length) return [];
  const found = await tx.employee.findMany({ where: { id: { in: wanted }, archivedAt: null, employmentStatus: { in: await statuses() } }, select: { id: true } });
  if (found.length !== wanted.length) throw fail(400, `Select only active employees for ${label}.`);
  return wanted;
}

const TRAVEL_FIELDS = ["travelMode", "travelModeOther", "vehicleNumberPlate", "travelVehicleAssetId", "ticketStatus"];

/**
 * The travel columns this save writes, with the detail the mode does not use cleared. The office
 * vehicle is checked only when it is newly named, so one retired since it was planned is kept.
 */
async function travelData(tx, production, input) {
  if (!TRAVEL_FIELDS.some((field) => input[field] !== undefined)) return {};
  const pick = (field, fallback) => (input[field] !== undefined ? input[field] : fallback);
  const mode = pick("travelMode", production.travelMode) || null;
  const data = {
    travelMode: mode,
    travelModeOther: mode === T.OTHER ? String(pick("travelModeOther", production.travelModeOther) || "").trim() || null : null,
    vehicleNumberPlate: T.PLATE_MODES.includes(mode) ? T.normalisePlate(pick("vehicleNumberPlate", production.vehicleNumberPlate)) : null,
    travelVehicleAssetId: mode === T.OFFICE_VEHICLE ? pick("travelVehicleAssetId", production.travelVehicleAssetId) || null : null,
    // Bus, Train and Flight only; any other mode keeps none.
    ticketStatus: T.takesTickets(mode) ? pick("ticketStatus", production.ticketStatus) || null : null,
  };
  if (data.travelVehicleAssetId && data.travelVehicleAssetId !== production.travelVehicleAssetId) {
    const vehicle = await tx.asset.findFirst({ where: { id: data.travelVehicleAssetId, ...T.VEHICLE_WHERE }, select: { id: true } });
    if (!vehicle) throw fail(400, "Choose the office vehicle from Asset Management's vehicles.");
  }
  return data;
}

/** This shoot's live services that can be crewed, as service definition id → name. */
async function shootServices(tx, production) {
  const rows = await tx.projectPostProductionAllocation.findMany({ where: { shootId: production.shootId, deletedAt: null, serviceDefinitionId: { not: null } }, select: { serviceDefinitionId: true, serviceName: true }, orderBy: { createdAt: "asc" } });
  return new Map(rows.map((row) => [row.serviceDefinitionId, row.serviceName]));
}

/**
 * Replaces who works each service. As with the lists below, a person or camera already on this
 * plan is kept without being checked again; only one newly named is.
 */
/** The name of `emp:<id>` / `ven:<id>`, for a refusal that names who it is about. */
async function personName(tx, person) {
  const [kind, raw] = String(person).split(":");
  const id = Number(raw);
  const row = kind === "ven"
    ? await tx.vendor.findUnique({ where: { id }, select: VENDOR_LABEL_SELECT })
    : await tx.employee.findUnique({ where: { id }, select: { employeeName: true } });
  return (kind === "ven" ? vendorLabel(row) : row?.employeeName) || "This person";
}

async function saveCrew(tx, production, crew, services, statuses, { keepAssistants = false } = {}) {
  const refusal = C.crewRefusal(crew, services);
  if (refusal) throw fail(400, refusal);
  const held = await tx.projectProductionServiceCrew.findMany({ where: { productionId: production.id }, select: { role: true, employeeId: true, vendorId: true, cameras: { select: { cameraAssetId: true } } } });
  const doubled = C.doubledPerson(crew, held, services);
  if (doubled) throw fail(400, `${await personName(tx, doubled)} is already on another service of this shoot. One person works one service.`);
  const heldPeople = new Set(held.map((row) => row.employeeId).filter(Boolean));
  const heldVendors = new Set(held.map((row) => row.vendorId).filter(Boolean));
  const heldCameras = new Set(held.flatMap((row) => (row.cameras || []).map((camera) => camera.cameraAssetId)));
  const newPeople = unique(crew.map((entry) => entry.employeeId).filter((id) => id && !heldPeople.has(id)));
  if (newPeople.length) await activeEmployees(tx, newPeople, "the services", statuses);
  if (newPeople.length) await refuseNonShooters(tx, newPeople);
  const newVendors = unique(crew.map((entry) => entry.vendorId).filter((id) => id && !heldVendors.has(id)));
  await activeVendors(tx, newVendors, "the services");
  const newCameras = unique(crew.flatMap((entry) => entry.cameraAssetIds || []).filter((id) => id && !heldCameras.has(id)));
  if (newCameras.length) {
    const found = await tx.asset.findMany({ where: { id: { in: newCameras }, ...CAMERA_WHERE }, select: { id: true } });
    if (found.length !== newCameras.length) throw fail(400, "Choose cameras from Asset Management's Cameras category.");
  }
  if (newPeople.length || newCameras.length) await refuseBusy(tx, production, newPeople, newCameras);
  const rows = crew.filter((entry) => entry.employeeId || entry.vendorId || entry.cameraAssetIds?.length).map((entry) => ({
    productionId: production.id,
    serviceDefinitionId: entry.serviceDefinitionId,
    role: entry.role,
    employeeId: entry.employeeId || null,
    vendorId: entry.vendorId || null,
    // A vendor is asked where they stand rather than for cameras, so the two never sit together: the
    // cameras belonged to the employee who had the seat, and a newly chosen vendor starts on Waiting.
    cameraAssetIds: entry.role === C.LEAD && !entry.vendorId ? unique(entry.cameraAssetIds || []) : [],
    vendorStatus: entry.role === C.LEAD && entry.vendorId ? entry.vendorStatus || "WAITING" : null,
  }));
  // A service's assistants from before Assist was the shoot's are cleared only by a save that sends
  // the shoot's Assist too - the form puts them there - so an older caller cannot lose them.
  await tx.projectProductionServiceCrew.deleteMany({ where: { productionId: production.id, ...(keepAssistants ? { role: C.LEAD } : {}) } });
  /*
   * One row at a time, where this used to be a `createMany`: a seat's cameras are rows of their own
   * now (`project_production_service_crew_camera`), and a nested create needs the seat's id - which
   * `createMany` does not hand back. At most ninety seats, inside the save's own transaction.
   */
  for (const { cameraAssetIds, ...row } of rows) {
    await tx.projectProductionServiceCrew.create({
      data: { ...row, ...(cameraAssetIds.length ? { cameras: { create: cameraAssetIds.map((cameraAssetId) => ({ cameraAssetId })) } } : {}) },
    });
  }
  return rows;
}

/**
 * A person newly put on a service must be in the **Technical** department (`crew.isShooter`) - the
 * Person and Assistant lists offer only them, and this holds the rule for any other way in.
 * Somebody already on this plan is never refused for it.
 *
 * Read through the department **link** rather than the text copy beside it on the employee row, so
 * a department renamed in Settings is still the department this asks about.
 */
async function refuseNonShooters(tx, newPeople) {
  const people = await tx.employee.findMany({ where: { id: { in: newPeople } }, select: { id: true, employeeName: true, departments: { select: { department: { select: { name: true } } } } } });
  const without = people.filter((person) => !C.isShooter((person.departments || []).map((link) => link.department?.name)));
  if (!without.length) return;
  throw fail(400, `${without.map((person) => person.employeeName || "Someone chosen").join(", ")} ${without.length > 1 ? "are" : "is"} not in the ${C.SHOOTER_DEPARTMENT} department, so cannot work a service. Set it on the employee's profile.`);
}

/**
 * A person or a camera newly put on a service that is already on another shoot at an overlapping
 * time is refused, named - the pickers leave them out, and this holds the rule for any other way in.
 * A camera is one object, so it is out on the other shoot exactly as its crew is. Anything already
 * on this plan is never refused for it (`availability.js` has the rule).
 */
async function refuseBusy(tx, production, newPeople, newCameras) {
  const shoot = await tx.projectShoot.findUnique({ where: { id: production.shootId }, select: { dateCreated: true, eventStartTime: true, eventEndTime: true } });
  const busy = await busyCrew(tx, { id: production.id, shoot });
  const people = newPeople.filter((id) => busy.employeeIds.includes(id));
  if (people.length) {
    const names = await tx.employee.findMany({ where: { id: { in: people } }, select: { employeeName: true } });
    throw fail(400, `${names.map((row) => row.employeeName).join(", ") || "Someone chosen"} ${people.length > 1 ? "are" : "is"} on another shoot at that time.`);
  }
  const cameras = newCameras.filter((id) => busy.cameraAssetIds.includes(id));
  if (!cameras.length) return;
  const names = await tx.asset.findMany({ where: { id: { in: cameras } }, select: { assetName: true, assetCode: true } });
  const named = names.map((row) => `${row.assetName} (${row.assetCode})`).join(", ") || "A camera chosen";
  throw fail(400, `${named} ${cameras.length > 1 ? "are" : "is"} on another shoot at that time.`);
}

/**
 * Only the vendors that are active, or a 400 naming where they were chosen for.
 *
 * Active is the whole test. A service's person or assistant used to ask for the vendor's "Can be a
 * production team member?" Yes as well, which kept a vendor the studio had just hired out of the list
 * until somebody went and ticked their record. The tick stays on the vendor as what it says about
 * them; it no longer decides who may be put on a shoot.
 */
async function activeVendors(tx, ids, label) {
  const wanted = unique(ids);
  if (!wanted.length) return [];
  const found = await tx.vendor.findMany({ where: { id: { in: wanted }, isDeleted: false, status: "ACTIVE" }, select: { id: true } });
  if (found.length !== wanted.length) throw fail(400, `Choose active vendors for ${label}.`);
  return wanted;
}

/**
 * The shoot's Assist - its Production Team - as the plan sends it, whole: employees and vendors who
 * assist on the shoot, not on any one service. The same checks a service's person gets: an employee
 * newly added is working here, is in the Technical department and is not on another shoot at that time; a
 * vendor is active. Nobody twice. Somebody kept by name alone (from the old sheet, since left) is not
 * the form's to show, so a save keeps them. Replaced in the plan's own transaction, so a save repeated
 * writes the same rows, never more.
 */
async function saveTeam(tx, production, team, statuses) {
  const entries = team.map((entry) => ({ employeeId: entry.employeeId || null, vendorId: entry.vendorId || null }));
  if (entries.some((entry) => Boolean(entry.employeeId) === Boolean(entry.vendorId))) throw fail(400, "Choose each assistant as one employee or one vendor.");
  const employees = entries.map((entry) => entry.employeeId).filter(Boolean);
  const vendors = entries.map((entry) => entry.vendorId).filter(Boolean);
  if (unique(employees).length !== employees.length || unique(vendors).length !== vendors.length) throw fail(400, "Choose each assistant once.");
  const held = await tx.projectProductionTeamMember.findMany({ where: { productionId: production.id }, select: { employeeId: true, vendorId: true } });
  const heldPeople = new Set(held.map((row) => row.employeeId).filter(Boolean));
  const heldVendors = new Set(held.map((row) => row.vendorId).filter(Boolean));
  const newPeople = employees.filter((id) => !heldPeople.has(id));
  if (newPeople.length) {
    await activeEmployees(tx, newPeople, "Assist", statuses);
    await refuseNonShooters(tx, newPeople);
    await refuseBusy(tx, production, newPeople, []);
  }
  await activeVendors(tx, vendors.filter((id) => !heldVendors.has(id)), "Assist");
  await tx.projectProductionTeamMember.deleteMany({ where: { productionId: production.id, OR: [{ employeeId: { not: null } }, { vendorId: { not: null } }] } });
  if (entries.length) await tx.projectProductionTeamMember.createMany({ data: entries.map((entry) => ({ productionId: production.id, ...entry })) });
  return entries;
}

async function savePlan(shootId, input, caller, deps = {}) {
  const { client = prisma, now = () => new Date(), statuses = workingEmployeeStatuses } = deps;
  return client.$transaction(async (tx) => {
    /*
     * A crew built from what is held (`saveSeat`) locks the row before anything is read: a plain read
     * first would fix this transaction's view of the plan, and a save that finished while this one
     * waited for the lock would then be overwritten from the older view.
     */
    if (typeof input.crew === "function") await tx.projectProduction.updateMany({ where: { shootId: String(shootId || ""), ...liveWhere }, data: { updatedAt: now() } });
    const production = await loadForWrite(tx, shootId);
    if (!accessFor(production, caller).canEditPlan) throw fail(403, "Only this project's Production Manager can change the plan.");

    const data = {};
    const changed = [];
    // A coordinator named from the old sheet who has since left (a name, no employee) is not one the
    // form can show, so it sends none: that is "unchanged", not "clear the coordinator".
    const namedOnly = !production.productionCoordinatorEmployeeId && Boolean(production.productionCoordinatorName);
    if (input.productionCoordinatorEmployeeId !== undefined && !(input.productionCoordinatorEmployeeId === null && namedOnly)) {
      if (input.productionCoordinatorEmployeeId === null) {
        if (production.planSubmittedAt) throw fail(400, "A submitted plan must keep a Production Coordinator.");
        data.productionCoordinatorEmployeeId = null;
      } else if (input.productionCoordinatorEmployeeId === production.productionCoordinatorEmployeeId) {
        data.productionCoordinatorEmployeeId = production.productionCoordinatorEmployeeId;
      } else {
        [data.productionCoordinatorEmployeeId] = await activeEmployees(tx, [input.productionCoordinatorEmployeeId], "Production Coordinator", statuses);
        // A real coordinator replaces the name that stood in for one.
        data.productionCoordinatorName = null;
      }
      changed.push("coordinator");
    }
    const travel = await travelData(tx, production, input);
    if (Object.keys(travel).length) { Object.assign(data, travel); changed.push("travel"); }
    if (input.studioStartDate !== undefined || input.studioStartTime !== undefined) {
      if (input.studioStartDate !== undefined) data.studioStartDate = input.studioStartDate ? new Date(`${input.studioStartDate}T00:00:00.000Z`) : null;
      if (input.studioStartTime !== undefined) data.studioStartTime = input.studioStartTime || null;
      changed.push("studio start");
    }
    if (input.remarks !== undefined) { data.remarks = input.remarks || null; changed.push("remarks"); }

    const coordinator = (data.productionCoordinatorEmployeeId !== undefined ? data.productionCoordinatorEmployeeId : production.productionCoordinatorEmployeeId)
      || (data.productionCoordinatorName !== undefined ? data.productionCoordinatorName : production.productionCoordinatorName);
    const submitting = Boolean(input.submit) && !production.planSubmittedAt;
    if (submitting && !coordinator) throw fail(400, "Choose a Production Coordinator before submitting the plan.");
    // The mode itself is mandatory on an outdoor shoot, as the coordinator is - an indoor one has no travel.
    if (submitting && !S.indoorOf(production) && !(travel.travelMode ?? production.travelMode)) {
      throw fail(400, "Choose the Travel Mode before submitting the plan.");
    }
    // And when the crew leaves the studio, which is where that journey starts.
    if (submitting && !S.indoorOf(production)) {
      const startDate = data.studioStartDate !== undefined ? data.studioStartDate : production.studioStartDate;
      const startTime = data.studioStartTime !== undefined ? data.studioStartTime : production.studioStartTime;
      if (!startDate || !startTime) throw fail(400, "Enter the Studio Start Date and Time before submitting the plan.");
    }
    if (submitting) Object.assign(data, { planSubmittedAt: now(), planSubmittedByUserId: caller.userId || null });
    if (Object.keys(data).length) await tx.projectProduction.update({ where: { id: production.id }, data });

    const services = await shootServices(tx, production);
    let crew = null;
    if (input.crew !== undefined) {
      // A function is the seat save's (`saveSeat`): the crew built from what is held, read here inside
      // this transaction so a save beside it cannot be undone by an older read.
      const wanted = typeof input.crew === "function" ? await input.crew(tx, production, services) : input.crew;
      crew = await saveCrew(tx, production, wanted, services, statuses, { keepAssistants: input.team === undefined });
      changed.push("services crew");
    }
    if (input.team !== undefined) {
      await saveTeam(tx, production, input.team, statuses);
      changed.push("assist");
    }
    // Submitting needs a person on every service. A plan already submitted may have one taken off -
    // somebody put on by mistake, or a service added since: it is saved, and the plan reads Work in
    // Progress again until every service has its person (`planCompleteness.js`).
    if (submitting) {
      const held = crew || await tx.projectProductionServiceCrew.findMany({ where: { productionId: production.id }, select: { serviceDefinitionId: true, role: true, employeeId: true, vendorId: true } });
      const missing = C.missingLead(held, services);
      if (missing) throw fail(400, `Assign a person to ${missing} before submitting the plan.`);
    }

    await logActivity(tx, production.id, submitting ? "PLAN_SUBMITTED" : "PLAN_SAVED", changed.length ? `Changed: ${changed.join(", ")}` : null, caller);
    return production.id;
  });
}

/**
 * One service's own person, from the Production Schedule's grid: `employeeId` or `vendorId`, or
 * neither to take the person off. Every other seat on the shoot is sent back as it is held - its
 * person, cameras and vendor status - so the save is the plan's own (`savePlan`, which replaces the
 * service seats whole) with only this one changed, under the same rules: the Production Manager's,
 * a working shooter or an active vendor, and nobody busy elsewhere. A seat may be emptied on a
 * submitted plan too, which then reads Work in Progress until it is filled again. The seat keeps its cameras for the employee who takes it; a vendor takes none and
 * starts on Waiting, unless it is the vendor already there - who keeps their answer, or takes the
 * `vendorStatus` sent with them (the schedule's Confirm).
 */
async function saveSeat(shootId, { serviceDefinitionId, employeeId = null, vendorId = null, vendorStatus }, caller, deps = {}) {
  const seat = (row) => ({
    serviceDefinitionId: row.serviceDefinitionId,
    role: C.LEAD,
    employeeId: row.employeeId || null,
    vendorId: row.vendorId || null,
    cameraAssetIds: row.vendorId ? [] : (row.cameras || []).map((camera) => camera.cameraAssetId),
    vendorStatus: row.vendorId ? row.vendorStatus || null : null,
  });
  // Built inside `savePlan`'s transaction, after it has locked the production row, so two seats
  // changed on one shoot at once are saved one after the other - neither undoes the other.
  const crew = async (tx, production, services) => {
    if (!services.has(serviceDefinitionId)) throw fail(400, "Assign people only to this shoot's services.");
    const held = (await tx.projectProductionServiceCrew.findMany({
      where: { productionId: production.id },
      select: { serviceDefinitionId: true, role: true, employeeId: true, vendorId: true, vendorStatus: true, cameras: { select: { cameraAssetId: true } } },
    })).filter((row) => row.role === C.LEAD && services.has(row.serviceDefinitionId));
    const current = held.find((row) => row.serviceDefinitionId === serviceDefinitionId);
    const seats = held.filter((row) => row !== current).map(seat);
    if (employeeId || vendorId) {
      const sameVendor = Boolean(vendorId) && current?.vendorId === vendorId;
      seats.push({
        serviceDefinitionId,
        role: C.LEAD,
        employeeId: vendorId ? null : employeeId,
        vendorId: vendorId || null,
        cameraAssetIds: vendorId || !current || current.vendorId ? [] : (current.cameras || []).map((camera) => camera.cameraAssetId),
        // The vendor already there keeps their answer - or takes the one sent, Waiting or Confirmed,
        // which is how the schedule confirms a vendor in place. A vendor new to the seat starts Waiting.
        vendorStatus: sameVendor ? vendorStatus || current.vendorStatus || null : null,
      });
    }
    return seats;
  };
  return savePlan(shootId, { crew }, caller, deps);
}

/**
 * "Use the same team as above", from the Production Schedule: every service this shoot shares with
 * another shoot of the same project (`fromShootId`) takes that shoot's person on it - an employee keeps
 * this seat's cameras only where they already had it, a vendor new to the seat starts Waiting. A
 * service the other shoot does not have, or has nobody on, is left exactly as it is. Saved through
 * `savePlan`, inside its transaction and under every one of its rules - who may change the plan,
 * working shooters, active vendors, nobody busy on an overlapping shoot, one employee one service.
 */
async function copyTeam(shootId, { fromShootId }, caller, deps = {}) {
  if (String(fromShootId) === String(shootId)) throw fail(400, "Choose another shoot to take the team from.");
  const crew = async (tx, production, services) => {
    const [target, source] = await Promise.all([
      tx.projectProduction.findUnique({ where: { id: production.id }, select: { salesProjectId: true } }),
      tx.projectProduction.findFirst({
        where: { shootId: String(fromShootId), ...liveWhere },
        select: { id: true, salesProjectId: true },
      }),
    ]);
    // Only a shoot of the same project - the one the caller is planning - is a team to take.
    if (!source || source.salesProjectId !== target?.salesProjectId) throw fail(404, "That shoot is not one of this project's.");
    const sourceCrew = await tx.projectProductionServiceCrew.findMany({ where: { productionId: source.id }, select: { serviceDefinitionId: true, role: true, employeeId: true, vendorId: true } });
    const from = new Map(sourceCrew.filter((row) => row.role === C.LEAD && services.has(row.serviceDefinitionId) && (row.employeeId || row.vendorId)).map((row) => [row.serviceDefinitionId, row]));
    if (!from.size) throw fail(400, "That shoot has nobody on any of this shoot's services.");
    const held = (await tx.projectProductionServiceCrew.findMany({
      where: { productionId: production.id },
      select: { serviceDefinitionId: true, role: true, employeeId: true, vendorId: true, vendorStatus: true, cameras: { select: { cameraAssetId: true } } },
    })).filter((row) => row.role === C.LEAD && services.has(row.serviceDefinitionId));
    const kept = held.filter((row) => !from.has(row.serviceDefinitionId)).map((row) => ({
      serviceDefinitionId: row.serviceDefinitionId,
      role: C.LEAD,
      employeeId: row.employeeId || null,
      vendorId: row.vendorId || null,
      cameraAssetIds: row.vendorId ? [] : (row.cameras || []).map((camera) => camera.cameraAssetId),
      vendorStatus: row.vendorId ? row.vendorStatus || null : null,
    }));
    const taken = [...from.values()].map((row) => {
      const current = held.find((seat) => seat.serviceDefinitionId === row.serviceDefinitionId);
      const samePerson = current && (row.vendorId ? current.vendorId === row.vendorId : current.employeeId === row.employeeId);
      return {
        serviceDefinitionId: row.serviceDefinitionId,
        role: C.LEAD,
        employeeId: row.vendorId ? null : row.employeeId,
        vendorId: row.vendorId || null,
        cameraAssetIds: !row.vendorId && samePerson ? (current.cameras || []).map((camera) => camera.cameraAssetId) : [],
        vendorStatus: row.vendorId && samePerson ? current.vendorStatus || null : null,
      };
    });
    return [...kept, ...taken];
  };
  return savePlan(shootId, { crew }, caller, deps);
}

/*
 * ── The plan's own status, set by hand ────────────────────────────────────────────────────────
 *
 * HOLD or REJECTED with its remarks, or null to go back to automatic (Yet to Start, Work in Progress, Planned from
 * the plan itself). The Production Manager's - whoever edits the plan - and apart from the shoot day's
 * Hold and Reject, which the Shoot status step sets. Logged on the shoot.
 */
// WCR - waiting for the client's reply - as Pre Production has it: it needs the next follow-up date
// as well as its remarks. Every status set by hand needs remarks.
const PLAN_STATUSES = ["WCR", "HOLD", "REJECTED"];
const PLAN_STATUS_LABELS = { WCR: "WCR", HOLD: "Hold", REJECTED: "Rejected" };
const NEEDS_REMARKS = new Set(PLAN_STATUSES);

async function setPlanStatus(shootId, { status, remarks, followupDate }, caller, deps = {}) {
  const { client = prisma, now = () => new Date() } = deps;
  if (status !== null && !PLAN_STATUSES.includes(status)) throw fail(400, "Choose WCR, Hold, Rejected or back to automatic.");
  const text = String(remarks || "").trim();
  if (NEEDS_REMARKS.has(status) && !text) throw fail(400, `Write the remarks for ${PLAN_STATUS_LABELS[status]}.`);
  const followup = status === "WCR" ? String(followupDate || "").trim() : "";
  if (status === "WCR" && !followup) throw fail(400, "Choose the Next Followup Date.");
  if (followup && followup < studioDateKey()) throw fail(400, "The Next Followup Date cannot be in the past.");
  return client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    if (!accessFor(production, caller).canEditPlan) throw fail(403, "Only this project's Production Manager can set the plan's status.");
    await tx.projectProduction.update({
      where: { id: production.id },
      data: status
        ? { planStatus: status, planStatusRemarks: text || null, planFollowupDate: followup ? new Date(`${followup}T00:00:00.000Z`) : null, planStatusAt: now(), planStatusByUserId: caller.userId || null }
        : { planStatus: null, planStatusRemarks: null, planFollowupDate: null, planStatusAt: now(), planStatusByUserId: caller.userId || null },
    });
    await logActivity(tx, production.id, "PLAN_STATUS_CHANGED", status ? [PLAN_STATUS_LABELS[status], followup && `follow up ${followup}`, text].filter(Boolean).join(": ") : "Back to automatic", caller);
    return production.id;
  });
}

module.exports = { savePlan, saveSeat, copyTeam, setPlanStatus, PLAN_STATUSES, travelData, shootServices, activeEmployees, refuseNonShooters, activeVendors, personName };
