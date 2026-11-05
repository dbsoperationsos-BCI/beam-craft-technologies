const prisma = require("../../../config/db");
const { likeLiteral, wordChunks } = require("../../../services/wordChunks");
const { ensureCallIds, callerIsALeadSql } = require("./callLogService");

/*
 * ── The Calls board ───────────────────────────────────────────────────────────────────────────
 *
 * The calls Callyzer has delivered whose caller is not in the CRM yet, read straight out of
 * `sales_crm_call_log`.
 *
 * It is a queue, not an archive: a call arrives here under a Call ID of its own - `DBS-CLID-000012`,
 * which is the only kind of code this board ever shows - and it leaves the moment somebody reads
 * the caller and adds them to a vertical. What it becomes then is a lead on that vertical's own
 * board, under that vertical's enquiry id, which is where the studio works it from. A row in two
 * places at once is a row two people each think the other has dealt with.
 *
 * It used to be a slice of the lead table: the webhook turned each delivered call into a lead, and
 * the board showed the ones nothing had named a vertical for. What was wrong with that was the
 * numbering, not the queue - the studio's enquiry run counted its misdials and wrong numbers, a
 * code minted for one sitting beside one quoted to a client. The Call ID fixes that, and it is
 * fixed whether or not the call stays on this board afterwards.
 *
 * The board did hold every call for a while, on the reasoning that "what did we do on the phone
 * today" was otherwise unanswerable. It is answerable without keeping the row here: an added
 * caller's calls follow them to their lead, where the Call Logs tab reads the whole history off
 * `sales_crm_call_log` by enquiry id - which is why `linkCallsToLead` and `relinkOrphanedCalls`
 * matter as much under this reading as under the old one.
 *
 * Kept apart from leadQueryService.js deliberately. That file is the lead store's board query, with
 * a lead's statuses, follow-up dates and occasions in every clause; a call has none of those and
 * has a direction and a length instead, and folding the two into one set of column definitions
 * would mean every clause asking which of the two kinds of row it was looking at.
 */

/*
 * ── What Callyzer calls a call ────────────────────────────────────────────────────────────────
 *
 * Four types, and its API validates them as exactly these four (see `validateCallTypes` in
 * ../callyzer-api/validation.js): Incoming, Outgoing, Missed and Rejected. Compared folded to
 * lowercase and trimmed, because the webhook stores whatever the account's app sent.
 */
const TYPE_SQL = "LOWER(TRIM(COALESCE(`c`.`call_type`, '')))";

// The three inbound types. A missed or rejected call is one the client made - it is on the board
// because they rang, not because anybody rang them.
const INBOUND_SQL = `${TYPE_SQL} IN ('incoming', 'missed', 'rejected')`;
const OUTBOUND_SQL = `${TYPE_SQL} = 'outgoing'`;
// The client rang and nobody in the studio picked up. This is the queue that costs money.
const NEVER_ATTENDED_SQL = `${TYPE_SQL} IN ('missed', 'rejected')`;
// Somebody actually talked. Callyzer reports a length of zero for everything else, whichever way
// the call went, so this one test covers a missed call and an unanswered outgoing alike.
const CONNECTED_SQL = "`c`.`duration_seconds` > 0";

/*
 * The tabs, as SQL.
 *
 * They are cuts of the same list rather than a partition of it, and that is deliberate: All is every
 * call, Incoming and Outgoing split it by direction, and Connected and Not Connected split it by
 * what came of it. A missed call is in Incoming and in Not Connected at once, because both of those
 * are true of it.
 *
 * ── What Not Connected means ──
 *
 * The calls the studio did not answer: a client rang, and nobody picked up.
 *
 * It was `NOT (${CONNECTED_SQL})` - every call of zero length, whichever way it went - and that put
 * two unrelated things under one tab. A number the studio rang that did not pick up is the client
 * being unavailable; a client who rang and got no answer is the studio failing to take the call.
 * Only the second is work anybody has to do something about, and it is the one the tab was being
 * read for, so an unanswered outgoing call sitting beside it was noise on the list that matters
 * most on this board.
 *
 * So the tab is `NEVER_ATTENDED_SQL` - Callyzer's own Missed and Rejected, which are inbound by
 * definition. That is the same clause the Status column already reads "Never Attended" for, so the
 * tab and the column now say one thing: every row under Not Connected reads Never Attended, and
 * every row that reads Never Attended is under it.
 *
 * Outgoing calls that never connected are still on the board - under Outgoing, where they belong,
 * and countable there. Nothing has been hidden; it has been filed under the thing it is.
 *
 * `null` means no restriction, which is right for All and wrong for everything else - a tab with no
 * clause quietly lists the whole board and looks like a tab that works.
 */
const CALL_VIEWS = {
  all: null,
  incoming: INBOUND_SQL,
  outgoing: OUTBOUND_SQL,
  connected: CONNECTED_SQL,
  notConnected: NEVER_ATTENDED_SQL,
};

const CALL_VIEW_IDS = Object.keys(CALL_VIEWS);

/**
 * What the Status column reads on this board.
 *
 * Three words for three outcomes. Connected is the tab of the same name. Never Attended is now
 * exactly what the Not Connected tab lists - the client rang and the studio did not pick up - and
 * the two carry different words on purpose: the tab says what the reader is looking at, the cell
 * says what happened to that call. Not Connected is what is left, a call that went out and did not
 * connect, and it is read under Outgoing rather than under a tab of its own.
 *
 * Ordered rather than overlapping: a call that connected reads Connected whatever its type says,
 * since the studio spoke to the client and that is the fact worth showing.
 */
const CALL_STATUS_SQL = `CASE
  WHEN ${CONNECTED_SQL} THEN 'Connected'
  WHEN ${NEVER_ATTENDED_SQL} THEN 'Never Attended'
  ELSE 'Not Connected'
END`;

/**
 * The length of the call, written the way the cell shows it.
 *
 * Formatted in SQL rather than in the browser for the reason every other column here is: the filter
 * box sits directly under the heading, and a filter that matched a raw second count while the
 * column showed "2m 14s" reads as a filter that does not work.
 */
/*
 * The Calls board joins the repository so a handset reads under the name the studio uses. LEFT,
 * because a call from a phone matched to nobody is still a call on the board.
 */
const CALL_EMPLOYEE_JOIN = " LEFT JOIN `employee` AS `e` ON `e`.`id` = `c`.`matched_employee_id`";
const CALL_CRM_SQL = "COALESCE(NULLIF(TRIM(`e`.`employee_name`), ''), `c`.`employee_name`, '')";

const CALL_DURATION_SQL = `CASE
  WHEN \`c\`.\`duration_seconds\` <= 0 THEN '-'
  WHEN \`c\`.\`duration_seconds\` < 60 THEN CONCAT(\`c\`.\`duration_seconds\`, 's')
  ELSE CONCAT(FLOOR(\`c\`.\`duration_seconds\` / 60), 'm ', MOD(\`c\`.\`duration_seconds\`, 60), 's')
END`;

/*
 * ── What keeps a call on this board ───────────────────────────────────────────────────────────
 *
 * That nobody has added its caller yet. Once they have, the call belongs to their lead and is read
 * from there; leaving it here as well would put one enquiry on two boards, each looking like work
 * outstanding, and the count in the tab beside "All" would go on counting a caller who has been
 * dealt with.
 *
 * ── The caller has to have a vertical to count as added ───────────────────────────────────────
 *
 * Being *present* in the lead table is not the same as having been added, and the difference is the
 * vertical. Three things write `c`.`enquiry_id` and only one of them is somebody reading a caller
 * and adding them: the old webhook minted a lead for every call it was sent, and a caller already
 * in the CRM is stamped at ingest. Judging by the column alone would empty this board of calls
 * nobody had ever looked at.
 *
 * `vertical` is the right test rather than a near-enough one: it is already how the client decides
 * what a call is - `isCallRecord` in frontend/src/lib/crmBoards.js reads "Callyzer and no vertical"
 * - and it is exactly what "added to their respective verticals" means. Nothing else creates a lead
 * without one: the Add Lead form makes it a required radio and the CSV import sets it per template,
 * so a blank vertical is a lead the old webhook left behind and no lead a person ever filled in.
 * `retireCallyzerCallLeads.js` clears those out; until it is run they read here as what they are.
 *
 * The test comes from `callerIsALeadSql` in callLogService.js rather than being written out here,
 * because that file's `linkCallsToLead` has to judge the same fact by the same rule when it *writes*
 * a link. It did not: it wrote only where the column was empty, so a call naming a dead id was
 * skipped by the writer and disowned by the reader, and adding the caller to a vertical changed
 * nothing on the board however many times it was done.
 */
const UNPLACED_SQL = `NOT ${callerIsALeadSql}`;

/*
 * Column id -> the SQL behind the cell that shows it.
 *
 * Qualified with `c`, because the lead table is reached from the clause above and an unqualified
 * column would be ambiguous. The ids are the board's own, and three of them are the lead board's names kept on
 * purpose: `enquiryDate` and `addedTime` are the table's date and time columns everywhere in this
 * CRM and carry that board's date and time pickers in the filter row, and `crm` is the person the
 * row belongs to. Relabelled on the client - Call Date, Call Time, Attended By - rather than
 * renamed, so the filter widgets, the sort arrows and Manage Columns all behave as they do
 * everywhere else.
 */
const CALL_COLUMN_SQL = {
  id: "`c`.`call_id`",
  callId: "`c`.`call_id`",
  /*
   * The Enquiry ID column, and the one the board leads with.
   *
   * Always the call's own code, in the call's own format - `DBS-CLID-000012`. Never a lead's, and
   * there is nothing to fall back to: a call whose caller has been added has left this board for
   * that caller's vertical, where it is read under the vertical's enquiry id. So one format per
   * board, and the code on screen says which board you are on.
   */
  enquiryId: "COALESCE(NULLIF(`c`.`call_id`, ''), `c`.`id`)",
  enquiryDate: "COALESCE(NULLIF(LEFT(`c`.`call_date`, 10), ''), DATE_FORMAT(`c`.`called_at`, '%Y-%m-%d'))",
  /*
   * The clock time of the call, to the minute.
   *
   * Trimmed of its seconds on purpose: Callyzer stores "17:49:41", the Call Time filter is the
   * board's time picker and a picker produces "17:49", so the whole column would answer nothing to
   * every value the widget above it can produce. To the minute is also what the cell shows - the
   * filter and the column have to be reading the same thing.
   */
  addedTime: "COALESCE(LEFT(`c`.`call_time`, 5), '')",
  name: "COALESCE(`c`.`client_name`, '')",
  phone: "COALESCE(`c`.`client_number`, '')",
  /*
   * The employee the handset belongs to, spelled the way the repository spells it.
   *
   * Read through `matched_employee_id` - what the webhook worked out from Callyzer's Employee Code
   * and then the handset's label - rather than off the label itself. This column pre-fills the CRM
   * on Add Lead when a call is triaged, and `crm` on a lead is a name copy of `owner_employee_id`
   * (see `nameCopies.js`): the label resolved to nobody whenever a phone was named anything but its
   * owner, so the lead was created owned by no one. Callyzer's label stays the fallback for a
   * handset the repository cannot place.
   */
  crm: CALL_CRM_SQL,
  callType: "COALESCE(`c`.`call_type`, '')",
  duration: CALL_DURATION_SQL,
  status: CALL_STATUS_SQL,
  // The note the employee typed against the call in their own app. It is the substance of the row -
  // "asked for the December package" - and the only part of a call anybody reads twice.
  remarks: "COALESCE(`c`.`note`, '')",
  source: "'Callyzer'",
};

function callColumnSql(columnId) {
  // Only ever built from a known column. Nothing here is assembled from caller-supplied text.
  return CALL_COLUMN_SQL[columnId] || null;
}

/*
 * What a column sorts by, where that is not the text it shows.
 *
 * Duration is the only one, and it has to be: the cell reads "9s" and "10m 5s", and sorting those
 * as strings puts the ten-minute call above the nine-second one - "1" before "9". The number behind
 * them is what "longest call first" means. Filtering still goes through the displayed text, because
 * a filter is matched against what is on screen; ordering is not.
 */
const CALL_SORT_SQL = {
  duration: "`c`.`duration_seconds`",
};

function callSortSql(columnId) {
  return CALL_SORT_SQL[columnId] || callColumnSql(columnId);
}

function callViewClause(view) {
  return CALL_VIEWS[view] === undefined ? null : CALL_VIEWS[view];
}

/*
 * The header's date range, over the day the call came in.
 *
 * The same expression the Call Date column shows - `call_date` where Callyzer sent one, the delivery
 * timestamp where it did not - rather than `called_at` alone, so the range and the column can never
 * disagree about which day a call belongs to. That means comparing a computed value rather than an
 * indexed one, which is a scan of the call log; it is affordable here in a way the same thing would
 * not be on the lead table, because this board is the *queue* - the calls whose caller nobody has
 * added yet - and never the whole history of the phone.
 *
 * Compared as text, which works because both ends are `YYYY-MM-DD` and the expression produces the
 * same form: that is what the ISO ordering is for. Anything not shaped like a day is ignored rather
 * than passed through - nothing here is built from caller text.
 */
function callDateRangeClauses({ dateFrom = "", dateTo = "" } = {}, clauses, params) {
  const day = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "").slice(0, 10)) ? String(value).slice(0, 10) : "");
  const from = day(dateFrom);
  const to = day(dateTo);
  if (from) { clauses.push(`${CALL_COLUMN_SQL.enquiryDate} >= ?`); params.push(from); }
  if (to) { clauses.push(`${CALL_COLUMN_SQL.enquiryDate} <= ?`); params.push(to); }
}

/*
 * Which tab the header's date range applies to: All, and no other.
 *
 * Incoming, Outgoing, Connected and Not Connected are cuts of the same list by what the call *was*,
 * and each is read as a queue to work through rather than as a period to report on - narrowing "the
 * calls nobody answered" to this month hides the ones from last month that are still nobody's
 * enquiry. The client does not offer the switch there; see `showsDateRange` in
 * frontend/src/lib/crmDateRange.mjs, which this mirrors.
 *
 * Mirrored here because of the **counts**. The strip is counted in one pass, and the range used to
 * be applied to that whole pass - so with a range on All, Incoming read "2" and then showed 6 rows
 * when it was opened, because the tab itself does not carry the range. A tab has to be counted the
 * way it is read, or the number beside its name is a promise it cannot keep.
 */
const callViewCarriesDateRange = (view) => String(view || "") === "all";

function buildCallWhere({ view = "all", filters = {}, dateFrom = "", dateTo = "" }) {
  // Every read of this board, the tab counts included, is the queue and nothing else - see
  // `UNPLACED_SQL`. Put here rather than at each call site so a query added later cannot forget it
  // and quietly list the calls of callers the studio has already dealt with.
  const clauses = [UNPLACED_SQL];
  const params = [];

  const viewSql = callViewClause(view);
  if (viewSql) clauses.push(viewSql);

  // Only on the tab that carries it - see `callViewCarriesDateRange`. Applying it to the other four
  // would narrow a queue by a filter with no control on screen to clear it.
  if (callViewCarriesDateRange(view)) callDateRangeClauses({ dateFrom, dateTo }, clauses, params);

  /*
   * A column filter is a list now - the header's picker ticks several - and `String()` on an array
   * joins it with a comma, so two call types asked for `LIKE '%Incoming,Outgoing%'` and matched
   * nothing at all. Each value keeps the substring `LIKE` it has always had, and several are OR'd:
   * ticking two means either, not both at once in one string. A single value builds exactly the
   * clause it built before.
   *
   * A value *typed* into the box (a string, not a ticked list) is Word Chunk Search: one `LIKE ?`
   * per word, all of them required, in any order.
   */
  for (const [columnId, rawValue] of Object.entries(filters)) {
    const sql = callColumnSql(columnId);
    if (!sql) continue;
    if (!Array.isArray(rawValue)) {
      for (const chunk of wordChunks(rawValue)) {
        clauses.push(`${sql} LIKE ?`);
        // The chunk as typed: `%`, `_` and `\` matched as themselves, never as wildcards.
        params.push(`%${likeLiteral(chunk)}%`);
      }
      continue;
    }
    const values = rawValue.map((entry) => String(entry ?? "").trim()).filter(Boolean);
    if (!values.length) continue;
    clauses.push(`(${values.map(() => `${sql} LIKE ?`).join(" OR ")})`);
    params.push(...values.map((entry) => `%${likeLiteral(entry)}%`));
  }

  // Never empty now that the queue clause leads it, so there is no `1=1` case left to get wrong.
  return { where: clauses.join(" AND "), params };
}

/**
 * One call as the board's record shape: a `lead` half and a `details` half, like every other row.
 *
 * Shaped here rather than at the client, so the Calls board goes through the same table, the same
 * filters, the same infinite scroll and the same selection as the three verticals. What it is not
 * is a lead: `vertical` is empty and stays empty, which is what tells the board this row opens the
 * Add Lead form rather than a lead popup.
 */
function callToRecord(row = {}) {
  return {
    lead: {
      /*
       * The row's key, and it is the call's own code - the same code the Enquiry ID column shows.
       *
       * A client rung five times is five rows, and five rows sharing a key breaks the table's
       * selection, its keys and the lookup a double click does. Nothing on this board is ever keyed
       * by a lead: a call whose caller has been added is not on it.
       */
      id: String(row.callId || row.id || ""),
      enquiryId: String(row.enquiryId || ""),
      name: row.name || "",
      phone: row.phone || "",
      crm: row.crm || "",
      createdDate: row.enquiryDate || "",
      addedTime: row.addedTime || "",
      status: row.status || "",
      remarks: row.remarks || "",
      // Never a vertical. A call belongs to none of the three until somebody says which, and that
      // is the whole of what this board is for.
      vertical: "",
      source: "Callyzer",
      referredFrom: "Callyzer Call Log",
      callType: row.callType || "",
      duration: row.duration || "",
      durationSeconds: Number(row.durationSeconds) || 0,
      createdAt: row.calledAt ? new Date(row.calledAt).toISOString() : "",
    },
    details: {
      // The two halves are merged on the client with the details winning, so both carry the facts
      // that decide what the row may do - see `isUnassignedCall` in frontend/src/lib/crmBoards.js.
      source: "Callyzer",
      vertical: "",
      callId: String(row.callId || ""),
      callType: row.callType || "",
      durationSeconds: Number(row.durationSeconds) || 0,
      recordingUrl: row.recordingUrl || "",
      // What Callyzer's own app recorded as the outcome, where the account uses dispositions. Kept
      // apart from `status` above, which is this board's own reading of the call.
      crmStatus: row.crmStatus || "",
      leadStatus: row.status || "",
      remarks: row.remarks || "",
      groupType: "callyzer",
      groupName: "Callyzer",
      importedFrom: "Callyzer",
    },
  };
}

const SELECT_COLUMNS = [
  "`c`.`call_id` AS `callId`",
  "`c`.`id` AS `id`",
  `${CALL_COLUMN_SQL.enquiryId} AS \`enquiryId\``,
  `${CALL_COLUMN_SQL.enquiryDate} AS \`enquiryDate\``,
  `${CALL_COLUMN_SQL.addedTime} AS \`addedTime\``,
  "COALESCE(`c`.`client_name`, '') AS `name`",
  "COALESCE(`c`.`client_number`, '') AS `phone`",
  `${CALL_CRM_SQL} AS \`crm\``,
  "COALESCE(`c`.`call_type`, '') AS `callType`",
  `${CALL_DURATION_SQL} AS \`duration\``,
  "`c`.`duration_seconds` AS `durationSeconds`",
  `${CALL_STATUS_SQL} AS \`status\``,
  "COALESCE(`c`.`note`, '') AS `remarks`",
  "COALESCE(`c`.`recording_url`, '') AS `recordingUrl`",
  "COALESCE(`c`.`crm_status`, '') AS `crmStatus`",
  "`c`.`called_at` AS `calledAt`",
].join(", ");

/**
 * One page of the Calls board.
 *
 * Newest call first by default, which is the only order an inbox is read in. `withTotal` is false
 * on a scroll append for the same reason it is on the lead board: the set cannot have changed while
 * somebody walks down it, and counting it again per page is most of the cost of scrolling.
 *
 * Answers an empty board rather than failing when the table has never been created - a CRM that has
 * not yet received a Callyzer delivery still opens this board.
 */
async function listCallBoardPage({
  view = "all",
  filters = {},
  sortColumn = "",
  sortDirection = "desc",
  offset = 0,
  limit = 100,
  withTotal = true,
  // The header's date range, as two inclusive `YYYY-MM-DD` keys; see `callDateRangeClauses`.
  dateFrom = "",
  dateTo = "",
} = {}) {
  try {
    await ensureCallIds();
  } catch (error) {
    console.warn("Unable to prepare the CRM call log table:", error?.message || error);
    return { rows: [], total: withTotal ? 0 : null };
  }

  const { where, params } = buildCallWhere({ view, filters, dateFrom, dateTo });
  const orderSql = callSortSql(sortColumn) || "`c`.`called_at`";
  const direction = String(sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";
  const size = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const start = Math.max(Number(offset) || 0, 0);

  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${SELECT_COLUMNS} FROM \`sales_crm_call_log\` \`c\`${CALL_EMPLOYEE_JOIN} WHERE ${where}`
    // `id` breaks the tie, so paging is stable: two calls delivered in the same second must not
    // swap places between one page and the next and hide a row behind the offset.
    + ` ORDER BY ${orderSql} ${direction}, \`c\`.\`id\` DESC LIMIT ${size} OFFSET ${start}`,
    ...params,
  );

  if (!withTotal) return { rows, total: null };

  const [{ total }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS total FROM \`sales_crm_call_log\` \`c\`${CALL_EMPLOYEE_JOIN} WHERE ${where}`,
    ...params,
  );
  return { rows, total: Number(total || 0) };
}

/** Every Call ID the current tab and filters match, for "select all". */
async function listCallBoardIds({ view = "all", filters = {}, dateFrom = "", dateTo = "" } = {}) {
  try {
    await ensureCallIds();
  } catch {
    return [];
  }
  const { where, params } = buildCallWhere({ view, filters, dateFrom, dateTo });
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`c\`.\`call_id\` AS \`callId\` FROM \`sales_crm_call_log\` \`c\`${CALL_EMPLOYEE_JOIN} WHERE ${where} ORDER BY \`c\`.\`called_at\` DESC`,
    ...params,
  );
  return rows.map((row) => row.callId).filter(Boolean);
}

/**
 * One row of counts for the six tab labels, scoped to the filters that are on.
 *
 * One pass rather than six queries, the way `crmLeadTabCounts` does it: the tabs are all cuts of
 * the same set, so they are summed together over one read of it.
 */
async function callBoardTabCounts({ filters = {}, dateFrom = "", dateTo = "" } = {}) {
  const empty = Object.fromEntries(CALL_VIEW_IDS.map((view) => [view, 0]));
  try {
    await ensureCallIds();
  } catch {
    return empty;
  }

  /*
   * The range goes inside each tab's own CASE rather than into the shared `WHERE`.
   *
   * It was in the `WHERE`, which applied it to every tab in the pass - including the four that do
   * not carry it. So with a range chosen on All, Incoming read "2" on the strip and showed 6 rows
   * when it was opened: the count had been narrowed and the tab had not.
   */
  const { where, params } = buildCallWhere({ view: "all", filters });
  const countParams = [];
  const parts = CALL_VIEW_IDS.map((view) => {
    const clause = callViewClause(view);
    const rangeClauses = [];
    if (callViewCarriesDateRange(view)) callDateRangeClauses({ dateFrom, dateTo }, rangeClauses, countParams);
    const clauses = [clause, ...rangeClauses].filter(Boolean);
    return `SUM(CASE WHEN ${clauses.length ? clauses.join(" AND ") : "1=1"} THEN 1 ELSE 0 END) AS \`${view}\``;
  });

  const [row] = await prisma.$queryRawUnsafe(
    `SELECT ${parts.join(", ")} FROM \`sales_crm_call_log\` \`c\`${CALL_EMPLOYEE_JOIN} WHERE ${where}`,
    // The SELECT's own parameters come first, because the SELECT comes first.
    ...countParams,
    ...params,
  );
  return Object.fromEntries(CALL_VIEW_IDS.map((view) => [view, Number(row?.[view] || 0)]));
}

/*
 * What the board polls to find out whether a call has arrived.
 *
 * The lead board's own signal reads `sales_crm_lead` and nothing else, which was enough while every
 * delivered call created a lead - a call landing bumped it, and the board refreshed. A call from an
 * unknown number creates nothing now, so without this the Calls board would sit still while calls
 * came in and only move when somebody reloaded the page.
 *
 * A count and the newest change, the same pair the lead version is: a delivery either adds rows or
 * updates the ones it redelivered, and both move one of the two. Read behind the same cache the
 * lead version is read behind, and covered by `sales_crm_call_log_version_idx`, so it is an index
 * read rather than a scan of the log.
 *
 * Answers "" on any failure, which composes to "the calls have not changed" rather than to a poll
 * that refreshes the board every four seconds for as long as the fault lasts.
 */
async function callBoardVersion() {
  try {
    await ensureCallIds();
    const [row] = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS `total`, MAX(`updated_at`) AS `updatedAt` FROM `sales_crm_call_log`",
    );
    const updatedAt = row?.updatedAt ? new Date(row.updatedAt).toISOString() : "";
    return `${Number(row?.total || 0)}:${updatedAt}`;
  } catch (error) {
    console.warn("Unable to read the CRM call log version:", error?.message || error);
    return "";
  }
}

/**
 * The values a column actually holds on this board, for the tab being read.
 *
 * The Calls board's half of `crmLeadColumnValues` - same question, same rule, different store: a
 * filter dropdown offers what is *in* the column here rather than a register of everything the
 * studio has. The column's own filter is left out for the reason it is left out there: a dropdown
 * narrowed by its own selection offers one value and no way back.
 *
 * The queue clause `buildCallWhere` leads with is what keeps this honest - the values offered are
 * the ones on the calls this board actually lists, not on every call the phone has ever taken.
 */
const CALL_COLUMN_VALUES_LIMIT = 500;

async function callBoardColumnValues({ column, view = "all", filters = {}, dateFrom = "", dateTo = "" } = {}) {
  const valueSql = callColumnSql(column);
  if (!valueSql) return [];

  const others = { ...filters };
  delete others[column];

  try {
    const { where, params } = buildCallWhere({ view, filters: others, dateFrom, dateTo });
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT ${valueSql} AS \`value\`
         FROM \`sales_crm_call_log\` \`c\`${CALL_EMPLOYEE_JOIN}
        WHERE ${where}
        ORDER BY \`value\` ASC
        LIMIT ${CALL_COLUMN_VALUES_LIMIT}`,
      ...params,
    );
    return rows.map((row) => String(row?.value ?? "").trim()).filter(Boolean);
  } catch (error) {
    // The board itself answers an empty list when the call log is unreadable rather than failing the
    // page; a filter's menu is no reason to be stricter than the rows it filters.
    console.warn("Unable to read the call board's column values:", error?.message || error);
    return [];
  }
}

module.exports = {
  listCallBoardPage,
  callBoardColumnValues,
  listCallBoardIds,
  callBoardTabCounts,
  callBoardVersion,
  callToRecord,
  callColumnSql,
  callViewClause,
  CALL_VIEW_IDS,
  CALL_STATUS_SQL,
};
