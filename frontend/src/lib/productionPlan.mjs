/**
 * The plan form's values and options. Ids are held as strings because `Dropdown` and
 * `MultiSelectField` compare values with `===` against option values, and turned back into numbers
 * (allocation ids stay strings) only for the request.
 */
import { avatarOf } from "./employeeAvatar.mjs";
import { vendorLabel } from "./vendorLabel.mjs";

const asOption = (value, label) => ({ value: String(value), label: String(label || value) });

/*
 * Travel, mirroring `backend/src/modules/project-management/production/travel.js`: Bus, Train and
 * Flight carry tickets, Own and Car a number plate, Office Vehicle a vehicle from Asset Management,
 * Other a line saying how. The server keeps only the detail the mode uses; the payload sends the
 * rest as null so the form and the server agree.
 */
export const TICKET_MODES = ["Bus", "Train", "Flight"];
export const PLATE_MODES = ["Own", "Car"];
export const takesTickets = (mode) => TICKET_MODES.includes(mode);

/** Where a Bus, Train or Flight plan's tickets stand - the server's `TICKET_STATUSES`. */
export const TICKET_STATUS_OPTIONS = [
  { value: "YET_TO_TAKE", label: "Yet to Take" },
  { value: "TAKEN", label: "Taken" },
  { value: "ON_THE_FLY", label: "On the Fly" },
];

/**
 * Who works each service, as one form row per service and role (`LEAD`, and on a candid service
 * `ASSISTANT_1` / `ASSISTANT_2` - the server says which in `roles`). Only the service's own person
 * takes a camera. A service with no definition behind it cannot be crewed and has no rows.
 *
 * The person is an employee or an external vendor, so one dropdown holds both and its value says
 * which: `emp:<id>` or `ven:<id>`.
 */
const personValue = (row) => (row?.employeeId ? `emp:${row.employeeId}` : row?.vendorId ? `ven:${row.vendorId}` : "");
const personIds = (value) => {
  const [kind, id] = String(value || "").split(":");
  return { employeeId: kind === "emp" ? Number(id) : null, vendorId: kind === "ven" ? Number(id) : null };
};
/** Whether the person chosen for a seat is a vendor, which is what the seat asks next. */
export const isVendorPerson = (person) => String(person || "").startsWith("ven:");
// A drone service - "drone" in its name - is not held to one employee, one service: it may be flown by
// somebody already on another service of the shoot (the server's `crew.isDrone`).
export const isDroneService = (name) => /drone/i.test(String(name || ""));
/*
 * Where a vendor on a service stands, in place of the camera an employee is asked for: a vendor is
 * asked to hold the day and says so. A service whose vendor is still Waiting is not planned
 * (`planCompleteness`), so a newly chosen vendor starts there. The service's own person alone: an
 * assistant has no camera to replace and nothing to confirm.
 */
export const VENDOR_STATUS_OPTIONS = [{ value: "WAITING", label: "Waiting" }, { value: "CONFIRMED", label: "Confirmed" }];
export const CREW_ROLE_LABELS = { LEAD: "Person", ASSISTANT_1: "Assistant 1", ASSISTANT_2: "Assistant 2" };

function crewForm(services = []) {
  // The service's own person only: assistants are the shoot's Assist (`assistForm`), never a service's
  // seat - an old assistant seat is listed there instead, so it is never sent twice.
  return services.filter((service) => service.definitionId).flatMap((service) => ["LEAD"].map((role) => {
    const held = service.crew?.[role] || {};
    return {
      definitionId: service.definitionId,
      role,
      person: personValue(held),
      // A seat's cameras, as strings the pickers compare: a service's own person may carry several.
      cameraAssetIds: role === "LEAD" ? (held.cameras || []).map((camera) => String(camera.cameraAssetId)) : [],
      vendorStatus: role === "LEAD" && held.vendorId ? held.vendorStatus || "WAITING" : "",
    };
  }));
}

/**
 * The people on the plan who are kept by name alone - somebody who has left the studio, imported from
 * the old sheet. They have no employee to pick, so the form cannot list them; this says who they are.
 * "Production Coordinator: Sudeep · Production Team: Ajeesh, Ravi", or "" when there is nobody.
 */
export function keptNamesLine(plan = {}) {
  const parts = [];
  if (!plan.productionCoordinatorEmployeeId && plan.productionCoordinator) parts.push(`Production Coordinator: ${plan.productionCoordinator}`);
  const team = (plan.team || []).filter((member) => !member.employeeId && !member.vendorId && member.name).map((member) => member.name);
  if (team.length) parts.push(`Production Team: ${team.join(", ")}`);
  return parts.join(" · ");
}

/**
 * The shoot's Assist, as the form's values (`emp:<id>` / `ven:<id>`): its Production Team, and any
 * assistant a service was given before Assist was the shoot's - shown here, once each, so the next
 * save keeps them on the shoot rather than losing them with the service's old seat.
 */
export function assistForm(plan = {}) {
  const fromTeam = (plan.team || []).filter((member) => member.employeeId || member.vendorId).map(personValue);
  const fromServices = (plan.services || []).flatMap((service) => Object.entries(service.crew || {}).filter(([role]) => role !== "LEAD").map(([, held]) => personValue(held)));
  return [...new Set([...fromTeam, ...fromServices].filter(Boolean))];
}

/** How many of the Assist came from a service's old assistant seat - said under the field. */
export function assistMovedFromServices(plan = {}) {
  const team = new Set((plan.team || []).map(personValue).filter(Boolean));
  return new Set((plan.services || []).flatMap((service) => Object.entries(service.crew || {}).filter(([role]) => role !== "LEAD").map(([, held]) => personValue(held))).filter((value) => value && !team.has(value))).size;
}

export function productionPlanForm(detail) {
  const plan = detail?.plan || {};
  return {
    // The plan's own Hold / Rejected (or automatic), at the bottom of the form and saved with it.
    planStatusControl: { choice: detail?.planStatus || "AUTO", remarks: detail?.planStatusRemarks || "", followupDate: detail?.planFollowupDate || "" },
    productionCoordinatorEmployeeId: plan.productionCoordinatorEmployeeId ? String(plan.productionCoordinatorEmployeeId) : "",
    travelMode: plan.travelMode || "",
    travelModeOther: plan.travelModeOther || "",
    ticketStatus: plan.ticketStatus || "",
    vehicleNumberPlate: plan.vehicleNumberPlate || "",
    travelVehicleAssetId: plan.travelVehicle?.id ? String(plan.travelVehicle.id) : "",
    studioStartDate: plan.studioStartDate || "",
    studioStartTime: plan.studioStartTime || "",
    crew: crewForm(plan.services),
    assist: assistForm(plan),
    remarks: plan.remarks || "",
  };
}

export function productionPlanPayload(form, submit) {
  const mode = form.travelMode || null;
  const text = (value) => String(value || "").trim() || null;
  return {
    submit: Boolean(submit),
    productionCoordinatorEmployeeId: form.productionCoordinatorEmployeeId === "" ? null : Number(form.productionCoordinatorEmployeeId),
    travelMode: mode,
    travelModeOther: mode === "Other" ? text(form.travelModeOther) : null,
    ticketStatus: takesTickets(mode) ? form.ticketStatus || null : null,
    vehicleNumberPlate: PLATE_MODES.includes(mode) ? text(form.vehicleNumberPlate)?.toUpperCase() ?? null : null,
    travelVehicleAssetId: mode === "Office Vehicle" && form.travelVehicleAssetId ? Number(form.travelVehicleAssetId) : null,
    studioStartDate: form.studioStartDate || null,
    studioStartTime: form.studioStartTime || null,
    crew: (form.crew || []).map((row) => ({
      serviceDefinitionId: row.definitionId,
      role: row.role,
      ...personIds(row.person),
      // A vendor answers with their status, an employee with their cameras: never both, on either side.
      ...(row.role === "LEAD" && !isVendorPerson(row.person) ? { cameraAssetIds: (row.cameraAssetIds || []).map(Number).filter(Boolean) } : {}),
      ...(row.role === "LEAD" && isVendorPerson(row.person) ? { vendorStatus: row.vendorStatus || "WAITING" } : {}),
    })),
    // The shoot's Assist, whole: what is not in it is no longer on the shoot.
    team: [...new Set(form.assist || [])].map(personIds).filter((entry) => entry.employeeId || entry.vendorId),
    remarks: String(form.remarks || "").trim() || null,
  };
}

/**
 * What the Tickets part of the plan shows, or null for nothing.
 *
 * `mode` is the one picked on the form, saved or not - a ticket upload carries it, so the server
 * sets the plan's travel mode itself the moment a ticket is added (`production/execution.js`'s
 * `addFiles`) and picking Bus, Train or Flight is enough to upload without saving the plan first.
 * Tickets added under an earlier mode are never dropped: once the form's mode no longer takes
 * tickets, they stay listed under their own heading, where they can still be opened and removed,
 * but no more are added.
 */
export function ticketSection({ mode, status, tickets = [] }) {
  // Taken is when tickets are attached; a plan saved before the status was asked (none) still can be.
  if (takesTickets(mode) && (status === "TAKEN" || (!status && tickets.length))) return { title: "Tickets", canAdd: true };
  return tickets.length ? { title: takesTickets(mode) ? "Tickets" : "From the earlier travel mode", canAdd: false } : null;
}

/** Today's lists, plus anything the plan already names that has since left them. */
function withChosen(list, chosen = []) {
  const seen = new Set(list.map((option) => option.value));
  return [...list, ...(chosen || []).filter((item) => item && !seen.has(String(item.id))).map((item) => asOption(item.id, item.name))];
}

export function productionPlanOptions(options = {}, detail = null) {
  const plan = detail?.plan || {};
  const coordinator = plan.productionCoordinatorEmployeeId ? [{ id: plan.productionCoordinatorEmployeeId, name: plan.productionCoordinator }] : [];
  // A person or camera named on a service and since retired stays listed, by name.
  const crew = (plan.services || []).flatMap((service) => Object.values(service.crew || {}));
  const crewPeople = crew.filter((row) => row.employeeId).map((row) => ({ id: `emp:${row.employeeId}`, name: row.employeeName || row.name }));
  const crewVendors = crew.filter((row) => row.vendorId).map((row) => ({ id: `ven:${row.vendorId}`, name: row.vendorName || row.name }));
  // A camera on a service and since retired stays listed, by name - every one the seat took.
  const crewCameras = crew.flatMap((row) => (row.cameras || []).map((camera) => ({ id: camera.cameraAssetId, name: camera.cameraName })));
  // `shooter`: the server's answer for whether this employee is in the Technical department - the services'
  // Person and Assistant lists offer only them (`ProductionServiceCrew`).
  const employees = (options?.employees || []).map((employee) => ({ ...asOption(employee.id, `${employee.employeeName}${employee.employeeId ? ` (${employee.employeeId})` : ""}`), avatar: avatarOf(employee), shooter: Boolean(employee.shooter) }));
  const asset = (item) => asOption(item.id, `${item.assetName} (${item.assetCode})`);
  const employeePeople = employees.map((option) => ({ ...option, value: `emp:${option.value}` }));
  /*
   * How to reach a vendor rides on their option, so the plan can show it beside the service without
   * a request of its own - the coordinator ringing them is the commonest thing done from this form.
   * The mobile first: it is the number somebody calls, and WhatsApp's is the fallback.
   */
  const vendorOption = (vendor) => ({
    ...asOption(`ven:${vendor.id}`, vendorLabel(vendor)),
    phone: String(vendor.mobileNumber || vendor.whatsappNumber || "").trim(),
    contactPerson: String(vendor.contactPerson || "").trim(),
  });
  return {
    employees: withChosen(employees, coordinator),
    // Who can work a service: the employees in the Technical department (the component reads `shooter`),
    // then every active vendor, as "EXT-name (business, city)" (`vendorLabel`). The studio hires whoever is free for a service, and the
    // "Can be a production team member?" tick on the vendor was keeping people out of a list they
    // were then asked for by name. Anybody already on a service stays listed.
    people: withChosen([...employeePeople, ...(options?.vendors || []).map(vendorOption)], [...crewPeople, ...crewVendors]),
    travelModes: options?.travelModes || [],
    cameras: withChosen((options?.cameras || []).map(asset), crewCameras),
    // The plan's own vehicle stays listed, by name, after it has been retired from Asset Management.
    vehicles: withChosen((options?.vehicles || []).map(asset), plan.travelVehicle ? [plan.travelVehicle] : []),
  };
}
