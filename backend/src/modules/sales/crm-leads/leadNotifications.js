const prisma = require("../../../config/db");
const notifications = require("../../../services/notifications");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");

/*
 * ── Telling somebody a lead is theirs ─────────────────────────────────────────────────────────
 *
 * A lead is put in somebody's name in four ways: the Add Lead form with a CRM chosen, an edit that
 * changes the CRM, the bulk Update Details over a selection, and the CSV import. Until now none of
 * them told the person. The lead simply appeared on their board, and whether they noticed depended
 * on whether they happened to look - which for a lead handed over at five o'clock means the next
 * morning, and for a busy board means never.
 *
 * ── Resolved through the employee, the way every other reader of a CRM name is ──
 *
 * `sales_crm_lead` records who is working a lead as text in its `crm` column - a name, a login
 * username or an employee id, whatever the form, the sheet or the file supplied - and every reader
 * of that text resolves it with `referenceMatchers`, the one rule the board, the backfill and every
 * write path share. So does this: the text names an **employee**, and the notice goes to the active
 * login linked to them. Matching `user.name` directly, as this first did, was a second rule, and it
 * showed: a lead assigned by username told nobody, and a login renamed on one screen and not the
 * other was told about the wrong person's leads. The login's own display name is kept only as the
 * fallback for a name the matcher cannot place, so a Super Admin with no employee record can still
 * be told.
 *
 * ── Never allowed to break the write it reports on ──
 *
 * A lead is assigned whether or not anybody can be told about it. Every function here swallows its
 * own failure, the way `notify` itself does: the alternative is a 500 on a request that has already
 * moved a hundred leads, which loses the reader any way of knowing that it worked.
 */

/**
 * The login behind a CRM name, or null.
 *
 * Active accounts only. A leaver's leads are reassigned rather than left, and writing notices to a
 * login nobody signs into is a row that will never be read - the bell for that account does not
 * exist. `status` is the login's own, which is what decides whether anybody can sign in and open
 * the bell these rows would appear in.
 */
async function userIdForCrmName(name) {
  const wanted = String(name || "").trim();
  if (!wanted) return null;
  return (await userIdsForCrmNames([wanted])).get(wanted) ?? null;
}

/**
 * The same lookup for several names at once, as a `name -> user id` map.
 *
 * Resolved the way every other reader of a CRM name resolves it: the text is matched to an
 * **employee** by `referenceMatchers` - employee id, login username or full name, the one rule the
 * board, the backfill and every write path share - and the notice goes to the active login linked
 * to that employee. Matching `user.name` directly, as this did, was a second rule: it found
 * nobody for a lead assigned by employee id or username, and found the wrong somebody when a login
 * had been renamed on one screen and not the other. A name the matcher cannot place falls back to
 * the login's own name, so a Super Admin with no employee record can still be told.
 */
async function userIdsForCrmNames(names = []) {
  const wanted = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!wanted.length) return new Map();
  try {
    const refs = await referenceLookups();
    const employeeFor = new Map(wanted.map((name) => [name, refs.employeeId(name)]));
    const employeeIds = [...new Set([...employeeFor.values()].filter(Boolean))];
    const linked = employeeIds.length
      ? await prisma.user.findMany({ where: { linkedEmployeeId: { in: employeeIds }, status: "ACTIVE" }, select: { id: true, linkedEmployeeId: true }, orderBy: { id: "asc" } })
      : [];
    const loginOfEmployee = new Map();
    for (const row of linked) if (!loginOfEmployee.has(row.linkedEmployeeId)) loginOfEmployee.set(row.linkedEmployeeId, row.id);

    const resolved = new Map();
    const unplaced = [];
    for (const name of wanted) {
      const userId = loginOfEmployee.get(employeeFor.get(name)) ?? null;
      if (userId) resolved.set(name, userId);
      else unplaced.push(name);
    }
    if (unplaced.length) {
      const rows = await prisma.$queryRawUnsafe(
        "SELECT `id`, `name` FROM `user` WHERE `status` = 'ACTIVE'"
        + ` AND LOWER(TRIM(\`name\`)) IN (${unplaced.map(() => "LOWER(TRIM(?))").join(", ")})`,
        ...unplaced,
      );
      const byFolded = new Map();
      for (const row of rows) {
        const key = String(row.name || "").trim().toLowerCase();
        // First id wins, so two logins sharing a name always resolve the same way rather than
        // depending on which the database happened to return first.
        if (!byFolded.has(key)) byFolded.set(key, Number(row.id));
      }
      for (const name of unplaced) resolved.set(name, byFolded.get(name.toLowerCase()) ?? null);
    }
    return resolved;
  } catch (error) {
    console.warn("Unable to resolve CRM names to logins:", error?.message || error);
    return new Map();
  }
}

/**
 * Who did the assigning, as a name to put in the notice.
 *
 * Read from the login rather than passed in, because the actor every write path here already
 * carries is `{ actorUserId, source }` - an id and nothing else. "Assigned by Priya S" is the half
 * of this notice that says whether it needs a reply; "assigned by user 14" would be worse than
 * saying nothing, which is what a lookup that finds nobody falls back to.
 */
async function actorNameFor(actorId) {
  const id = Number(actorId);
  if (!Number.isInteger(id) || id <= 0) return "";
  try {
    const user = await prisma.user.findUnique({ where: { id }, select: { name: true } });
    return String(user?.name || "").trim();
  } catch {
    return "";
  }
}

/**
 * What the notice says, and where it goes.
 *
 * The client's own name rather than the enquiry id where there is one: "Anitha Kumar" is what the
 * person receiving this will recognise, and the id is on the lead when they open it. The link is the
 * one the Contacts directory and the bell's follow-up notices already use, so all three open a lead
 * the same way.
 */
function assignmentNotice(lead = {}, assignedBy = "") {
  const enquiryId = String(lead.enquiryId || lead.id || "").trim();
  const client = String(lead.name || "").trim() || enquiryId || "A lead";
  return {
    type: notifications.TYPES.LEAD_ASSIGNED,
    title: `Lead assigned: ${client}`,
    body: [enquiryId, assignedBy ? `assigned by ${assignedBy}` : ""].filter(Boolean).join(" · ") || null,
    entityType: "SALES_CRM_LEAD",
    entityId: enquiryId || null,
    link: enquiryId ? `/sales/crm?lead=${encodeURIComponent(enquiryId)}` : "/sales/crm",
  };
}

/**
 * One lead has been put in one person's name.
 *
 * `previousCrm` is what it was before, so an edit that saves a lead without touching its CRM writes
 * nothing: the board's Update sends the whole lead back, so every remark, status and follow-up date
 * would otherwise re-announce an assignment that has not changed - and a bell that repeats itself is
 * a bell people stop opening.
 *
 * `notify` refuses to tell somebody about their own action, so a salesperson taking a lead for
 * themselves is not told they have done so.
 */
async function notifyLeadAssigned(lead, { crm, previousCrm = "", actorId = null } = {}) {
  try {
    const next = String(crm || "").trim();
    if (!next || next.toLowerCase() === String(previousCrm || "").trim().toLowerCase()) return null;
    const userId = await userIdForCrmName(next);
    if (!userId) return null;
    const actorName = await actorNameFor(actorId);
    return await notifications.notify(null, { userId, actorId, ...assignmentNotice(lead, actorName) });
  } catch (error) {
    console.warn("Unable to raise a lead assignment notification:", error?.message || error);
    return null;
  }
}

/**
 * A selection shared out between one or more CRMs, as the bulk assign does it.
 *
 * `perCrm` is the same `{ name: [enquiryId, ...] }` split `assignCrmLeads` has already made, so the
 * notices land on exactly the leads each person was actually given rather than on the whole
 * selection. The leads are read back in one query for their client names, because a notice reading
 * "Lead assigned: DBS-EID-DD-ERD-000412" is a notice the reader has to go and look up.
 *
 * Written one row per lead. A single "you have been given 40 leads" would be one line to dismiss
 * with nothing behind it: no link that opens anything, and no way to tell which forty. The feed is
 * capped at thirty on read, so a large assignment is naturally trimmed to the newest of them.
 */
async function notifyLeadsAssigned(perCrm = {}, { actorId = null } = {}) {
  try {
    const names = Object.keys(perCrm).filter((name) => perCrm[name]?.length);
    if (!names.length) return 0;

    const [actorName, userIds, rows] = await Promise.all([
      actorNameFor(actorId),
      userIdsForCrmNames(names),
      (async () => {
        const ids = [...new Set(names.flatMap((name) => perCrm[name]))].filter(Boolean);
        if (!ids.length) return [];
        return prisma.$queryRawUnsafe(
          "SELECT `enquiry_id` AS `enquiryId`, `name` FROM `sales_crm_lead`"
          + ` WHERE \`deleted_at\` IS NULL AND \`enquiry_id\` IN (${ids.map(() => "?").join(", ")})`,
          ...ids,
        );
      })(),
    ]);

    const clientNames = new Map(rows.map((row) => [row.enquiryId, row.name]));
    let written = 0;
    for (const name of names) {
      const userId = userIds.get(name);
      if (!userId) continue;
      for (const enquiryId of perCrm[name]) {
        const notice = assignmentNotice({ enquiryId, name: clientNames.get(enquiryId) || "" }, actorName);
        if (await notifications.notify(null, { userId, actorId, ...notice })) written += 1;
      }
    }
    return written;
  } catch (error) {
    console.warn("Unable to raise lead assignment notifications:", error?.message || error);
    return 0;
  }
}

module.exports = { notifyLeadAssigned, notifyLeadsAssigned, userIdForCrmName, userIdsForCrmNames };
