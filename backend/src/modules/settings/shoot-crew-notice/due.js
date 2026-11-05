const crypto = require("node:crypto");
const prisma = require("../../../config/db");
const { studioDateKey } = require("../../../services/studioTime");
const shared = require("./shared");
const projectSender = require("./projectSender");

/*
 * Settings → Project Management → Shoot crew notice: **what is owed to whom**, worked out by
 * comparing the plan as it stands against what each person was last told
 * (`project_shoot_crew_notice`). The sending itself is `sender.js`.
 *
 * The rules, in the studio's words:
 *
 *   - **Two days before the shoot**, everybody given a service on it is told what the shoot is, when
 *     and where it is, and the service they are on.
 *   - **A plan changed after that** tells only the people whose own part changed - a seat given to
 *     somebody else tells those two and nobody else. Each person's `digest` is their own services
 *     plus the shoot's day, times and places, so an edit elsewhere in the plan reaches nobody, and a
 *     shoot moved or re-venued reaches everybody on it, which is the one change that is everybody's.
 *   - **Taken off the shoot**, they are told that instead, and the row is dropped.
 *   - **Thirty minutes of quiet** before anything goes: the plan is edited in passes, and a message
 *     per keystroke is what a crew member would unsubscribe from. The clock is the latest of the
 *     plan's, its seats' and the shoot's own `updatedAt`, so any of the three restarts it.
 *   - **A plan settled late** - inside the two days, or on the day - therefore goes out thirty
 *     minutes after it is planned, by the same rule rather than a second one.
 *
 * Only a **settled** plan is messaged: submitted, and not on Hold, Rejected or WCR (waiting for the
 * client's reply). A shoot whose day has passed is left alone, and so is a vendor's seat - this goes
 * to the studio's own people, by their own number.
 */

// The horizon, the quiet window and what counts as a settled plan are `shared.js`, which the vendor
// arm reads too: a shoot moved by half an hour must read the same in both messages.
const { DAYS_BEFORE, QUIET_MS, UNSETTLED_PLAN, dayStart, horizonEnd, lastTouchedAt, settledFor } = shared;

const nameOnly = { select: { employeeName: true } };

/** The plan, its seats and the shoot a notice is drawn from. */
const dueInclude = {
  shoot: {
    select: {
      id: true, shootId: true, shoot: true, dateCreated: true, updatedAt: true,
      eventStartTime: true, eventEndTime: true, sessionTiming: true,
      // Already the joined summary of every location on a multi-place shoot (`services/shootLocations.js`).
      shootPlace: true, district: true,
      // The project carries who the notice comes from now - its own Pre-Production Coordinator for
      // the crew, its Production Manager for a vendor (`projectSender.js`).
      project: { select: { id: true, eventId: true, whatsappGroupName: true, ...projectSender.PROJECT_SENDER_SELECT } },
    },
  },
  productionCoordinatorEmployee: nameOnly,
  serviceCrew: {
    select: {
      employeeId: true, role: true, serviceDefinitionId: true, updatedAt: true,
      serviceDefinition: { select: { name: true } },
      employee: { select: { id: true, employeeName: true, contactNumber: true, companyGivenNumber: true } },
    },
  },
  crewNotices: { select: { id: true, employeeId: true, digest: true, employee: { select: { id: true, employeeName: true, contactNumber: true, companyGivenNumber: true } } } },
};

/** Their seats on this shoot, in the plan's own order: somebody may hold two services on one shoot. */
const seatsOf = (production, employeeId) => (production.serviceCrew || []).filter((seat) => seat.employeeId === employeeId);

/** What those seats are called, for the message - "Candid Photography, Drone". */
const servicesLabel = (seats) => [...new Set(seats.map((seat) => String(seat.serviceDefinition?.name || "").trim()).filter(Boolean))].join(", ");

/**
 * What the message would say, as one hash: their own services, and the shoot's day, times and
 * places. Two sweeps that would say the same thing give the same digest, so nobody is told twice.
 * The full 64 hex characters, which is what the column holds.
 */
const DIGEST_VERSION = "v1";

function digestOf(shoot, seats) {
  const parts = [
    // Bumped when this list gains a field, so the change is deliberate: every future crew member is
    // told once more, rather than a new field quietly never reaching anybody.
    DIGEST_VERSION,
    shoot.shoot || "",
    shoot.dateCreated ? studioDateKey(shoot.dateCreated) : "",
    shoot.eventStartTime || "", shoot.eventEndTime || "", shoot.sessionTiming || "",
    shoot.shootPlace || "", shoot.district || "",
    seats.map((seat) => `${seat.role}:${seat.serviceDefinitionId}`).sort().join("|"),
  ];
  return crypto.createHash("sha256").update(parts.join("\u0001")).digest("hex");
}

const phoneOf = (employee) => String(employee?.contactNumber || employee?.companyGivenNumber || "").trim();

/**
 * Everything owed right now, newest shoot last: one entry per person per shoot, either `ASSIGNED`
 * (never told, or told something that has since changed) or `REMOVED` (told, and no longer on it).
 *
 * `notice` is the row to update or drop once it has gone, so the sender writes the record and never
 * re-reads the plan.
 */
async function crewNoticesDue(now = new Date(), { client = prisma, daysBefore = DAYS_BEFORE, quietMs = QUIET_MS } = {}) {
  const productions = await client.projectProduction.findMany({
    where: {
      planSubmittedAt: { not: null },
      shoot: { deletedAt: null, dateCreated: { gte: dayStart(now), lt: horizonEnd(now, daysBefore) }, project: { deletedAt: null } },
    },
    include: dueInclude,
    orderBy: [{ shoot: { dateCreated: "asc" } }, { createdAt: "asc" }],
  });

  const due = [];
  for (const production of productions) {
    if (UNSETTLED_PLAN.has(String(production.planStatus || ""))) continue;
    if (!settledFor(production, now, quietMs)) continue;
    const shoot = production.shoot;
    const told = new Map((production.crewNotices || []).map((notice) => [notice.employeeId, notice]));
    const onIt = new Set();

    // A vendor's seat, and a service nobody is on yet, carry no employee to tell.
    for (const employeeId of (production.serviceCrew || []).map((seat) => seat.employeeId).filter(Boolean)) {
      if (onIt.has(employeeId)) continue;
      onIt.add(employeeId);
      const seats = seatsOf(production, employeeId);
      const digest = digestOf(shoot, seats);
      const notice = told.get(employeeId) || null;
      if (notice && notice.digest === digest) continue;
      due.push({
        kind: "ASSIGNED",
        production,
        shoot,
        project: shoot.project,
        employee: seats[0].employee,
        phone: phoneOf(seats[0].employee),
        services: servicesLabel(seats),
        serviceDefinitionId: seats.length === 1 ? seats[0].serviceDefinitionId : null,
        coordinator: production.productionCoordinatorEmployee?.employeeName || "",
        digest,
        notice,
      });
    }

    for (const notice of told.values()) {
      if (onIt.has(notice.employeeId)) continue;
      due.push({
        kind: "REMOVED",
        production,
        shoot,
        project: shoot.project,
        employee: notice.employee,
        phone: phoneOf(notice.employee),
        services: "",
        serviceDefinitionId: null,
        coordinator: production.productionCoordinatorEmployee?.employeeName || "",
        digest: notice.digest,
        notice,
      });
    }
  }
  return due;
}

module.exports = { crewNoticesDue, digestOf, DIGEST_VERSION, lastTouchedAt, settledFor, seatsOf, servicesLabel, phoneOf, DAYS_BEFORE, QUIET_MS, UNSETTLED_PLAN, dayStart, horizonEnd };
