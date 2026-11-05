const prisma = require("../../../config/db");
const { MESSAGE_LABELS } = require("../../project-management/production/steps");
const { SCHEDULED_TRIGGERS } = require("../../../services/whatsappActivity");
const iamService = require("../../../services/iam.service");
// Which automatic messages can be switched off, and what switching one off answers - the same rule
// the switches themselves write by (`services/notificationSwitches.js`).
const { switchStates, answeredBySwitch } = require("../../../services/notificationSwitches");

/**
 * The messages that could not find their WhatsApp group — Settings → WhatsApp Activity Log's notice.
 *
 * A group is addressed in one of two ways, and only one of them breaks. A project's message goes to
 * a group **id** (`whatsappGroupJid`), stored when somebody linked the group, so renaming the group
 * on WhatsApp does not stop it. Everything else — the attendance report, the wishes, the photo
 * selection group — is looked up by **name** at send time:
 *
 *     groups.find((group) => group.subject.trim().toLowerCase() === wanted)?.jid || null
 *
 * so a group renamed on WhatsApp stops matching and the message silently does not go. Neither
 * failure announced itself anywhere: the studio found out when somebody noticed a message had never
 * arrived.
 *
 * This collects both from where they already are, rather than keeping a third copy of them:
 *
 *   * **A project's step message** — a `ProjectProductionMessage` row at `FAILED` whose `reason` is
 *     `NO_GROUP_REASON`, which `sendStepMessage` writes when the project has no linked group (or
 *     whoever linked it no longer has a login).
 *   * **A message addressed by name** — a `WhatsAppActivity` row at `FAILED` whose failure says the
 *     group could not be found.
 *
 * **Retry belongs to the module that owns the message, not to this notice.** Production already has
 * one, and its own comment says why it is the only safe place for it: *"Claimed first with a
 * conditional `updateMany`, so two presses (or a press racing a still-live send) cannot both call
 * `sendMessageToGroup`; the loser gets 409."* That claim is what makes the retry safe for several
 * people at once, and a second retry written here would sit beside it and not share it. So each row
 * carries `retry` — the module's own endpoint and the permission that guards it — and the notice
 * sends people there.
 *
 * A scheduled message carries no `retry` at all. Its scheduler tries again on its own (which is why
 * `resendRefusal` already refuses to resend one by hand), so once the group name matches, the next
 * run sends it; a button here would race the scheduler to send the same message twice.
 */

/** What `sendStepMessage` writes as the reason when a project's group cannot be addressed. */
const NO_GROUP_REASON = "No WhatsApp group linked";

/**
 * How a failed `WhatsAppActivity` row says the group was not found.
 *
 * Matched on the reason rather than on a failure code: codes here are whatever each caller passed
 * (`EXPIRED` and `PROVIDER_FAILED` are the only fixed ones), so there is no code to match on yet.
 * The phrases are the ones the senders actually write - `reportGroup.js` skips with `no group named
 * "<name>" among their own WhatsApp groups`.
 */
const NO_GROUP_PHRASES = ["no group named", "no whatsapp group", "no group linked", "group not found"];

/** The most name-addressed failures the notice will read at once; `truncated` says it was reached. */
const ACTIVITY_CAP = 200;


const saysNoGroup = (text) => {
  const haystack = String(text || "").toLowerCase();
  return NO_GROUP_PHRASES.some((phrase) => haystack.includes(phrase));
};

/** One project step message that never left, and where its Retry lives. */
function productionRow(row, reach = {}) {
  const production = row.production || {};
  const project = production.salesProject || {};
  // The endpoint allows the project's own Production Manager, or Show All Projects at Read / Write.
  const mayRetry = Boolean(reach.retriesAnywhere
    || (reach.myEmployeeId && project.productionManagerEmployeeId === reach.myEmployeeId));
  return {
    key: `production:${row.productionId}:${row.step}`,
    source: "PRODUCTION",
    what: MESSAGE_LABELS[row.step] || row.step,
    where: project.eventId || "A project",
    projectId: project.id || null,
    // The name the app expects the group to have. Linking matches on exactly this.
    expectedGroupName: project.whatsappGroupName || "",
    reason: row.reason || NO_GROUP_REASON,
    failedAt: row.updatedAt,
    /*
     * The module's own endpoint, with the permission that guards it. The notice draws Retry only for
     * somebody who holds that permission at Read / Write - a reader of this log is not thereby
     * allowed to send a project's messages.
     */
    /*
     * What to retry, not where, and not who may. The ids and the kind go over and the caller builds
     * the URL from them - a client that POSTed to whatever path a response handed it would be one
     * response away from posting somewhere else. The permission is **not** sent: it is a constant the
     * frontend already holds, and a response that named it could disagree with the guard that
     * actually decides.
     */
    retry: production.shootId && mayRetry ? { kind: "PRODUCTION_MESSAGE", shootId: production.shootId, step: row.step } : null,
    // Said instead of a button when there is nothing for a person to press.
    /*
     * Every production row here is waiting on the same thing - the project has no group linked - so
     * the note names the job, not the row. For somebody who cannot press Retry it also says who
     * finishes it, rather than leaving them looking for a button that is not theirs.
     */
    note: !production.shootId ? "This shoot is no longer in the plan."
      : mayRetry ? null
        : "Its WhatsApp group is not linked. Whoever manages this project's pre production can link it on Pre Production → General, and its Production Manager sends this again from the shoot's Execution tab.",
  };
}

/** One name-addressed message that found no group. */
function activityRow(row) {
  const scheduled = SCHEDULED_TRIGGERS.includes(row.trigger);
  return {
    key: `activity:${row.id}`,
    source: "ACTIVITY",
    activityId: row.id,
    what: row.trigger,
    where: row.recipientName || "A WhatsApp group",
    expectedGroupName: row.recipientName || "",
    reason: row.failureReason || "The group could not be found.",
    failedAt: row.updatedAt,
    retry: null,
    note: scheduled
      ? "Its scheduler sends this again on its own, so it will go once the group's name matches."
      : "Send this again from the screen it came from.",
  };
}

/**
 * Whose failures a viewer is shown.
 *
 * **This is the access control, not a filter applied after one.** The route carries `protect` and no
 * permission guard: a permission answers *may you open this screen*, and the bar is not a screen
 * anybody opens - it is a strip about the reader's own work, which IAM.md's "Whose records" says has
 * "one answer for everybody, no setting, per role or otherwise". A tickable gate in front of it could
 * only ever hide a project manager's own row from them, and did. So what this answers with is the
 * whole of what anybody may see, and it narrows the way a payment request's list does:
 *
 *   * **Every project** for somebody who may see every project — `PROJECT / Show All Projects`, which
 *     a Super Admin and the studio's administrators hold. They are the ones who fix a Settings group
 *     nobody owns, so a narrowed list would hide from them the very rows only they can clear.
 *   * **Their own** for everybody else: the projects they are the **project manager** of
 *     (`projectManagerEmployeeId` against the viewer's linked employee). A project manager is told
 *     their own client's message never went, and is told nothing about anybody else's.
 *
 * A name-addressed failure (the attendance report, the wishes) belongs to no project and so to no
 * project manager; only a see-everything viewer is shown those.
 */
async function reachFor(user, client) {
  if (!user) return { all: true, employeeId: null, retriesAnywhere: true };
  const row = await client.user.findUnique({ where: { id: Number(user.id) }, select: { linkedEmployeeId: true } });
  const employeeId = row?.linkedEmployeeId || null;
  /*
   * Two different questions, asked of the same person.
   *
   * **What they are shown** is Show All Projects at Read, or their own projects. **What they may
   * retry** is what `production/access.accessFor(...).canEditPlan` allows - Show All Projects at
   * Read / Write, or being that project's own Production Manager - because `retryMessage` is the
   * thing that will actually answer the button. Asking the first question for both is how the bar
   * came to offer a Retry that answered "Only this project's Production Manager can retry its
   * messages" to the person who pressed it.
   */
  const [all, retriesAnywhere] = await Promise.all([
    iamService.hasPermission(user.id, "PROJECT", "Show All Projects", "READ"),
    iamService.hasPermission(user.id, "PROJECT", "Show All Projects", "READ_WRITE"),
  ]);
  // No linked employee is no project to manage, so nothing of their own to be shown.
  return { all: Boolean(all), employeeId: all ? null : employeeId, retriesAnywhere: Boolean(retriesAnywhere), myEmployeeId: employeeId };
}

/*
 * **A project's step messages are shown in the notice.**
 *
 * They were taken out once: the bar carried every production step message a project had waiting -
 * started to shoot, reached venue, shoot completed - so a project with several shoots filled it with
 * rows whose answer was always the same single job, linking the group. And it offered a Retry the
 * viewer often could not use: the bar drew that button from `PROJECT / Production` at Read / Write,
 * while `retryMessage` allows only that project's **Production Manager**, so anybody else pressed it
 * and got "Only this project's Production Manager can retry its messages".
 *
 * Both of those are answered now rather than avoided. The rows **group by the project** (below), so
 * six shoots waiting on one group read as the one job they are, with a count - that is what the
 * grouping is for. And `productionRow` offers the Retry only to somebody the endpoint will accept,
 * saying who it belongs to otherwise, so the button no longer refuses the person who pressed it.
 *
 * It stays the default of an argument rather than a plain `true`, so a caller - and the tests - can
 * still ask for the notice without them.
 */
const SHOWS_PRODUCTION_STEPS = true;

/** Every message now waiting on a group that this viewer is the one to hear about, newest first. */
async function listGroupFailures({ client = prisma, user = null, includeProductionSteps = SHOWS_PRODUCTION_STEPS } = {}) {
  const reach = await reachFor(user, client);
  const [steps, activities] = await Promise.all([
    includeProductionSteps ? client.projectProductionMessage.findMany({
      where: {
        status: "FAILED",
        reason: NO_GROUP_REASON,
        // Narrowed in the query: a project manager is never sent another manager's rows to filter out.
        /*
         * Narrowed to the projects this person has something to do with: the ones they manage, and
         * the ones they are the Production Manager of - the role the Retry answers to. Narrowing by
         * the project manager alone hid the rows from the very people who could retry them.
         */
        ...(reach.all ? {} : { production: { salesProject: { OR: [
          { projectManagerEmployeeId: reach.myEmployeeId ?? -1 },
          { productionManagerEmployeeId: reach.myEmployeeId ?? -1 },
        ] } } }),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        productionId: true,
        step: true,
        reason: true,
        updatedAt: true,
        production: {
          select: {
            shootId: true,
            salesProject: { select: { id: true, eventId: true, whatsappGroupName: true, deletedAt: true, productionManagerEmployeeId: true } },
          },
        },
      },
    }) : [],
    /*
     * Narrowed in the query, not after it.
     *
     * This took the newest 200 FAILED group rows of **any** reason and sifted them in JS, so one
     * busy day of unrelated failures - a provider outage, a run of EXPIRED - pushed a real no-group
     * failure past the cap and the notice said nothing was waiting. For a notice nobody can dismiss,
     * silently losing the work it exists to show is the worst thing it can do.
     *
     * `productionId: null` leaves out the activities that log a project's step message: that message
     * has its own row above, which is the one that knows where Retry lives, and this was matching
     * them by picking `production:<id>:<step>` apart - the very thing `eventRef`'s own comment says
     * not to do when the id is a column.
     *
     * The cap stays as a ceiling, and `truncated` says when it was hit so the notice can admit there
     * are more rather than imply these are all. Ordered by `createdAt`, which `(status, createdAt)`
     * indexes, rather than by `updatedAt`, which would add a filesort over every failed message.
     */
    /*
     * A name-addressed failure - the attendance report, the wishes - belongs to no project, so there
     * is no project manager it is theirs to hear about. Not queried at all for a narrowed viewer,
     * rather than queried and filtered: asking for rows nobody is going to be shown is work for
     * nothing, and a second `where` on the object below would have replaced the narrowing in it, not
     * added to it.
     */
    reach.all ? client.whatsAppActivity.findMany({
      where: {
        status: "FAILED",
        recipientKind: "GROUP",
        productionId: null,
        OR: NO_GROUP_PHRASES.flatMap((phrase) => [{ failureReason: { contains: phrase } }, { failureCode: { contains: phrase } }]),
      },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_CAP,
      // `createdAt` as well as `updatedAt`: when it failed is what decides whether a switch has
      // already answered it (`answeredBySwitch`).
      select: { id: true, trigger: true, recipientName: true, failureReason: true, failureCode: true, createdAt: true, updatedAt: true },
    }) : [],
  ]);

  // A project in the bin is not work anybody has to fix.
  const stepRows = steps
    .filter((row) => row.production?.salesProject && !row.production.salesProject.deletedAt)
    .map((row) => productionRow(row, reach));
  /*
   * One failure, one row.
   *
   * A project's step message writes **both** records - its own `ProjectProductionMessage` and the
   * `WhatsAppActivity` that logs it - so listing the two sources naively showed every project
   * failure twice: once with its Retry and once saying "send this again from the screen it came
   * from". The activity carries `productionId`, so the query above leaves those out and the step row
   * is the only one left: it is the one that knows where Retry lives.
   */
  /*
   * A message switched off is not work anybody is waiting to do, and neither is one that failed
   * before it was switched off and has since been switched back on: switching a notification on
   * starts it fresh, reporting what goes wrong from then on and never what went wrong before.
   */
  const switches = await switchStates(client);
  const rows = [...stepRows, ...activities.filter((activity) => !answeredBySwitch(activity, switches)).map(activityRow)];
  rows.sort((a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime());

  /*
   * Grouped by the thing somebody has to fix, not by the messages waiting on it.
   *
   * One project with six shoots is six failed messages and **one** job: link that project's group.
   * Listed flat it read as six problems, the same project six times, and somebody would have gone
   * looking for six fixes. So the rows gather under the group name they were all looking for, which
   * is what the reader acts on, and each group says how many messages are waiting behind it.
   */
  const groups = new Map();
  for (const row of rows) {
    // The project is the job where there is one; a name-addressed message is its own.
    const key = row.projectId
      || (row.expectedGroupName ? `name:${row.expectedGroupName.toLowerCase()}` : row.key);
    const group = groups.get(key) || {
      key,
      where: row.where,
      projectId: row.projectId || null,
      expectedGroupName: row.expectedGroupName,
      failedAt: row.failedAt,
      messages: [],
    };
    group.messages.push(row);
    groups.set(key, group);
  }
  const grouped = [...groups.values()].map((group) => ({
    ...group,
    // Drawn as one button for the group: every message under it is retried, each claimed on its own
    // by the module's endpoint, so two readers pressing it still send each message once.
    retriable: group.messages.filter((row) => row.retry).length,
  }));
  return { groups: grouped, total: rows.length, truncated: activities.length >= ACTIVITY_CAP };
}

module.exports = { listGroupFailures, reachFor, SHOWS_PRODUCTION_STEPS, NO_GROUP_REASON, NO_GROUP_PHRASES, ACTIVITY_CAP, saysNoGroup };
