/**
 * Which leads are the same client, and which of them is the one to keep.
 *
 * Shared by the two scripts that ask it, and that is the whole reason it exists as a file: the
 * report proposes what the resolver would do, so if they answered differently the report would be a
 * preview of something else. One rule, read twice.
 *
 *   scripts/reportDuplicateLeads.js    prints; changes nothing
 *   scripts/resolveDuplicateLeads.js   keeps one and deletes the rest, and only with --apply
 */
const prisma = require("../../src/config/db");

/**
 * `phoneMatchKey` in SQL: the last ten digits of whichever column holds the number.
 *
 * The CRM's own rule for "the same client" everywhere else - the same number is stored as
 * "9876543210", "+91 9876543210" and "98765-43210" depending which door it came through. Corp leads
 * keep theirs in `contact_number` rather than `phone`, so both are read. A number that does not
 * reach ten digits is matched on nothing rather than on a fragment.
 */
const KEY_SQL = "RIGHT(REGEXP_REPLACE(COALESCE(NULLIF(TRIM(`l`.`phone`), ''), `l`.`contact_number`, ''), '[^0-9]', ''), 10)";

const number = (value) => Number(value || 0);

/**
 * Whether a table is actually there.
 *
 * `sales_crm_call_log` is created on demand by the CRM (`ensureCallLogTable`) rather than by a
 * migration, so a database that has never received a Callyzer delivery does not have it - and a
 * query naming it fails outright rather than answering "no calls". A fresh environment, or a studio
 * that has not connected Callyzer, is exactly where somebody would first run these scripts.
 */
async function tableExists(name) {
  const [row] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS `n` FROM `information_schema`.`tables` WHERE `table_schema` = DATABASE() AND `table_name` = ?",
    name,
  );
  return number(row?.n) > 0;
}

/** Whether somebody has already said this lead is not the one to keep. */
const markedDuplicate = (lead) => String(lead.status || "").trim().toLowerCase().startsWith("duplicat");

/**
 * The statuses that mean the work is settled, one way or the other.
 *
 * A survivor carrying one of these is **not** moved to Followup: a booked job is not a lead to chase
 * and a refused one is not either, and overwriting them would destroy the only record of how the
 * enquiry ended. `--force-status` overrides it for a studio that means "all of them".
 */
const SETTLED_STATUSES = ["converted", "converted & followup", "followup & converted", "invalid", "rejected"];
const isSettled = (lead) => SETTLED_STATUSES.includes(String(lead.status || "").trim().toLowerCase());

/** Work keyed by this lead's enquiry id - a reason never to delete it. */
const carriesWork = (lead) => Boolean(number(lead.hasProject) || number(lead.hasQuotation));

/**
 * One row per lead that shares its number with another, with what hangs off it.
 *
 * Read in one pass rather than per group: a studio with three thousand groups would otherwise be
 * three thousand round trips, and both callers have to be runnable against production while
 * somebody waits for them.
 */
async function duplicateLeads({ min = 2, vertical = "", across = false } = {}) {
  const groupBy = across ? "`k`" : "`k`, `vertical`";
  const verticalClause = vertical ? "AND `l`.`vertical` = ?" : "";
  const params = vertical ? [vertical] : [];
  // Answered as "no calls" where the table has never been created - see `tableExists`.
  const hasCallsSql = await tableExists("sales_crm_call_log")
    ? "EXISTS(SELECT 1 FROM `sales_crm_call_log` `c` WHERE `c`.`enquiry_id` = `l`.`enquiry_id`)"
    : "0";

  return prisma.$queryRawUnsafe(
    `SELECT ${KEY_SQL} AS \`k\`,
            \`l\`.\`vertical\` AS \`vertical\`,
            \`l\`.\`enquiry_id\` AS \`enquiryId\`,
            \`l\`.\`name\` AS \`name\`,
            \`l\`.\`status\` AS \`status\`,
            \`l\`.\`crm\` AS \`crm\`,
            \`l\`.\`created_date\` AS \`enquiryDate\`,
            \`l\`.\`created_at\` AS \`writtenAt\`,
            TRIM(COALESCE(\`l\`.\`remarks\`, '')) <> '' AS \`hasRemarks\`,
            ${hasCallsSql} AS \`hasCalls\`,
            EXISTS(SELECT 1 FROM \`sales_quotation\` \`q\` WHERE \`q\`.\`enquiry_id\` = \`l\`.\`enquiry_id\`) AS \`hasQuotation\`,
            EXISTS(SELECT 1 FROM \`sales_project\` \`p\` WHERE \`p\`.\`enquiry_id\` = \`l\`.\`enquiry_id\` AND \`p\`.\`deleted_at\` IS NULL) AS \`hasProject\`
       FROM \`sales_crm_lead\` \`l\`
       JOIN (
         SELECT ${KEY_SQL} AS \`k\`${across ? "" : ", `l`.`vertical` AS `vertical`"}
           FROM \`sales_crm_lead\` \`l\`
          WHERE \`l\`.\`deleted_at\` IS NULL AND CHAR_LENGTH(${KEY_SQL}) = 10 ${verticalClause}
          GROUP BY ${groupBy}
         HAVING COUNT(*) >= ?
       ) \`d\` ON \`d\`.\`k\` = ${KEY_SQL} ${across ? "" : "AND `d`.`vertical` = `l`.`vertical`"}
      WHERE \`l\`.\`deleted_at\` IS NULL ${verticalClause}
      ORDER BY \`k\`, \`l\`.\`created_date\` ASC, \`l\`.\`enquiry_id\` ASC`,
    ...params, min, ...params,
  );
}

/**
 * The lead to keep, and why.
 *
 *   1. One with a **project or a quotation** against it. That is work the studio has done, keyed by
 *      enquiry id - deleting such a lead would orphan it. More than one is a group for a person to
 *      look at rather than a script.
 *   2. Otherwise one **nobody has marked "Duplicated"**. The studio has been marking these by hand,
 *      and that decision is better evidence than a date. It yields where a whole group is marked.
 *   3. Otherwise the **last worked**: newest by enquiry date, which is the one being rung and the one
 *      carrying the current status.
 *   4. Ties broken by enquiry id, so two runs agree with each other.
 */
function keeper(leads) {
  const worked = leads.filter(carriesWork);
  const live = worked.length ? worked : leads.filter((lead) => !markedDuplicate(lead));
  const pool = live.length ? live : leads;
  const reason = worked.length
    ? (worked.length > 1 ? "work against it (more than one - look)" : "work against it")
    : (live.length && live.length < leads.length ? "last worked, of the ones nobody has marked" : "last worked");
  const sorted = [...pool].sort((a, b) => {
    const day = String(b.enquiryDate || "").localeCompare(String(a.enquiryDate || ""));
    return day !== 0 ? day : String(b.enquiryId).localeCompare(String(a.enquiryId));
  });
  return { lead: sorted[0], reason, contested: worked.length > 1 };
}

/** The rows as groups, biggest first. */
function group(rows, across = false) {
  const groups = new Map();
  for (const row of rows) {
    const key = across ? row.k : `${row.vertical}::${row.k}`;
    if (!groups.has(key)) groups.set(key, { key: row.k, vertical: across ? "(any)" : row.vertical, leads: [] });
    groups.get(key).leads.push(row);
  }
  return [...groups.values()].sort((a, b) => b.leads.length - a.leads.length);
}

/**
 * What would happen to one group: which lead survives, which go, and whether it is safe to touch.
 *
 * `skip` is set where a script must not decide: work on more than one lead, or work on a lead that
 * is not the survivor. Both mean somebody has to look.
 */
function plan(entry, { forceStatus = false } = {}) {
  const keep = keeper(entry.leads);
  const remove = entry.leads.filter((lead) => lead.enquiryId !== keep.lead.enquiryId);
  const workedElsewhere = remove.filter(carriesWork);

  let skip = "";
  if (keep.contested) skip = "more than one lead carries a project or quotation";
  else if (workedElsewhere.length) skip = `a lead being deleted carries work (${workedElsewhere.map((lead) => lead.enquiryId).join(", ")})`;

  const settled = isSettled(keep.lead);
  return {
    ...entry,
    keep: keep.lead,
    reason: keep.reason,
    remove,
    skip,
    // Followup unless the survivor already says how the enquiry ended - see `SETTLED_STATUSES`.
    status: settled && !forceStatus ? String(keep.lead.status || "").trim() : "Followup",
    statusKept: settled && !forceStatus,
  };
}

module.exports = { KEY_SQL, duplicateLeads, keeper, group, plan, markedDuplicate, isSettled, carriesWork, number, tableExists };
