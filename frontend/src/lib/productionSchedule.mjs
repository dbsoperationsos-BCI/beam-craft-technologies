import { shootsInOrder } from "./productionBoard.mjs";
import { PROJECT_COLOURS, shootTimeLabel } from "./shootBoard.mjs";
import { isDroneService } from "./productionPlan.mjs";

/*
 * Production Schedule: the production board's shoots as the studio's schedule sheet - by day, each
 * with who works its services. Pure, so the page only draws what these answer.
 */

// How large the blocks are drawn, in percent: the page's zoom out / zoom in.
export const SCHEDULE_ZOOMS = ["80", "90", "100", "115", "130"];
export const DEFAULT_SCHEDULE_ZOOM = "100";

/** The next zoom in (`step` 1) or out (-1) from `zoom`, or `zoom` itself at either end. */
export function zoomBy(zoom, step) {
  const index = SCHEDULE_ZOOMS.indexOf(zoom);
  const next = SCHEDULE_ZOOMS[(index < 0 ? SCHEDULE_ZOOMS.indexOf(DEFAULT_SCHEDULE_ZOOM) : index) + step];
  return next || zoom;
}

const dayKeyOf = (value) => {
  if (!value) return "";
  const day = new Date(value);
  return Number.isNaN(day.getTime()) ? "" : `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};

/**
 * The shoots the schedule shows, in the order they happen: `range` `{ from, to }` (days, inclusive; a
 * `to` of null has no last day - Upcoming) keeps the shoots dated inside it - one with no date only while no range is set; `range`
 * `{ undated: true }` (Unknown date) keeps only the shoots with no date yet; `projectIds`, when any,
 * keeps their shoots.
 */
export function scheduleShoots(shoots, { range = null, projectIds = [] } = {}) {
  const from = range?.from ? dayKeyOf(range.from) : "";
  const to = range?.to ? dayKeyOf(range.to) : "";
  return shootsInOrder(shoots).filter((shoot) => {
    const key = dayKeyOf(shoot.shootDate);
    if (range?.undated) { if (key) return false; }
    else if (range && (!key || key < from || (to && key > to))) return false;
    return !projectIds.length || projectIds.includes(shoot.projectId);
  });
}

// A day as a whole number, so two days are next to each other when they differ by one; null undated.
const dayNumber = (value) => {
  const key = dayKeyOf(value);
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
};

/**
 * The shown shoots as the sheet lays them out: a project's shoots on **continuous days** together - a
 * run, each shoot on the same day as the one before it or the next - and the runs in the order of their
 * first shoot, so the schedule still reads by date. A project shooting on the 11th, 11th, 15th, 16th and
 * 19th is three runs: the two 11ths, the 15th and 16th, and the 19th alone, with any other project's
 * shoots between them where their dates fall. Undated shoots of a project make one run of their own.
 *
 * Each row carries `ordinal`, its place in its run from 0, and `firstOfRun` - the row that names the
 * project; the rest of the run leave the Event ID and Event to it.
 */
export function scheduleRows(shoots) {
  const runs = [];
  const open = new Map();
  for (const shoot of shootsInOrder(shoots)) {
    const day = dayNumber(shoot.shootDate);
    const run = open.get(shoot.projectId);
    const last = run && dayNumber(run[run.length - 1].shootDate);
    const continues = run && (day === null ? last === null : last !== null && day - last <= 1);
    if (continues) run.push(shoot);
    else {
      const next = [shoot];
      runs.push(next);
      open.set(shoot.projectId, next);
    }
  }
  return runs.flatMap((run) => run.map((shoot, index) => ({ ...shoot, ordinal: index, firstOfRun: index === 0 })));
}

/** A service's own person as the people picker's value - `emp:<id>`, `ven:<id>`, or "" for nobody. */
export const seatValue = (service) => (service?.employeeId ? `emp:${service.employeeId}` : service?.vendorId ? `ven:${service.vendorId}` : "");

/** A picker value as the seat save's body: an employee, a vendor, or neither. */
/** The time under a shoot's date on the Schedule: "6:30 pm – 10:00 pm", its start alone, or "No time". */
export function scheduleTimeLabel(shoot) {
  return shootTimeLabel({ startTime: shoot.startTime, endTime: shoot.endTime }) || "No time";
}

export function seatPayload(value) {
  const [kind, id] = String(value || "").split(":");
  const number = Number(id) || null;
  return { employeeId: kind === "emp" ? number : null, vendorId: kind === "ven" ? number : null };
}

/** Each project with a shoot among `shoots`, once, for the Projects filter. */
export function scheduleProjectOptions(shoots) {
  const seen = new Map();
  for (const shoot of shoots) {
    if (seen.has(shoot.projectId)) continue;
    const label = shoot.clientName || shoot.eventId || "Project";
    seen.set(shoot.projectId, { value: shoot.projectId, label: shoot.eventId && shoot.eventId !== label ? `${label} · ${shoot.eventId}` : label });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The colour of a shoot by its place in its project's rows (`ordinal`, from `scheduleRows`): every
 * project's first row - the one that names the project - one colour, every second row the next, and
 * on, the same across projects. The Shoot Board's hues, which carry their own dark-theme pair, in an
 * order of this schedule's own (`HUE_ORDER`).
 */
/*
 * The order the hues are used in here. Not the Shoot Board's: its first, sky, read as the page's own
 * blue-grey behind a project's first row, and amber, emerald and rose are the Waiting, confirmed-vendor
 * and Not assigned colours of the service blocks beside it, so they come last.
 */
const HUE_ORDER = ["teal", "orange", "fuchsia", "lime", "violet", "sky", "slate", "amber", "emerald", "rose"];
const SCHEDULE_COLOURS = HUE_ORDER.map((hue) => PROJECT_COLOURS.find((colour) => colour.chip.endsWith(`shoot-hue-${hue}`))).filter(Boolean);

export const shootColour = (ordinal = 0) => SCHEDULE_COLOURS[ordinal % SCHEDULE_COLOURS.length];

/**
 * The board rows with two services' people swapped as the server will swap them (`swap.js`) - drawn the
 * moment a person is dropped, so the schedule answers the drop at once; the server's own answer
 * replaces it. `from` and `to` are `{ shootId, serviceDefinitionId }`, the shoot being its record id.
 * A vendor moved to another shoot starts on Waiting there; within one shoot they keep their answer.
 */
export function swapInRows(rows, from, to) {
  const find = (ref) => rows.find((row) => row.shootRecordId === ref.shootId)?.services?.find((service) => service.definitionId === ref.serviceDefinitionId);
  const a = find(from);
  const b = find(to);
  if (!a || !b) return rows;
  const sameShoot = from.shootId === to.shootId;
  const person = (seat) => ({
    employeeId: seat.employeeId || null,
    vendorId: seat.vendorId || null,
    person: seat.person || null,
    vendor: Boolean(seat.vendorId),
    vendorStatus: seat.vendorId ? (sameShoot ? seat.vendorStatus : "WAITING") : null,
  });
  const into = { [`${from.shootId}:${from.serviceDefinitionId}`]: person(b), [`${to.shootId}:${to.serviceDefinitionId}`]: person(a) };
  return rows.map((row) => (row.shootRecordId !== from.shootId && row.shootRecordId !== to.shootId ? row : {
    ...row,
    services: (row.services || []).map((service) => ({ ...service, ...(into[`${row.shootRecordId}:${service.definitionId}`] || {}) })),
  }));
}

/**
 * One employee works one service of a shoot: the employees on another of the shoot's services than
 * `definitionId`, as picker values - left out of that service's picker. A vendor is never left out: an
 * external studio may cover several services of one shoot - and nor is anybody for a drone service, or
 * because they fly the drone.
 */
export function peopleOnOtherServices(shoot, definitionId) {
  const services = shoot?.services || [];
  // A drone service leaves nobody out, and nobody on one is left out of another (`isDroneService`).
  if (isDroneService(services.find((service) => service.definitionId === definitionId)?.name)) return new Set();
  return new Set(services.filter((service) => service.definitionId !== definitionId && service.employeeId && !isDroneService(service.name)).map(seatValue));
}

/**
 * Whether dropping `from`'s person on `to` would put an employee on a second service of a shoot: the
 * name of who, or null. Within one shoot a swap never does; across two, each employee must not already
 * be on another of the other shoot's services. A vendor may be.
 */
export function doubledBySwap(rows, from, to) {
  if (from.shootId === to.shootId) return null;
  const shootOf = (ref) => rows.find((row) => row.shootRecordId === ref.shootId);
  const seatOf = (ref) => shootOf(ref)?.services?.find((service) => service.definitionId === ref.serviceDefinitionId);
  for (const [mover, into] of [[seatOf(from), to], [seatOf(to), from]]) {
    const value = seatValue(mover);
    if (value && peopleOnOtherServices(shootOf(into), into.serviceDefinitionId).has(value)) return mover.person || "This person";
  }
  return null;
}

/**
 * The shoot the schedule opens on: one dated `today`; else the next one after it; else - every shoot
 * behind it - the latest. Its record id, or null with none dated. The rows are a project's shoots
 * together, not one run of dates, so this is the nearest shoot rather than a place in the list.
 */
export function nearestShootTo(rows, today = new Date()) {
  const key = dayKeyOf(today);
  let after = null;
  let before = null;
  for (const row of rows) {
    const day = dayKeyOf(row.shootDate);
    if (!day) continue;
    if (day === key) return row.shootRecordId;
    if (day > key && (!after || day < after.day)) after = { day, id: row.shootRecordId };
    if (day < key && (!before || day > before.day)) before = { day, id: row.shootRecordId };
  }
  return after?.id || before?.id || null;
}

/**
 * The shoot whose team `shoot` may take - "Use the same team as above": the nearest row above it of
 * the same project, when taking its team would change something - a service the two share that the
 * shoot above has somebody on, and this shoot has somebody else on, or nobody. Null otherwise.
 */
export function teamAbove(rows, shoot) {
  const index = rows.findIndex((row) => row.shootRecordId === shoot.shootRecordId);
  let above = null;
  for (let at = index - 1; at >= 0 && !above; at -= 1) if (rows[at].projectId === shoot.projectId) above = rows[at];
  if (!above) return null;
  const here = new Map((shoot.services || []).filter((service) => service.definitionId).map((service) => [service.definitionId, seatValue(service)]));
  return (above.services || []).some((service) => here.has(service.definitionId) && seatValue(service) && seatValue(service) !== here.get(service.definitionId)) ? above : null;
}

/*
 * ── The quick filters ────────────────────────────────────────────────────────────────────────────
 *
 * A box under each column, as the app's tables have: Event ID, Event, Shoot ID and Shoot pick any of
 * the values the shoots in range hold; Date takes a day or part of one as typed ("2026-11" is the
 * month); and the Production plan's one box picks people - a shoot is kept where any of them is on one
 * of its services or its Assist, which is how to see every project somebody is working.
 */
export const EMPTY_SCHEDULE_FILTERS = { eventId: [], event: [], shootId: [], date: "", shootPlace: [], district: [], state: [], shootType: [], productionManager: [], productionCoordinator: [], shoot: [], person: [] };

// Everybody a shoot holds, by name: each service's person and the Assist.
const peopleOf = (shoot) => [...(shoot.services || []).map((service) => service.person), ...(shoot.assist || [])].filter(Boolean);

const FILTER_VALUES = {
  eventId: (shoot) => [shoot.eventId],
  event: (shoot) => [shoot.clientName],
  shootId: (shoot) => [shoot.shootId],
  // The optional columns Manage Columns can add, each picking from what the shoots hold.
  shootPlace: (shoot) => [shoot.shootPlace],
  district: (shoot) => [shoot.district],
  state: (shoot) => [shoot.state],
  shootType: (shoot) => [shoot.shootType],
  productionManager: (shoot) => [shoot.productionManager],
  productionCoordinator: (shoot) => [shoot.productionCoordinator],
  shoot: (shoot) => [shoot.shoot],
  person: peopleOf,
};

/** The choices each list filter offers: the values the shoots hold, once each, in order. */
export function scheduleFilterOptions(shoots) {
  return Object.fromEntries(Object.entries(FILTER_VALUES).map(([key, valuesOf]) => [key, [...new Set(shoots.flatMap(valuesOf).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))]));
}

/** The shoots every filter set keeps; a filter left empty keeps all. */
export function filterScheduleShoots(shoots, filters = EMPTY_SCHEDULE_FILTERS) {
  const date = String(filters.date || "").trim();
  return shoots.filter((shoot) => Object.entries(FILTER_VALUES).every(([key, valuesOf]) => !filters[key]?.length || valuesOf(shoot).some((value) => filters[key].includes(value)))
    && (!date || dayKeyOf(shoot.shootDate).startsWith(date)));
}

/** Whether any filter is set. */
export const scheduleFiltersSet = (filters) => Object.values(filters || {}).some((value) => (Array.isArray(value) ? value.length : String(value || "").trim()));
