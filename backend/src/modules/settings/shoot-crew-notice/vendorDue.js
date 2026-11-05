const crypto = require("node:crypto");
const prisma = require("../../../config/db");
const { studioDateKey } = require("../../../services/studioTime");
const { VENDOR_CONFIRMED } = require("../../project-management/production/crew");
const shared = require("./shared");
const projectSender = require("./projectSender");

/*
 * Settings → Project Management → Shoot crew notice, **vendor arm**: what is owed to which vendor.
 * The sending is `vendorSender.js`, and the studio's own people are `due.js`.
 *
 * The rules, in the studio's words:
 *
 *   - **Thirty minutes after the production manager confirms a vendor**, that vendor is told what the
 *     shoot is, when and where it is, and the service they are on. The thirty minutes is the quiet
 *     window `shared.js` already holds, not a timer of its own: the manager confirms, keeps editing,
 *     and the vendor is told once.
 *   - **Two days before the shoot**, the same vendor is reminded. The confirm and the reminder are two
 *     different things and both go - a vendor confirmed a month out hears twice, which is the point.
 *     A vendor confirmed inside the two days gets the confirm only; the reminder is not back-dated.
 *   - **A change** tells them what it now is: the day or its times, the places, or their own service.
 *   - **Off the shoot** - the seat taken from them, put back to Waiting, the plan withdrawn or held,
 *     the shoot deleted - tells them not to travel.
 *
 * ── Why this looks further ahead than the crew arm ──
 *
 * `due.js` asks only about the next two days, because that is when a crew member is told. A vendor is
 * told **when they are confirmed**, so this looks at every shoot from today on. That is also what
 * makes the change messages worth anything: a shoot that moves a fortnight out has to reach a vendor
 * told a fortnight ago.
 *
 * ── Why the plan filters are in the code and not in the query ──
 *
 * A withdrawn plan, a held plan and a deleted shoot are exactly the cases where a vendor **must** be
 * chased, and a query that filtered them out would make them unreachable - the production would simply
 * not come back. So the query asks only for future shoots carrying a vendor seat or a vendor notice,
 * and everything else is decided here against what the vendor was last told.
 *
 * ── Why three digests ──
 *
 * One digest can say that something changed; it cannot say **what**, and there is a wording per kind.
 * So the day and times, the places and the services are hashed apart. Where two differ at once the
 * more disruptive is sent **alone** - a vendor who gets three messages for one edit mutes the studio.
 */

const DIGEST_VERSION = "v1";

/** This vendor's seats on this shoot, confirmed ones only: a vendor may hold two services on one. */
const confirmedSeatsOf = (production, vendorId) => (production.serviceCrew || [])
  .filter((seat) => seat.vendorId === vendorId && String(seat.vendorStatus || "") === VENDOR_CONFIRMED);

/** Every vendor with at least one confirmed seat on this shoot, in the plan's own order. */
function confirmedVendorIds(production) {
  const seen = [];
  for (const seat of production.serviceCrew || []) {
    if (!seat.vendorId || String(seat.vendorStatus || "") !== VENDOR_CONFIRMED) continue;
    if (!seen.includes(seat.vendorId)) seen.push(seat.vendorId);
  }
  return seen;
}

/** What those seats are called, for the message - "Candid Photography, Drone". */
const servicesLabel = (seats) => [...new Set(seats.map((seat) => String(seat.serviceDefinition?.name || "").trim()).filter(Boolean))].join(", ");

const hash = (...parts) => crypto.createHash("sha256").update([DIGEST_VERSION, ...parts].join("\u0001")).digest("hex");

/**
 * The three digests of what a message would say. Bump `DIGEST_VERSION` when one of these lists gains
 * a field, so every future vendor is told once more rather than a new field quietly reaching nobody.
 */
const digestsOf = (shoot, seats) => ({
  shootDigest: hash(
    shoot?.shoot || "",
    shoot?.dateCreated ? studioDateKey(shoot.dateCreated) : "",
    shoot?.eventStartTime || "", shoot?.eventEndTime || "", shoot?.sessionTiming || "",
  ),
  placeDigest: hash(shoot?.shootPlace || "", shoot?.district || ""),
  serviceDigest: hash(seats.map((seat) => `${seat.role}:${seat.serviceDefinitionId}`).sort().join("|")),
});

/**
 * What was said, kept on the row - so "do not travel" can still be composed once the plan that would
 * have composed it is withdrawn, the shoot deleted or the seat gone.
 *
 * Deliberately not name copies in `nameCopies.js`: a rename must not rewrite these, because they are
 * the words the vendor actually received.
 */
const snapshotOf = (shoot, seats) => ({
  lastShoot: shoot?.shoot || null,
  lastShootCode: shoot?.shootId || null,
  lastProject: shoot?.project?.whatsappGroupName || shoot?.project?.eventId || null,
  lastDate: shoot?.dateCreated || null,
  lastTime: shared.timeWords(shoot) || null,
  lastPlace: shoot?.shootPlace || null,
  lastDistrict: shoot?.district || null,
  lastService: servicesLabel(seats) || null,
});

/** The plan, its vendor seats, the shoot and what each vendor was last told. */
const dueInclude = {
  shoot: {
    select: {
      id: true, shootId: true, shoot: true, dateCreated: true, updatedAt: true, deletedAt: true,
      eventStartTime: true, eventEndTime: true, sessionTiming: true,
      shootPlace: true, district: true,
      project: { select: { id: true, eventId: true, whatsappGroupName: true, deletedAt: true, ...projectSender.PROJECT_SENDER_SELECT } },
    },
  },
  serviceCrew: {
    select: {
      vendorId: true, role: true, serviceDefinitionId: true, updatedAt: true, vendorStatus: true,
      serviceDefinition: { select: { name: true } },
      vendor: { select: { id: true, vendorName: true, whatsappNumber: true, mobileNumber: true, isDeleted: true } },
    },
  },
  vendorNotices: {
    select: {
      id: true, vendorId: true, shootDigest: true, placeDigest: true, serviceDigest: true,
      confirmedSentAt: true, reminderSentAt: true, needsNumber: true, serviceDefinitionId: true, sentAt: true,
      lastShoot: true, lastShootCode: true, lastProject: true, lastDate: true, lastTime: true,
      lastPlace: true, lastDistrict: true, lastService: true,
      vendor: { select: { id: true, vendorName: true, whatsappNumber: true, mobileNumber: true } },
    },
  },
};

/** The vendor's own WhatsApp number, or their mobile where no WhatsApp number is saved. */
const phoneOf = (vendor) => String(vendor?.whatsappNumber || vendor?.mobileNumber || "").trim();

/** Whether the shoot is near enough for the two-days-before reminder to be owed. */
const withinReminder = (shoot, now, daysBefore) => Boolean(shoot?.dateCreated)
  && shoot.dateCreated < shared.horizonEnd(now, daysBefore);

/** Whether this plan is one a vendor may be told about at all. */
const messageable = (production) => shared.settledPlan(production)
  && !production.shoot?.deletedAt
  && !production.shoot?.project?.deletedAt;

/**
 * Everything owed right now, nearest shoot first: one entry per vendor per shoot, never two.
 *
 * `kind` is the template to send - `CONFIRMED`, `REMINDER`, `DATE_CHANGED`, `PLACE_CHANGED`,
 * `SERVICE_CHANGED` or `REMOVED` - and `notice` is the row to write once it has gone, so the sender
 * never re-reads the plan. `stale` entries are rows for shoots now in the past: nothing to send, and
 * the row is dropped.
 */
async function vendorNoticesDue(now = new Date(), { client = prisma, daysBefore = shared.DAYS_BEFORE, quietMs = shared.QUIET_MS } = {}) {
  const productions = await client.projectProduction.findMany({
    where: {
      shoot: { dateCreated: { gte: shared.dayStart(now) } },
      OR: [
        { serviceCrew: { some: { vendorId: { not: null }, vendorStatus: VENDOR_CONFIRMED } } },
        { vendorNotices: { some: {} } },
      ],
    },
    include: dueInclude,
    orderBy: [{ shoot: { dateCreated: "asc" } }, { createdAt: "asc" }],
  });

  const due = [];
  for (const production of productions) {
    const shoot = production.shoot;
    const told = new Map((production.vendorNotices || []).map((notice) => [notice.vendorId, notice]));
    const open = messageable(production) && shared.settledFor(production, now, quietMs);
    const onIt = new Set();

    const entry = (kind, { vendor, notice, seats = [], template }) => ({
      kind,
      template,
      production,
      shoot,
      project: shoot?.project || null,
      vendor,
      phone: phoneOf(vendor),
      services: servicesLabel(seats),
      serviceDefinitionId: seats.length === 1 ? seats[0].serviceDefinitionId : null,
      manager: shoot?.project?.productionManagerEmployee?.employeeName || "",
      digests: digestsOf(shoot, seats),
      snapshot: snapshotOf(shoot, seats),
      notice: notice || null,
      /* A change inside the two days answers for the reminder as well: both would say the shoot is on
       * the same day, and the change is the one worth reading. */
      coversReminder: withinReminder(shoot, now, daysBefore),
    });

    if (open) {
      for (const vendorId of confirmedVendorIds(production)) {
        onIt.add(vendorId);
        const seats = confirmedSeatsOf(production, vendorId);
        const vendor = seats[0].vendor;
        // A vendor binned since being planned is not messaged, and not chased either: there is
        // nobody there. The row stays, so re-instating them does not re-tell them.
        if (vendor?.isDeleted) continue;
        const notice = told.get(vendorId) || null;
        const digests = digestsOf(shoot, seats);

        if (!notice) { due.push(entry("CONFIRMED", { vendor, notice, seats })); continue; }
        // Marked as having nowhere to send: not retried until somebody saves a number.
        if (notice.needsNumber && !phoneOf(vendor)) continue;
        /*
         * A number has been saved since - so the row exists, but the confirm it was written for never
         * went. Owed as a CONFIRMED, not as a change: a vendor whose first message was held for want
         * of a number must still get the first message. Without this the row suppresses it for ever,
         * since its digests already match the shoot it was written from.
         */
        if (notice.needsNumber && !notice.confirmedSentAt) { due.push(entry("CONFIRMED", { vendor, notice, seats })); continue; }
        /*
         * The more disruptive change wins, and goes alone. A vendor whose shoot moved to another day
         * and another hall needs to know it moved; the hall is in the same message.
         */
        if (notice.shootDigest !== digests.shootDigest) { due.push(entry("DATE_CHANGED", { vendor, notice, seats })); continue; }
        if (notice.placeDigest !== digests.placeDigest) { due.push(entry("PLACE_CHANGED", { vendor, notice, seats })); continue; }
        if (notice.serviceDigest !== digests.serviceDigest) { due.push(entry("SERVICE_CHANGED", { vendor, notice, seats })); continue; }
        // Nothing has changed: the reminder, if it is near enough and has not gone.
        if (!notice.reminderSentAt && withinReminder(shoot, now, daysBefore)) due.push(entry("REMINDER", { vendor, notice, seats }));
      }
    }

    /*
     * Everybody told and no longer on it - whatever the reason. This runs even when the plan is not
     * `open`, because a withdrawn plan, a held plan and a deleted shoot are the cases a vendor most
     * needs chasing on, and the quiet window still applies so a plan mid-edit does not chase anybody.
     */
    for (const notice of told.values()) {
      if (onIt.has(notice.vendorId)) continue;
      if (!shared.settledFor(production, now, quietMs)) continue;
      /*
       * Never told anything, so there is nothing to take back: the row goes quietly. This is a row
       * held for want of a number - a vendor adopted at switch-on carries `confirmedSentAt`, because
       * somebody told them by hand before the switch and they will travel.
       */
      if (!notice.confirmedSentAt) { due.push({ kind: "STALE", production, shoot, notice, vendor: notice.vendor }); continue; }
      due.push({
        ...entry("REMOVED", { vendor: notice.vendor, notice }),
        // Composed from what was said, not from a plan that may no longer be readable.
        services: notice.lastService || "",
        snapshot: null,
      });
    }
  }
  return due;
}

/**
 * Rows for shoots whose day has passed, deleted.
 *
 * `vendorNoticesDue` asks only about shoots from today on, so it can never reach these and would
 * leave them for ever: one row per vendor per shoot, growing with every shoot the studio ever does.
 * Nothing is sent about a shoot that has already happened, so there is nothing to say first.
 */
async function dropPastNotices(now = new Date(), { client = prisma } = {}) {
  const { count } = await client.projectShootVendorNotice.deleteMany({
    where: { production: { shoot: { dateCreated: { lt: shared.dayStart(now) } } } },
  });
  if (count) console.log(`[vendor-shoot-notice] ${count} notice row${count === 1 ? "" : "s"} for shoots now past, dropped`);
  return count;
}

module.exports = {
  vendorNoticesDue, dropPastNotices, digestsOf, snapshotOf, confirmedSeatsOf, confirmedVendorIds,
  servicesLabel, phoneOf, withinReminder, messageable, dueInclude, DIGEST_VERSION,
};
