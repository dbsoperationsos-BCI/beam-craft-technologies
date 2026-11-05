const prisma = require("../config/db");
const dataScope = require("./dataScope.service");

/**
 * Which CRM leads a person may read, and which records hanging off a lead they may read with it.
 *
 * The studio's one rule (see `dataScope.service.js`): a lead is yours if you are its CRM, if
 * somebody who reports to you is, if you entered it, or if you administer the branch it was
 * enquired into. This is the same answer the CRM board gives, lifted out of its controller so the
 * things that hang off a lead - a meeting, a WhatsApp conversation, a call - cannot end up
 * answering a different question from the board that lists their leads.
 *
 * `permissions` is the caller's own guard, usually `req.permission`. The check inside `resolve()`
 * is a backstop for a caller that skipped its guard, not a second guard.
 */
const LEAD_SCOPE_COLUMNS = { branch: "branchId", employee: "ownerEmployeeId", user: "createdByUserId", id: "enquiryId" };

const CRM_LEADS = { module: "SALES", feature: "CRM Leads" };

/** The resolver's full answer - `where`, `allows(record)`, `sql(...)` - on the lead's own columns. */
function leadScopeFor({ userId, permissions }) {
  const wanted = permissions || CRM_LEADS;
  return dataScope.resolve({
    userId,
    permissions: Array.isArray(wanted) ? wanted : [wanted],
    columns: LEAD_SCOPE_COLUMNS,
  });
}

/** Just the `where`, for a caller putting it under `AND` in a lead query. */
async function leadAccessWhere({ userId, permissions }) {
  return (await leadScopeFor({ userId, permissions })).where;
}

/**
 * Which of `enquiryIds` this person may read.
 *
 * A meeting, a chat and a call log all name their lead by enquiry id rather than by a foreign key,
 * so they cannot be filtered through a relation. Each asks this instead: bound the child rows
 * first - by a date window, a conversation, a page - then ask which of the handful of leads they
 * name are readable. Ids naming a lead that no longer exists are dropped, which is what keeps a
 * deleted lead from taking its meetings' visibility with it into "everybody".
 */
async function readableEnquiryIds(enquiryIds, { userId, permissions }) {
  const wanted = [...new Set((Array.isArray(enquiryIds) ? enquiryIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!wanted.length) return new Set();
  const scope = await leadScopeFor({ userId, permissions });
  if (scope.unlimited) return new Set(wanted);
  const rows = await prisma.salesCrmLead.findMany({
    where: { enquiryId: { in: wanted }, deletedAt: null, AND: [scope.where] },
    select: { enquiryId: true },
  });
  return new Set(rows.map((row) => row.enquiryId));
}

module.exports = { leadScopeFor, leadAccessWhere, readableEnquiryIds, LEAD_SCOPE_COLUMNS, CRM_LEADS };
