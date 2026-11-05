const prisma = require("../../../config/db");
const { switchOffData } = require("../../../services/notificationSwitches");
const { TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const shared = require("./shared");
const projectSender = require("./projectSender");

/*
 * Settings → Project Management → Shoot crew notice: the two switches, and what is waiting.
 *
 * **Who sends it is no longer chosen here.** The crew arm sends from each project's own
 * Pre-Production Coordinator and the vendor arm from its Production Manager (`projectSender.js`), so
 * there is nothing to pick: a Sender and a Rotation that decide nothing would be worse than no
 * setting at all, since somebody would drag an order and believe it mattered.
 *
 * What the panel shows instead is **what is waiting and why** - a project with nobody named in the
 * role, a role-holder with no login or without Allow WhatsApp, one whose WhatsApp is not connected,
 * a vendor with no number. Each is fixed by a different person, so each says which.
 *
 * The two arms switch independently: vendors can go live without touching what already works for the
 * studio's own people, and each arm keeps its own claim and its own last trouble.
 */

const SETTINGS_ID = "default";
const MAX_ERROR_CHARS = 4000;
const PLACEHOLDERS = ["employee name", "shoot", "shoot id", "project", "event id", "date", "day", "time", "place", "district", "service", "coordinator"];
const VENDOR_PLACEHOLDERS = ["vendor name", "shoot", "shoot id", "project", "event id", "date", "day", "time", "place", "district", "service", "manager name"];
/** The six vendor wordings, in the order a reader meets them. */
const VENDOR_TEMPLATE_KEYS = [
  TEMPLATE_KEYS.VENDOR_SHOOT_CONFIRMED,
  TEMPLATE_KEYS.VENDOR_SHOOT_REMINDER,
  TEMPLATE_KEYS.VENDOR_SHOOT_DATE_CHANGED,
  TEMPLATE_KEYS.VENDOR_SHOOT_PLACE_CHANGED,
  TEMPLATE_KEYS.VENDOR_SHOOT_SERVICE_CHANGED,
  TEMPLATE_KEYS.VENDOR_SHOOT_REMOVED,
];
const VENDOR_TRIGGERS = ["VENDOR_SHOOT_CONFIRMED", "VENDOR_SHOOT_REMINDER", "VENDOR_SHOOT_DATE_CHANGED", "VENDOR_SHOOT_PLACE_CHANGED", "VENDOR_SHOOT_SERVICE_CHANGED", "VENDOR_SHOOT_REMOVED"];

const failure = (status, message) => Object.assign(new Error(message), { status });

const settingsRow = (client = prisma) => client.shootCrewNoticeSettings.findUnique({
  where: { id: SETTINGS_ID },
  select: { enabled: true, vendorEnabled: true, lastAttemptAt: true, lastError: true, vendorLastAttemptAt: true, vendorLastError: true },
});

const upsert = (data, client = prisma) => client.shootCrewNoticeSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });

const lastSentAt = (triggers, client) => client.whatsAppActivity.findFirst({
  where: { trigger: { in: triggers }, status: { in: ["SENT", "DELIVERED", "READ"] } },
  orderBy: { sentAt: "desc" },
  select: { sentAt: true },
});

/**
 * Every message that cannot go right now, and why - the only place a stuck message is visible.
 *
 * **It asks the owed-lists, not the plans.** The first version asked which projects had crew or a
 * confirmed vendor and whether that project's sender could send, which listed a project whose vendors
 * had all been told long ago: nothing was waiting, and the panel said something was. What is waiting
 * is by definition what the sweep would try, so this asks the same two functions the sweep asks and
 * then asks who each answer would come from.
 *
 * One row per project per arm, because the two roles are two different people and one may be able to
 * send while the other cannot. Senders are resolved per **employee**, not per project, so somebody
 * who manages thirty projects is looked up once.
 */
const MAX_WAITING = 50;

async function waiting({ client = prisma, now = new Date(), enabled = false, vendorEnabled = false } = {}) {
  if (!enabled && !vendorEnabled) return [];
  const { crewNoticesDue } = require("./due");
  const { vendorNoticesDue } = require("./vendorDue");
  const [crew, vendors] = await Promise.all([
    enabled ? crewNoticesDue(now, { client }).catch(() => []) : [],
    vendorEnabled ? vendorNoticesDue(now, { client }).catch(() => []) : [],
  ]);

  const rows = new Map();
  const answers = new Map();
  /** Resolved once per person per role, however many projects they hold. */
  const askedFor = async (project, role) => {
    const key = `${project?.[role.employeeIdField] || "none"}:${role.key}`;
    if (!answers.has(key)) answers.set(key, await projectSender.resolve(project, role, { client }));
    return answers.get(key);
  };

  const owed = [
    ...crew.map((item) => [item, projectSender.ROLES.PRE_PRODUCTION_COORDINATOR, "crew"]),
    // A row the sweep drops without sending is nobody's to chase.
    ...vendors.filter((item) => item.kind !== "STALE").map((item) => [item, projectSender.ROLES.PRODUCTION_MANAGER, "vendor"]),
  ];

  for (const [item, role, arm] of owed) {
    if (rows.size >= MAX_WAITING) break;
    const project = item.project || item.shoot?.project;
    if (!project?.id) continue;
    const key = `${project.id}:${arm}`;
    if (rows.has(key)) continue;
    /*
     * A vendor with nowhere to send is its own kind of waiting, and no amount of connecting fixes it:
     * said against the vendor rather than against the project's manager, who may be perfectly able.
     */
    if (arm === "vendor" && item.notice?.needsNumber && !item.phone) {
      rows.set(`vendor:${item.vendor?.id}`, {
        projectId: null, project: null, vendorId: item.vendor?.id || null, arm: "vendor", role: null,
        person: item.vendor?.vendorName || null,
        why: "NO_NUMBER",
        reason: `${item.vendor?.vendorName || "This vendor"} has no WhatsApp or mobile number saved, so there is nobody to send to.`,
      });
      continue;
    }
    const answer = await askedFor(project, role);
    if (answer.ok) continue;
    rows.set(key, {
      projectId: project.id,
      project: project.whatsappGroupName || project.eventId || project.id,
      vendorId: null,
      arm,
      role: role.label,
      person: answer.name || null,
      why: answer.why,
      reason: answer.reason,
    });
  }
  return [...rows.values()];
}

/** How both arms stand: the two switches, when each last sent, the last trouble, and what is waiting. */
async function status({ client = prisma, canWrite = false, now = new Date() } = {}) {
  const row = await settingsRow(client);
  const enabled = Boolean(row?.enabled);
  const vendorEnabled = Boolean(row?.vendorEnabled);
  const [crewLast, vendorLast, stuck] = await Promise.all([
    lastSentAt(["SHOOT_CREW_ASSIGNED", "SHOOT_CREW_REMOVED"], client),
    lastSentAt(VENDOR_TRIGGERS, client),
    waiting({ client, now, enabled, vendorEnabled }),
  ]);
  return {
    enabled,
    vendorEnabled,
    lastSentAt: crewLast?.sentAt || null,
    lastError: row?.lastError || null,
    vendorLastSentAt: vendorLast?.sentAt || null,
    vendorLastError: row?.vendorLastError || null,
    waiting: stuck,
    canWrite,
    senderRole: projectSender.ROLES.PRE_PRODUCTION_COORDINATOR.label,
    vendorSenderRole: projectSender.ROLES.PRODUCTION_MANAGER.label,
    templateKey: TEMPLATE_KEYS.SHOOT_CREW_ASSIGNED,
    removedTemplateKey: TEMPLATE_KEYS.SHOOT_CREW_REMOVED,
    vendorTemplateKeys: VENDOR_TEMPLATE_KEYS,
    placeholders: PLACEHOLDERS,
    vendorPlaceholders: VENDOR_PLACEHOLDERS,
  };
}

/** The crew switch. Nothing to refuse it for now: who sends it is the project's, not a setting. */
async function setEnabled(enabled, { client = prisma } = {}) {
  if (typeof enabled !== "boolean") throw failure(400, "Say whether it is on or off.");
  await upsert({ enabled, ...switchOffData("enabled", enabled) }, client);
  return status({ client, canWrite: true });
}

/**
 * The vendor switch - and, where it is being switched **on**, the thing that keeps switching it on
 * from being an event.
 *
 * Every vendor already confirmed gets a row recording the shoot **as it now stands**, so the first
 * sweep finds nothing changed and sends them nothing. Without this, turning the switch on would owe a
 * confirm message to every confirmed vendor in the studio at once, pushed out through the managers'
 * own personal numbers - the one burst that gets a number banned. Their later change messages work
 * normally, which is what the studio asked for.
 *
 * Two things the row has to say, both learnt the hard way:
 *
 *   - `confirmedSentAt` is **set**. Somebody told these vendors by hand before the switch, so they
 *     will travel; a row that says nothing was ever sent is read as "never told", and a vendor later
 *     taken off the shoot would have their row dropped in silence instead of being told not to come.
 *   - `reminderSentAt` is set **only for a shoot already inside the reminder window**. Otherwise the
 *     very first sweep owes a reminder to every confirmed vendor on every shoot in the next three
 *     days and sends them at once - which is the burst this function exists to prevent, wearing
 *     another hat. A shoot further out still gets its reminder two days before, as it should.
 */
async function setVendorEnabled(enabled, { client = prisma, now = new Date() } = {}) {
  if (typeof enabled !== "boolean") throw failure(400, "Say whether it is on or off.");
  if (enabled) await adoptConfirmedVendors({ client, now });
  await upsert({ vendorEnabled: enabled, ...switchOffData("vendorEnabled", enabled) }, client);
  return status({ client, canWrite: true });
}

/** Writes "already told" rows for every vendor confirmed on a shoot still to come. Never messages. */
async function adoptConfirmedVendors({ client = prisma, now = new Date() } = {}) {
  const vendorDue = require("./vendorDue");
  const productions = await client.projectProduction.findMany({
    where: {
      shoot: { deletedAt: null, dateCreated: { gte: shared.dayStart(now) }, project: { deletedAt: null } },
      serviceCrew: { some: { vendorId: { not: null }, vendorStatus: "CONFIRMED" } },
    },
    include: vendorDue.dueInclude,
  });
  let adopted = 0;
  for (const production of productions) {
    const told = new Set((production.vendorNotices || []).map((notice) => notice.vendorId));
    for (const vendorId of vendorDue.confirmedVendorIds(production)) {
      if (told.has(vendorId)) continue;
      const seats = vendorDue.confirmedSeatsOf(production, vendorId);
      try {
        await client.projectShootVendorNotice.create({
          data: {
            productionId: production.id,
            vendorId,
            serviceDefinitionId: seats.length === 1 ? seats[0].serviceDefinitionId : null,
            ...vendorDue.digestsOf(production.shoot, seats),
            ...vendorDue.snapshotOf(production.shoot, seats),
            confirmedSentAt: now,
            reminderSentAt: vendorDue.withinReminder(production.shoot, now, shared.DAYS_BEFORE) ? now : null,
            sentAt: now,
          },
        });
        adopted += 1;
      } catch (error) {
        // Another process got there first, which is the same outcome.
        if (error?.code !== "P2002") throw error;
      }
    }
  }
  if (adopted) console.log(`[vendor-shoot-notice] ${adopted} vendor${adopted === 1 ? "" : "s"} already confirmed recorded as told, so switching on sends nothing`);
  return adopted;
}

/**
 * Keeps why the last sweep of each arm could not send everything, for the panel to show.
 *
 * **It must not touch `lastAttemptAt` / `vendorLastAttemptAt`.** Those are the sweep's claim, taken at
 * its *start* and held for `CLAIM_MS` (50s) against a 60s tick. Writing the time again at the *end*
 * pushed the claim forward by however long the sweep took, so any sweep that ran more than about ten
 * seconds - two sends, at three to five seconds apart - left the claim still live when the next tick
 * came, and that tick found nothing to do. Under load every second sweep was lost, which looks
 * exactly like messages being slow for no reason.
 */
const keepError = (message, client = prisma) => upsert({ lastError: message ? String(message).slice(0, MAX_ERROR_CHARS) : null }, client).catch(() => {});
const keepVendorError = (message, client = prisma) => upsert({ vendorLastError: message ? String(message).slice(0, MAX_ERROR_CHARS) : null }, client).catch(() => {});

module.exports = {
  SETTINGS_ID, PLACEHOLDERS, VENDOR_PLACEHOLDERS, VENDOR_TEMPLATE_KEYS, VENDOR_TRIGGERS,
  settingsRow, status, waiting, setEnabled, setVendorEnabled, adoptConfirmedVendors, keepError, keepVendorError,
};
