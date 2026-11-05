const prisma = require("../../config/db");
const { ensureTable: ensureWhatsAppMessageTable } = require("../sales/whatsapp-chat/repository");

/*
 * ── What the bell is about ────────────────────────────────────────────────────────────────────
 *
 * It was the studio's meetings and nothing else, on the reasoning that a Meet starting without the
 * salesperson is the one failure the CRM exists to prevent. That is true and it is not the only
 * thing waiting on somebody: a follow-up booked for this morning, a client who replied on WhatsApp
 * an hour ago, a call nobody has read yet, an approval sitting in somebody's queue. All of those
 * are work with a clock on it, and none of them appeared anywhere until you went looking.
 *
 * ── A registry, not a query ──
 *
 * Each source is one entry here: the permission it answers to, and a function that returns what is
 * waiting *for this person*. Adding a sixth is adding an entry - it is picked up by the endpoint,
 * gated, counted and rendered without touching anything else - which is the property that matters,
 * because there will be a sixth.
 *
 * ── Scoped to the person, not to the studio - unless the person is not scoped either ─────────
 *
 * "Notifications related to their user": every source answers about the signed-in person's own
 * work. A CRM sees the follow-ups they are assigned and the clients who replied to *them*; an
 * approver sees the requests waiting on their own decision. A bell counting the whole studio's work
 * would read the same on Monday morning as on Friday night and be ignored by both.
 *
 * An administrator is the exception, and it is not a special case bolted on: it is the same rule
 * read to its end. `viewer.everyone` is `dataScope.seesEverything` - a Super Admin, or anybody the
 * branch reach does not confine - which is precisely the set of people for whom "your own work" is
 * the studio's. Their bell is the whole floor's, because that is what their screens already show
 * them, and it is decided by the one rule that decides whose rows anybody gets rather than by a
 * role test written here. A studio-wide notice names whose it is, since for that reader "who" is
 * the first thing the line has to say.
 *
 * The CRM's leads name their owner as an **employee** (`owner_employee_id`, beside the `crm` text
 * the board prints), so "mine" there is the employee behind the signed-in login - `viewer.employeeId`
 * - and only a lead whose owner matched nobody falls back to the name. Callyzer's call log is the one
 * source still matched on a name, because the handset reports one and nothing else.
 *
 * ── Never throws ──
 *
 * A source that fails contributes nothing and the bell shows the rest. This hangs off the topbar on
 * every screen in the application; one bad query must not be able to take that with it.
 */

/** Today, in the studio's own day, which is what a follow-up date is written in. */
function studioToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

const num = (value) => Number(value ?? 0) || 0;

async function safely(what, run) {
  try {
    return await run();
  } catch (error) {
    console.warn(`Unable to build the ${what} notifications:`, error?.message || error);
    return [];
  }
}

/**
 * A notice, in the shape the bell draws.
 *
 * `id` has to be stable across polls: the browser remembers which notices have been looked at, and
 * an id built from the moment it was read would light the badge again every minute. So it is built
 * from what the notice is *about* - this lead, this request - and never from a timestamp.
 *
 * `href` is where the work is done. A notice that says something is waiting and does not say where
 * is a notice somebody has to go and find, which is most of the work it was meant to save.
 */
/**
 * When the notice is *about*, as an ISO string - or null when that cannot be worked out.
 *
 * `new Date(x).toISOString()` throws on anything it cannot read, and a throw here is not a missing
 * timestamp: it happens inside a source, so `safely` catches it and that source contributes nothing.
 * One row with an odd date would take every notice of its kind with it. A notice with no `at` still
 * draws - the bell sorts it last - so answering null is the smaller loss by far.
 */
function isoMoment(value) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function notice({ id, kind, title, detail = "", at = null, href = "", tone = "info" }) {
  return { id, kind, title, detail, at: isoMoment(at), href, tone };
}

/*
 * ── The sources ───────────────────────────────────────────────────────────────────────────────
 */

/**
 * Follow-ups this person owes a client, today or already late.
 *
 * `follow_up_day` is the stored, indexed form of the follow-up date - the same column the board's
 * own Pending Followups tabs read, so the bell and the tab cannot disagree about what is due. A
 * lead that has been converted, rejected or marked invalid is not owed a call, whatever date is
 * still written on it.
 */
async function followUps({ userName, employeeId = null, everyone = false }) {
  if (!everyone && !userName && !employeeId) return [];
  const today = studioToday();
  /*
   * The studio's, or this person's. Written as one clause or the other rather than as a clause that
   * is sometimes `1=1`, so the parameters and the SQL are built together and cannot fall out of step.
   *
   * "This person's" is the lead's `owner_employee_id` - the reference the data-scope work put beside
   * the `crm` text, and the same column the board narrows by - so a lead follows its owner through a
   * rename and two logins sharing a name no longer share each other's follow-ups. The name is kept
   * only for a lead whose owner matched nobody (`owner_employee_id IS NULL`), which is the one case
   * where the text is all there is; a login with no employee behind it has only the name to offer.
   */
  const mine = everyone
    ? "1=1"
    : employeeId
      ? "(`owner_employee_id` = ? OR (`owner_employee_id` IS NULL AND TRIM(COALESCE(`crm`, '')) = ?))"
      : "TRIM(COALESCE(`crm`, '')) = ?";
  const mineParams = everyone ? [] : employeeId ? [employeeId, userName] : [userName];
  const rows = await prisma.$queryRawUnsafe(
    /*
     * `DATE_FORMAT` rather than the bare column, and it is the whole of a bug worth remembering.
     *
     * `follow_up_day` is a DATE, and Prisma hands a DATE back as a JavaScript `Date` - so
     * `String(row.day).slice(0, 10)` read "Wed Sep 09" off it rather than "2026-09-09", and the `at`
     * built from that threw `Invalid time value` in `notice`. Because the throw happened inside the
     * source, `safely` swallowed it and the bell showed **no follow-ups at all** - every one of them
     * lost to one unparsed date, silently, with only a warning in the log to say so.
     *
     * Asked of MySQL rather than folded here because the day is compared as text further down
     * (`day < today`), and a string is the only shape that comparison is right for.
     */
    "SELECT `enquiry_id` AS `enquiryId`, `name`, DATE_FORMAT(`follow_up_day`, '%Y-%m-%d') AS `day`, `vertical`,"
    // The owner's current name through the reference, the text only where nothing is linked.
    + "       COALESCE((SELECT `e`.`employee_name` FROM `employee` AS `e` WHERE `e`.`id` = `sales_crm_lead`.`owner_employee_id`), TRIM(COALESCE(`crm`, ''))) AS `crm`"
    + " FROM `sales_crm_lead`"
    + ` WHERE \`deleted_at\` IS NULL AND ${mine}`
    + "   AND `follow_up_day` IS NOT NULL AND `follow_up_day` <= ?"
    + "   AND LOWER(TRIM(COALESCE(`status`, ''))) NOT IN ('converted', 'rejected', 'invalid')"
    + " ORDER BY `follow_up_day` ASC LIMIT 50",
    ...mineParams,
    today,
  );
  return rows.map((row) => {
    const day = String(row.day || "").slice(0, 10);
    const late = day < today;
    // Whose it is, but only where that is not already known: on a personal bell every line is the
    // reader's own, and appending their own name to all fifty says nothing.
    const owner = everyone && row.crm ? ` · ${row.crm}` : "";
    return notice({
      id: `followup:${row.enquiryId}:${day}`,
      kind: "Follow-up",
      title: row.name || row.enquiryId,
      detail: (late ? `Follow-up was due ${day}` : "Follow-up due today") + owner,
      at: `${day}T00:00:00.000Z`,
      // Opens that lead wherever the reader is, through the link the Contacts directory already uses.
      href: `/sales/crm?lead=${encodeURIComponent(row.enquiryId)}`,
      tone: late ? "urgent" : "due",
    });
  });
}

/**
 * Clients who replied and have not been answered.
 *
 * The last message in the thread came from them, which is the whole test - a conversation where the
 * studio spoke last is not waiting on anybody. Scoped to this person's own chat: the WhatsApp
 * session is per user, and every message carries the user whose socket it arrived on - so this is
 * the one source where "mine" is a real user id rather than a matched name. Widened to every
 * session for a reader the data scope does not confine; see the note at the top of this file.
 */
async function whatsappReplies({ userId, everyone = false }) {
  if (!everyone && !userId) return [];
  // This module's table is made at runtime rather than by Prisma Migrate (see the whatsapp-chat
  // repository), so a server that has never had anyone open the chat panel must still make it here.
  await ensureWhatsAppMessageTable();
  const mine = everyone ? "1=1" : "`m`.`userId` = ?";
  const rows = await prisma.$queryRawUnsafe(
    "SELECT `m`.`enquiryId` AS `enquiryId`, `m`.`body`, `m`.`mediaType`, `m`.`sentAt` AS `sentAt`,"
    + "       COALESCE(NULLIF(TRIM(`l`.`name`), ''), `m`.`enquiryId`) AS `client`"
    + "  FROM `SalesCrmWhatsAppMessage` AS `m`"
    + "  JOIN `sales_crm_lead` AS `l` ON `l`.`enquiry_id` = `m`.`enquiryId` AND `l`.`deleted_at` IS NULL"
    + ` WHERE ${mine} AND \`m\`.\`deletedAt\` IS NULL`
    /*
     * The newest message in that thread, and it is theirs. The subquery is the same thread the
     * panel draws - one lead, one chat address - so "last message" means the same thing in both.
     */
    + "   AND `m`.`direction` = 'in'"
    + "   AND `m`.`sentAt` = (SELECT MAX(`n`.`sentAt`) FROM `SalesCrmWhatsAppMessage` AS `n`"
    + "                        WHERE `n`.`enquiryId` = `m`.`enquiryId` AND `n`.`chatJid` = `m`.`chatJid`"
    + "                          AND `n`.`deletedAt` IS NULL)"
    + " ORDER BY `m`.`sentAt` DESC LIMIT 50",
    ...(everyone ? [] : [userId]),
  );
  /*
   * One notice per conversation.
   *
   * Two messages can carry the same `sentAt` - WhatsApp records to the second, and a client sending
   * two lines at once is one second - which would make the correlated MAX above match both. Deduped
   * here rather than with a `GROUP BY`, which under `ONLY_FULL_GROUP_BY` has to name every selected
   * column and so groups by the message rather than by the thread, which is not the same thing.
   */
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row.enquiryId)) return false;
    seen.add(row.enquiryId);
    return true;
  }).map((row) => notice({
    id: `whatsapp:${row.enquiryId}:${new Date(row.sentAt).getTime()}`,
    kind: "WhatsApp",
    title: row.client,
    detail: String(row.body || "").trim() || (row.mediaType ? `Sent ${row.mediaType}` : "Replied"),
    at: row.sentAt,
    href: `/sales/crm?lead=${encodeURIComponent(row.enquiryId)}`,
    tone: "due",
  }));
}

/**
 * Calls this person took that are still nobody's enquiry.
 *
 * Their own, by the employee Callyzer reported the call against - the same name the Calls board
 * shows under Attended By, and the whole studio's for a reader the data scope does not confine. A
 * call the studio never picked up is the one worth surfacing first, which is why it is named in the
 * detail rather than left to be worked out from the row.
 */
async function callsWaiting({ userName, everyone = false }) {
  if (!everyone && !userName) return [];
  const mine = everyone ? "1=1" : "TRIM(COALESCE(`c`.`employee_name`, '')) = ?";
  const rows = await prisma.$queryRawUnsafe(
    "SELECT `c`.`call_id` AS `callId`, `c`.`client_name` AS `client`, `c`.`client_number` AS `number`,"
    + "       `c`.`call_type` AS `callType`, `c`.`called_at` AS `calledAt`,"
    + "       TRIM(COALESCE(`c`.`employee_name`, '')) AS `attendedBy`"
    + "  FROM `sales_crm_call_log` AS `c`"
    + ` WHERE ${mine}`
    + "   AND `c`.`call_id` IS NOT NULL"
    // Nobody's lead - tested against a live lead rather than against the text column, which goes
    // stale when one is deleted. The Calls board and the Contacts directory ask the same way.
    + "   AND NOT EXISTS (SELECT 1 FROM `sales_crm_lead` AS `l`"
    + "                    WHERE `l`.`enquiry_id` = `c`.`enquiry_id` AND `l`.`deleted_at` IS NULL)"
    + " ORDER BY `c`.`called_at` DESC LIMIT 50",
    ...(everyone ? [] : [userName]),
  );
  return rows.map((row) => {
    const missed = ["missed", "rejected"].includes(String(row.callType || "").trim().toLowerCase());
    const attendedBy = everyone && row.attendedBy ? ` · ${row.attendedBy}` : "";
    return notice({
      id: `call:${row.callId}`,
      kind: "Call",
      title: String(row.client || "").trim() || row.number || row.callId,
      detail: (missed ? "Missed call, not yet an enquiry" : "Call not yet an enquiry") + attendedBy,
      at: row.calledAt,
      href: "/sales/crm",
      tone: missed ? "urgent" : "info",
    });
  });
}

/**
 * Asset requests waiting on somebody who can approve one.
 *
 * Not scoped to the viewer the way the three above are, and deliberately: an approval is not
 * assigned to a person, it is assigned to a *permission*. Everyone who can approve is waiting on
 * it, and the gate on the source - `ASSET` / `Asset Request Approval` - is what makes that the
 * right list rather than the whole studio's.
 *
 * `requested_by` is a user id rather than a name, so the person is joined rather than read off the
 * request. Left-joined: a request whose author has since been removed is still a request somebody
 * has to decide, and losing it because the name has gone would be the wrong way round.
 */
async function assetApprovals() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT `r`.`id`, `r`.`request_code` AS `code`, `r`.`asset_name` AS `assetName`,"
    + "       `u`.`name` AS `requestedBy`, `r`.`created_at` AS `at`"
    + "  FROM `asset_request` AS `r`"
    + "  LEFT JOIN `user` AS `u` ON `u`.`id` = `r`.`requested_by`"
    + " WHERE `r`.`status` = 'PENDING' ORDER BY `r`.`created_at` ASC LIMIT 50",
  );
  return rows.map((row) => notice({
    id: `asset-request:${row.id}`,
    kind: "Approval",
    title: row.assetName || row.code || "Asset request",
    detail: row.requestedBy ? `Requested by ${row.requestedBy}` : "Waiting for approval",
    at: row.at,
    // Requests are worked inside the Asset Management screen rather than on a page of their own.
    href: "/asset-management/assets",
    tone: "due",
  }));
}

/*
 * Every source, with the permission it answers to.
 *
 * `module` / `feature` is checked before the source is read at all, not filtered afterwards: a
 * notice about a record somebody may not open is a notice that cannot be acted on, and reading it
 * to throw it away is work done to leak nothing.
 */
const SOURCES = [
  { key: "followUps", module: "SALES", feature: "CRM Leads", load: (viewer) => safely("follow-up", () => followUps(viewer)) },
  { key: "whatsapp", module: "SALES", feature: "CRM Leads", load: (viewer) => safely("WhatsApp", () => whatsappReplies(viewer)) },
  { key: "calls", module: "SALES", feature: "CRM Leads", load: (viewer) => safely("call", () => callsWaiting(viewer)) },
  { key: "assetApprovals", module: "ASSET", feature: "Asset Request Approval", load: () => safely("asset approval", () => assetApprovals()) },
];

module.exports = { SOURCES, notice, studioToday, num };
