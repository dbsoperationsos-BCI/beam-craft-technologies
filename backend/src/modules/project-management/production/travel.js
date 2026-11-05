/**
 * How the crew travels to a shoot, and what each mode asks for on the Production Manager's plan.
 *
 * Pure: no database. Bus, Train and Flight carry tickets (TICKET files); Own and Car a vehicle
 * number plate; Office Vehicle a vehicle from Asset Management; Other a line saying how. A plan
 * only ever keeps the detail its mode uses - `travelData` clears the rest on every save.
 */

const TRAVEL_MODES = ["Bus", "Train", "Flight", "Own", "Car", "Office Vehicle", "Other"];
const TICKET_MODES = ["Bus", "Train", "Flight"];
const PLATE_MODES = ["Own", "Car"];
const OFFICE_VEHICLE = "Office Vehicle";
const OTHER = "Other";

// Which Asset Management categories count as vehicles for the Office Vehicle dropdown. The seeded
// tree keeps them under Transportation as Bikes / Cars / Vans; the extra names are slack for
// categories a studio may add later. FASTag cards and fuel cards live under Transportation too,
// which is why this filters by category name rather than taking the whole parent.
const VEHICLE_CATEGORY_NAMES = ["Bikes", "Cars", "Vans", "Vehicles", "Buses", "Trucks"];
/** Vehicles still in circulation - what a plan may newly name. A sold or disposed vehicle is history. */
const VEHICLE_WHERE = { isDeleted: false, status: { in: ["ACTIVE", "UNASSIGNED", "UNDER_REPAIR"] }, category: { name: { in: VEHICLE_CATEGORY_NAMES } } };

const takesTickets = (mode) => TICKET_MODES.includes(mode);

/*
 * Where a Bus, Train or Flight plan's tickets stand - Yet to Take, Taken, or On the Fly (bought on
 * the way, so there is nothing to attach). It is recorded for whoever reads the plan and no longer
 * holds the plan short: only the coordinator, the travel mode and each service's person are counted
 * (`planCompleteness`).
 */
const TICKET_STATUSES = ["YET_TO_TAKE", "TAKEN", "ON_THE_FLY"];

/** Trimmed and upper-cased; empty is none. No fixed format - plates differ state to state. */
function normalisePlate(value) {
  const plate = String(value ?? "").trim().toUpperCase();
  return plate || null;
}

/*
 * A mode's **detail** - the number plate, the office vehicle, the line saying how on Other - is not
 * asked for before a plan is submitted. Only the mode itself is mandatory, beside the coordinator
 * and each service's person (`planCompleteness`): the crew often knows how they are going before
 * they know which vehicle or whose car, and a submitted plan was being refused over a blank box.
 */

/** Tickets belong to a mode that has them. */
function ticketRefusal(record) {
  return takesTickets(record?.travelMode) ? null : "Tickets are added only when the travel mode is Bus, Train or Flight.";
}

module.exports = { TRAVEL_MODES, TICKET_MODES, TICKET_STATUSES, PLATE_MODES, OFFICE_VEHICLE, OTHER, VEHICLE_CATEGORY_NAMES, VEHICLE_WHERE, takesTickets, normalisePlate, ticketRefusal };
