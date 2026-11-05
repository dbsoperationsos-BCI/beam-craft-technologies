const prisma = require("../../../config/db");
const { likeLiteral, wordChunks } = require("../../../services/wordChunks");
const { isoDaySqlFor } = require("./leadDates");
const { CRM_LEAD_SQL_COLUMNS, DB_COLUMN, leadColumnSql, PROJECT_DELETED_SQL, PROJECT_DELETED_STATUS } = require("./crmLeadService");
const {
  isOccasionVertical,
  anyOccasionWindowSql,
  occasionWindowSql,
  occasionYearSql,
  occasionOnSql,
  occasionColumnSql,
  occasionOverrideSql,
} = require("./occasionLeadService");

/*
 * ── Which board a lead is on ──────────────────────────────────────────────────────────────────
 *
 * A call Callyzer delivered that nothing in it named a vertical for.
 *
 * `verticalForCall` in callRouting.js refuses to guess - "a guessed vertical is worse than an
 * unassigned one: a wedding lead sitting in Qua Qua is invisible to the people who would have
 * called it back" - and leaves `vertical` blank. Blank then read as Dum Dum, so every call the
 * router could not place landed in the wedding board anyway, which is the very fault that comment
 * was written against.
 *
 * They have a board of their own instead: Calls, where somebody reads the caller and says which
 * vertical it is. Assigning one writes its `vertical`, and it leaves here for that vertical.
 *
 * Scoped to Callyzer deliberately. A blank board on a sheet import or on a manually typed lead
 * still reads as Dum Dum exactly as it always has - this is about the calls nobody has triaged,
 * not about every record with an empty column.
 *
 * Mirrored by `isUnassignedCall` in CRMPage.js, which must test these same two fields and nothing
 * else: the client decides what a row on this board may do, and a looser test there would offer
 * the assign flow on a lead this clause never returned.
 */
const CALLS_SQL = "(TRIM(COALESCE(`vertical`,'')) = '' AND LOWER(TRIM(COALESCE(`source`,''))) = 'callyzer')";

/*
 * ── Why the board is a stored column ──────────────────────────────────────────────────────────
 *
 * These four clauses used to be written out against `vertical` and `source` directly, and every one
 * of them wrapped the column in `LOWER(REPLACE(TRIM(...)))`. A function around a column is a
 * function MySQL has to evaluate for every row before it can decide anything, so no index can help
 * and every board query read the whole table. Measured at 500,000 leads: the first page took 4.1
 * seconds, the tab counts 6.3, and a page reached by scrolling 7.5 - and the board runs all three
 * on every request, so opening Leads & Followups was three full scans and scrolling was three more
 * per page appended.
 *
 * `board_key` is the same decision made once, when the row is written, by a STORED generated column
 * whose definition is these clauses verbatim. It is indexed, so a board is now a range of an index
 * rather than a scan of a table. The migration that adds it carries the same CASE, and
 * `crm-lead-board-key.test.js` holds the two together - if this file's idea of a board and the
 * column's ever diverge, leads sit on the wrong board with nothing to say so.
 *
 * The prose definitions are kept below as `BOARD_SQL_SOURCE`: they are what the generated column
 * means, they are what the test compares against, and they are the fallback the code can be moved
 * back to if the column ever has to be dropped.
 */
const BOARD_SQL_SOURCE = {
  // Mirrors resolveLeadVertical on the client: a lead whose board is blank or unrecognised
  // belongs to Dum Dum, so that tab must return those rows too - except an untriaged call, which
  // has the Calls board to sit on and must not be counted in two places at once.
  "Dum Dum": `(NOT ${CALLS_SQL} AND (TRIM(COALESCE(\`vertical\`,'')) = '' OR LOWER(REPLACE(TRIM(\`vertical\`),' ','')) NOT IN ('quaqua','corp','corporate','corporation')))`,
  "Qua Qua": "LOWER(REPLACE(TRIM(COALESCE(`vertical`,'')),' ','')) = 'quaqua'",
  Corp: "LOWER(REPLACE(TRIM(COALESCE(`vertical`,'')),' ','')) IN ('corp','corporate','corporation')",
  Calls: CALLS_SQL,
};

// The value `board_key` holds for each board. Written into the SQL as a literal rather than as a
// parameter because it comes from this map and never from a caller - and because `buildWhere`
// appends the view's parameters after the board's, so a board that sometimes binds one and
// sometimes does not would put them out of order.
const BOARD_KEY = { "Dum Dum": "dumdum", "Qua Qua": "quaqua", Corp: "corp", Calls: "calls" };

const BOARD_SQL = Object.fromEntries(
  Object.keys(BOARD_SQL_SOURCE).map((board) => [board, `\`board_key\` = '${BOARD_KEY[board]}'`]),
);

/*
 * The vertical a lead reads as, always one of the three.
 *
 * Close to BOARD_SQL above, but answering a different question - which is worth being plain about
 * now that the two can differ. BOARD_SQL answers "which **board** is this lead on", and there are
 * four of those: the three verticals and Calls. This answers "which **vertical** is it", of which
 * there are still only three. A call waiting to be triaged has no vertical yet, and the contact
 * directory that reads this has to file it under something, so it keeps the Dum Dum fallback.
 *
 * That fallback is the part that must stay in step with `resolveLeadVertical` on the client. Change
 * one and change the other.
 */
const VERTICAL_SQL = `CASE LOWER(REPLACE(TRIM(COALESCE(\`vertical\`, '')), ' ', ''))
    WHEN 'quaqua' THEN 'Qua Qua'
    WHEN 'corp' THEN 'Corp'
    WHEN 'corporate' THEN 'Corp'
    WHEN 'corporation' THEN 'Corp'
    ELSE 'Dum Dum'
  END`;

// The grid never prints a raw status:
//   * leadFromRecord and mergeLeadDisplayRecord in CRMPage.js treat a lead with no status
//     as Interested, which is most of them - a lead arrives from a sheet with the column
//     blank and reads as Interested until someone sets it;
//   * normalizeLeadStatus then folds the spellings that arrive from the sheets onto one
//     label, so "Follow-up" reads as Followup and "in review" reads as CNA.
// Filtering has to see the same thing the user is reading, or typing the label straight off
// the screen finds nothing. Keep this in step with those three functions.
/*
 * ── A Qua Qua occasion is worked as its own enquiry ────────────────────────────────────────────
 *
 * A lead whose baby is due, or whose child has a birthday coming up, is not being worked on the
 * strength of the status it already carries - that status is the record of the last shoot. Either
 * occasion is a fresh reason to call, so while a Qua Qua lead is inside one of the two windows the
 * board reads its status, its attempt count and its follow-up date from that occurrence in
 * `sales_crm_lead_occasion` instead. The rule itself, in both SQL and JavaScript, lives in
 * `occasionLeadService.js`.
 *
 * The three functions below are what carry that through the whole query. Every place this file used
 * to write `status_key`, `STATUS_DISPLAY_SQL` or `follow_up_day` now asks one of them, because a
 * board where the Status column reads one thing and the tabs filter on another is worse than either
 * being wrong on its own - the user types the label they can see and the tab comes back empty.
 *
 * Off the Qua Qua board each of them collapses to exactly the column it always was, so no occasion
 * SQL is generated for Dum Dum, Corp or Calls at all.
 */

/**
 * The status the lead is actually being worked at, folded the way `status_key` is: trimmed and
 * lowercased.
 *
 * An occasion that has been given a status is read at that status - that is what working an occasion
 * as its own enquiry means, and it is untouched. An occasion **nobody has started** falls back to the
 * status the lead itself carries, and that is the half that was missing.
 *
 * `createCrmLead` already says why, in as many words: a lead added while one of its windows is open
 * "starts that occasion at the status it was added with", because "without this the row would go
 * straight into Yet to connect on the strength of an empty occurrence, however plainly the person
 * adding it had just spoken to the client". That fix was applied to Add Lead and to nothing else -
 * occurrence rows are written by `crmLeadService` alone - so a lead that arrived by **CSV import or
 * sheet sync** had no occurrence at all and hit exactly the case that comment describes. It read as
 * having no status whatever its Status column said: out of Today Pending and Yesterday Pending,
 * which ask for Followup, and into Yet to connect, which is the queue for leads nobody has rung.
 *
 * So the same rule now reaches every lead rather than only the ones typed in, and it reaches the
 * ones already imported without a backfill. On a 32,881-lead Qua Qua board: Today Pending 88 -> 96,
 * and 787 leads that carry a real status from their last shoot left Yet to connect, which is the
 * point - they have been rung.
 */
function statusKeySql(board, today) {
  return occasionOverrideSql(
    board,
    today,
    (occasion) => `COALESCE(${occasionColumnSql(occasion, today, "status_key")}, \`status_key\`, '')`,
    "`status_key`",
  );
}

/**
 * The raw status text, for the fall-through at the bottom of the display CASE.
 *
 * Falls back exactly as `statusKeySql` does, and has to: the Status column is drawn from this and the
 * tabs filter on that, so a lead reading Followup on screen while the tab filtered on an empty status
 * is the one failure this whole group of functions exists to prevent.
 */
function statusTextSql(board, today) {
  return occasionOverrideSql(
    board,
    today,
    (occasion) => `COALESCE(${occasionColumnSql(occasion, today, "status")}, \`status\`, '')`,
    "`status`",
  );
}

/**
 * The follow-up date the lead is actually being chased on, as a day.
 *
 * `COALESCE`d onto the lead's own column, the way `statusKeySql` and `statusTextSql` above are, and
 * for the same reason: an occurrence that exists but has been given no follow-up date has not said
 * anything about when this lead is due, so the date the lead itself carries still stands.
 *
 * Without it, an occasion window **hid a date somebody had set**. The occurrence rows are written by
 * `crmLeadService` - Add Lead, the lead popup, a bulk status change - and by nothing else, so a lead
 * that arrived by CSV import or by sheet sync has none at all. For any such Qua Qua lead inside a
 * newborn or birthday window the correlated lookup answered NULL, `NULL = '<today>'` is NULL, and the
 * lead fell out of Today and both dated pending tabs however plainly its Next Followup Date read
 * today - then reappeared in Overall Pending, which takes a NULL follow-up day as work owed on a day
 * the board cannot name. A call booked for today filed as part of the backlog.
 *
 * On a 32,881-lead Qua Qua board, 179 leads were dated today and the tab listed 160: 10 inside the
 * newborn window and 9 inside the birthday window, every one of them with no occurrence row.
 *
 * What this does not change: an occurrence that *has* been given a follow-up date still wins. That is
 * the whole point of working an occasion as its own enquiry, and it is untouched here.
 */
function followUpDaySql(board, today) {
  return occasionOverrideSql(
    board,
    today,
    (occasion) => `COALESCE(${occasionColumnSql(occasion, today, "follow_up_day")}, \`follow_up_day\`)`,
    "`follow_up_day`",
  );
}

/**
 * What a lead with no status at all reads as.
 *
 * **Yet to connect, for as long as it has no status.** A lead nobody has given a status to is not
 * Interested and it is not finished: nobody has spoken to it, and that stays true however long ago
 * the enquiry came in. Setting a status is the only thing that moves it, which is what makes this
 * queue one that empties by being worked rather than by ageing.
 *
 * It used to read Yet to connect on the day of its Enquiry Date and **Inactive** from the next
 * morning, with two exemptions bolted on - an occasion inside its window, and anything a Google
 * Sheet link put here - because each of those was plainly a call still to be made that the ageing
 * rule was hiding. The exemptions were the rule telling on itself: a lead nobody has rung is a lead
 * nobody has rung on day two as much as on day one, and a studio reading a queue that emptied
 * itself overnight was reading a shorter list than the work it owed. So the ageing is gone rather
 * than exempted from a third way, and the derived Inactive with it.
 *
 * Inactive is still a label this column can print: an import whose own Status column said so stores
 * the word, and `statusDisplaySql` passes stored text through untouched. It is no longer something
 * the application decides about a lead on the lead's behalf.
 *
 * No `board` and no `today` any more, which is the whole of the change: the answer depends on
 * neither. `occasionOverrideSql` wrapped this so a Qua Qua lead inside a window could be exempted
 * from ageing, and with nothing left to be exempted from the wrapper said one thing twice.
 *
 * Mirrors resolveLeadStatus in frontend/src/components/sales/CRMPage.js.
 */
function unsetStatusSql() {
  return "'Yet to connect'";
}

/**
 * A lead nobody has been given.
 *
 * `crm` is the person a lead is assigned to - the Assign To field on the form, the CRM column on the
 * board - and a lead with nothing in it has been given to nobody. Trimmed, because a cell holding a
 * space is not a person: those arrive from sheets and from files all the time.
 *
 * Stated once because three things read it and must agree: the Status column, which prints
 * **Unassigned** for such a lead; the tab of that name, which lists exactly them; and the count
 * beside that tab.
 *
 * Mirrors `isUnassignedLead` in frontend/src/components/sales/CRMPage.js.
 */
const UNASSIGNED_SQL = "TRIM(COALESCE(`crm`, '')) = ''";

/**
 * The status as the Status column prints it.
 *
 * The grid never shows a raw status: `leadFromRecord` and `mergeLeadDisplayRecord` in CRMPage.js
 * resolve the unset case, and `normalizeLeadStatus` folds the spellings that arrive from the sheets
 * onto one label - so "Follow-up" reads as Followup and "in review" reads as CNA. Filtering has to
 * see the same thing the user is reading, or typing the label straight off the screen finds
 * nothing. Keep this in step with those three functions.
 */
function statusDisplaySql(board, today) {
  return `
  CASE
    /*
     * Every project of the enquiry is in Resource Management → Recycling Bin: read before anything
     * else, and nothing stored. Restore and the lead reads its own status again (PROJECT_DELETED_SQL).
     */
    WHEN ${PROJECT_DELETED_SQL} THEN '${PROJECT_DELETED_STATUS}'
    /*
     * Assigned to nobody, which is read before anything the lead's own status says.
     *
     * A lead nobody has been given is not being worked, whatever the status against it reads - and
     * the studio asked for that to be visible as a status of its own rather than hidden behind a
     * label describing work somebody would have to be doing. It wins outright: a lead that says
     * Converted with no CRM against it is a lead nobody owns, and reading it as Converted is how it
     * stays that way.
     *
     * Nothing is stored by this. The status column underneath is untouched, so putting somebody on
     * the lead brings its own status straight back.
     */
    WHEN ${UNASSIGNED_SQL} THEN 'Unassigned'
    WHEN ${statusKeySql(board, today)} = '' THEN ${unsetStatusSql()}
    ELSE CASE ${statusKeySql(board, today)}
    WHEN 'follow-up' THEN 'Followup'
    WHEN 'followup' THEN 'Followup'
    WHEN 'in review' THEN 'CNA'
    WHEN 'cna' THEN 'CNA'
    WHEN 'invalid' THEN 'Invalid'
    WHEN 'rejected' THEN 'Rejected'
    WHEN 'converted' THEN 'Converted'
    WHEN 'followup & converted' THEN 'Converted & Followup'
    WHEN 'followup and converted' THEN 'Converted & Followup'
    WHEN 'followup-converted' THEN 'Converted & Followup'
    WHEN 'converted & followup' THEN 'Converted & Followup'
    WHEN 'converted and followup' THEN 'Converted & Followup'
    WHEN 'converted-followup' THEN 'Converted & Followup'
    WHEN 'interested' THEN 'Interested'
      ELSE ${statusTextSql(board, today)}
    END
  END`;
}

// Column id -> the SQL that produces the value shown in that cell, so a filter always
// matches what the user can actually see rather than a differently-named raw column.
const COLUMN_SQL = {
  id: "`enquiry_id`",
  enquiryId: "`enquiry_id`",
  enquiryName: "`name`",
  /*
   * The day the enquiry came in - and the same day the cell shows.
   *
   * This fell back to `added_time`, which holds a clock time ("10:08 am") and never a date: the
   * `date` column is empty on almost every lead, so filtering or sorting Enquiry Date was comparing
   * the typed date against a time of day and finding nothing, while the column on screen showed a
   * real date read from `created_date`. A filter that cannot match what the column is showing reads
   * as a filter that does not work.
   *
   * The fallbacks are now the ones `getLeadCellValue` uses, in the same order, ending at the row's
   * own insert timestamp - which is the only record of when a lead arrived if nothing else was set.
   */
  enquiryDate: "COALESCE(NULLIF(`date`,''), NULLIF(`created_date`,''), DATE_FORMAT(`created_at`, '%Y-%m-%d'))",
  addedTimestamp: "`added_time`",
  // The physical branch, which is its own column - not the vertical beside it.
  assignedBranch: "`assigned_branch`",
  contact: "COALESCE(NULLIF(`contact_number`,''), `phone`)",
  contactNumber: "COALESCE(NULLIF(`contact_number`,''), `phone`)",
  eventPlannedType: "COALESCE(NULLIF(`event_planned_type`,''), `shoot_type`)",
  eventPlannedDate: "COALESCE(NULLIF(`event_planned_date`,''), `next_follow_up_date`)",
};

/*
 * The columns whose value depends on which board is being read, so they cannot sit in the map
 * above - a Qua Qua lead with an occasion open shows that occasion's status and follow-up date
 * rather than the lead's own. Filters and sorting go through here for the same reason the map
 * exists: what is filtered has to be what is displayed.
 */
const BOARD_COLUMN_SQL = {
  status: statusDisplaySql,
  nextFollowUpDate: (board, today) => occasionOverrideSql(
    board,
    today,
    (occasion) => `COALESCE(${occasionColumnSql(occasion, today, "next_follow_up_date")}, '')`,
    "`next_follow_up_date`",
  ),
};

function columnSql(columnId, { board = "", today = "" } = {}) {
  if (BOARD_COLUMN_SQL[columnId]) return BOARD_COLUMN_SQL[columnId](board, today);
  if (COLUMN_SQL[columnId]) return COLUMN_SQL[columnId];
  // Only ever build SQL from a known column name; never from caller-supplied text.
  return CRM_LEAD_SQL_COLUMNS.includes(columnId) ? `\`${DB_COLUMN[columnId]}\`` : null;
}

function boardClause(board) {
  return BOARD_SQL[board] || null;
}

/**
 * A date column folded to the `YYYY-MM-DD` key the tabs compare against.
 *
 * These are TEXT columns written by three different producers - the app's date picker, CSV
 * import and Google Sheets - so one day can arrive as "2026-08-12", as "2026-08-12 09:30:00"
 * or as "12/08/2026". Comparing the raw text to today's key matches only the first of those,
 * which reads as a tab that does not work rather than as a date that was stored oddly.
 *
 * The slashed form is taken as day-first: that is what `toLocaleDateString("en-GB")` writes,
 * and it is the form this module produces everywhere it formats a date itself.
 */
/*
 * One list of date shapes, stated in `leadDates.js` and shared with the JavaScript that reads the
 * same values - `crm-lead-dates.test.js` runs both over the same samples against this database.
 *
 * It understood ISO and `DD/MM/YYYY` and nothing else, which is not what a spreadsheet writes:
 * Excel's short date is `09-Sep-26`, so an imported file stored dates the board then read as NULL -
 * no Today New Leads, no Yet to connect, no date range, and the Enquiry Date cell falling through to
 * the row's insert timestamp and printing today on every row of the import.
 */
function isoDayOf(expression) {
  return isoDaySqlFor(expression);
}

function isoDaySql(column) {
  return isoDayOf(`\`${DB_COLUMN[column] || column}\``);
}

/**
 * The day the Enquiry Date column is showing, as a `YYYY-MM-DD` key.
 *
 * `COLUMN_SQL.enquiryDate` is the value in the cell; this is that value folded to a day, so a tab
 * comparing it lists exactly the rows whose Enquiry Date reads as the day asked for. Written over
 * the one expression rather than beside it, because the filter and the sort on that column already
 * go through it - three readers of "the enquiry date" that have to answer the same.
 */
function enquiryDaySql() {
  return isoDayOf(COLUMN_SQL.enquiryDate);
}

// The day before the one the client is treating as today.
function previousDay(today) {
  const date = new Date(`${String(today || "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// Both windows - the newborn one around the estimated delivery date and the birthday one before the
// child's next birthday - are stated once in `occasionLeadService.js`, along with the rest of the
// rule: which year each occurrence is filed under, and the same test written again in JavaScript for
// the write path.

// The same text column read as a real DATE, so it can be compared and offset. Anything that
// is not a recognisable day yields NULL and simply does not match.
function asDateSql(column) {
  return `STR_TO_DATE(${isoDaySql(column)}, '%Y-%m-%d')`;
}

/**
 * The leads nobody has spoken to yet, as one expression.
 *
 * `unsetStatusSql` asked as a question, and it is now a short one: the status the lead is being
 * worked at is empty. No arrival day, no sheet marker, no occasion window - each of those was a way
 * of saying "and this one has not gone stale either", and nothing goes stale any more.
 *
 * `statusKey` is what carries the rest of the meaning. It is `status_key` on Dum Dum and Corp, and
 * on Qua Qua the open occasion's own status - so a lead inside a birthday window is asked about
 * that birthday rather than about the enquiry it first arrived as, and setting a status on the
 * occasion takes it out of the queue.
 *
 * Stated once because two tabs read it: **Yet to connect** and **Today Pending Followups**. Written
 * out twice they would drift, and a lead listed by one and not the other reads as a bug in both.
 *
 * No parameter to push any more, so callers no longer have to place one.
 */
function yetToConnectSql(statusKey) {
  return `${statusKey} = ''`;
}
/**
 * Whether the Status column reads "Yet to connect" - by derivation or by the words themselves.
 *
 * `yetToConnectSql` answers the derived half: no status set. The second half is the leads that carry
 * the label as stored text, which is what an import writes when the file's own Status column said
 * it. `statusDisplaySql` folds neither onto anything else, so both print "Yet to connect" on the row
 * - and a tab cut by only one of them lists half of what its name promises.
 */
function readsYetToConnectSql(statusKey) {
  const stored = `REPLACE(REPLACE(${statusKey}, ' ', ''), '-', '') = 'yettoconnect'`;
  return `(${yetToConnectSql(statusKey)} OR ${stored})`;
}

/**
 * Tab definitions, expressed once and reused by both the page query and the counts.
 *
 * `board` is here because the status-driven tabs mean something different on Qua Qua: a lead with
 * an occasion open is worked at that occasion's status rather than at the lead's own, so they have
 * to read the same thing the Status column is showing. `statusKeySql` and
 * `followUpDaySql` are what carry that; on the other boards they are the plain columns.
 */
function viewClause(view, today, params, board = "") {
  const statusKey = statusKeySql(board, today);
  const followUpDay = followUpDaySql(board, today);
  if (view === "new") {
    params.push(today);
    /*
     * The leads whose **Enquiry Date** is today - the date the cell shows, not the day the row
     * reached this table.
     *
     * It compared `created_day`, the stored, indexed fold of `created_date` falling back to the
     * row's own insert timestamp. That is the day a lead was *written*, and for anything arriving
     * from a sheet the two are not the same: `date` carries the enquiry's own date and the tab
     * ignored it, so a lead whose Enquiry Date column read last month sat in Today New Leads
     * because that is when the sync ran, and one whose column read today was missing from it.
     *
     * The fallback to the insert timestamp stays, inside `COLUMN_SQL.enquiryDate`: a lead nobody
     * gave a date is still new on the day it was entered, which is the only thing left to date it
     * by. So this is a narrowing of the old clause and never a widening - every lead it lists has
     * an Enquiry Date of today, whichever of the three sources that date came from.
     *
     * The cost is that this reads the text columns per row rather than the indexed `created_day`.
     * Deliberate: the alternative is redefining a STORED generated column, which rebuilds the whole
     * table. The board's own `board_key` clause still narrows the scan to one vertical first, and
     * the header's date range - the other reader of an arrival day - is not offered on this tab
     * (see `DATED_VIEWS`), so the two never have to agree inside one query.
     */
    return `${enquiryDaySql()} = ?`;
  }
  /*
   * The leads nobody has spoken to yet - every one of them, whatever day the enquiry came in.
   *
   * `readsYetToConnectSql` and not `yetToConnectSql`: the label arrives two ways and the tab has to
   * hold both, or it lists half of what its name promises. A lead with no status reads Yet to
   * connect by derivation, and one imported from a file or sheet whose own Status column said so
   * carries the words as stored text. Today Pending Followups was moved onto this pair first and
   * this tab, the one actually named for the label, was left behind on the derived half alone -
   * so a row could read Yet to connect in the Status column, answer a Status filter of Yet to
   * connect, be counted in Today Pending, and still be missing from the tab.
   *
   * No date in it any more. It listed the untouched leads that had *arrived today*, which made the
   * tab a cut of two things at once and quietly emptied it overnight: an enquiry nobody rang on
   * Monday was gone from the queue on Tuesday morning, still unrung. The arrival day has a tab of
   * its own - Today New Leads - and this one is now the backlog it is named for.
   *
   * A lead that has been given any status has been connected with, whatever the status is, and
   * leaves. That is what keeps the queue one that empties by being worked.
   */
  /*
   * A lead nobody has been given is not in this tab, because its Status column no longer reads Yet
   * to connect - it reads Unassigned, and this tab lists exactly what that column says. That is the
   * promise above, and it is one this module has already been caught breaking once: a row that read
   * Yet to connect, answered a Status filter of Yet to connect and was counted in Today Pending
   * was missing from the tab named for the label. The two ends of a lead's life are now a clean
   * split - nobody is on it, or nobody has rung it - and All still holds both.
   */
  if (view === "yetToConnect") return `${readsYetToConnectSql(statusKey)} AND NOT (${UNASSIGNED_SQL})`;
  /*
   * The leads nobody has been given, which is what their Status column now reads.
   *
   * Its own tab rather than a cut of another, because it answers a question none of the others do:
   * not what state a lead is in, but whether anybody is on it at all. The rows it lists are exactly
   * the rows reading Unassigned, the same way Yet to connect lists exactly the rows reading that -
   * and since Unassigned wins over the lead's own status, the two tabs are a clean split.
   *
   * The **pending** tabs are deliberately not split this way. They are cut by the follow-up date
   * alone, so an unassigned lead with a call booked still appears under the call it owes. Hiding an owed call because nobody has been put on the lead would lose the work twice
   * over. This tab says who owns it; those say what is due.
   */
  if (view === "unassigned") return UNASSIGNED_SQL;
  if (view === "today") {
    params.push(today);
    // `follow_up_day` is the stored, indexed form of the same date the text column holds - see the
    // note on `board_key`. Read off the text column this compared a parsed date per row, which is
    // a scan; here it is a lookup.
    return `${followUpDay} = ?`;
  }
  /*
   * ── The three pending tabs are cut by the Next Followup Date ─────────────────────────────────
   *
   * A lead is on a pending tab when its Next Followup Date falls on that tab's day, **whatever its
   * status but Converted**: a call booked is a call owed, whatever the lead reads. They used to ask for status
   * Followup as well, which hid every booked call on a lead at any other status. Today Pending is
   * the calls booked for today, Yesterday Pending those booked for yesterday, and Overall Pending
   * everything booked for today or earlier.
   *
   * Dated by the follow-up, not the enquiry: a lead that enquired in July with a call booked for
   * yesterday is work owed yesterday. **Overall deliberately overlaps the other two** - it is the
   * whole outstanding book, today included - so the strip's counts do not add up to the board.
   *
   * A lead with no readable follow-up date is on none of the three. Overall used to take those in,
   * but only while it also asked for Followup; with the status gone that would be every undated
   * lead on the board. Invalid and Rejected clear the date when they are set, and so does Converted
   * on Dum Dum and Corp, so they leave on their own (`endsTheConversation` in crmLeadService.js).
   *
   * **Converted is never on them, on any vertical.** Dum Dum and Corp clear a converted lead's date
   * anyway; a Converted Qua Qua lead may keep one (the client comes back for the next shoot), and it
   * is still not a follow-up the board should chase. Plain Converted only - "Converted & Followup"
   * is a client still being worked, and stays. `COALESCE` because `status_key` is NULL on a lead with
   * no status, and `NULL <> 'converted'` is not true - it would drop every one of them.
   *
   * `followUpDay` rather than the text column: it is the stored, indexed fold of the same date (and
   * a Qua Qua lead inside an occasion is read at that occasion's date), so these are a lookup.
   */
  const notConverted = `REPLACE(REPLACE(COALESCE(${statusKey}, ''), ' ', ''), '-', '') <> 'converted'`;
  if (view === "pending") {
    params.push(today);
    return `(${followUpDay} = ? AND ${notConverted})`;
  }
  if (view === "yesterdayPending") {
    // Yesterday is derived from the day the client considers today, so the tab agrees with
    // the others rather than with the server's own clock in a different timezone.
    params.push(previousDay(today));
    return `(${followUpDay} = ? AND ${notConverted})`;
  }
  if (view === "overallPending") {
    // `<=` today, not `<`: the tab is the total still owed, and a call booked for today is owed.
    params.push(today);
    return `(${followUpDay} <= ? AND ${notConverted})`;
  }
  /*
   * Qua Qua's two date-driven tabs, both read off "Date of Birth (or) EDOD" - the one field that
   * holds either an expected delivery date or a date of birth, depending on the lead.
   *
   * Newborns is a window around the lead's own estimated date, from 30 days before it to 5 days
   * after. Birthdays looks forward from today, 0 to 45 days out, at the *recurrence* of the stored
   * date rather than the date itself - a date of birth is in the past, so a forward window would
   * never match it, and what comes round is its day and month. And only the first recurrence: the
   * occasion is the child born last year turning one, not every birthday that client's child has.
   *
   * Each clause is the occasion's own window from `occasionLeadService.js`, because that same window
   * decides three other things - which leads Yet to connect picks up, which status the board reads,
   * and where a status written from here is stored - and those cannot be allowed to disagree with
   * the tab by a day.
   *
   * Both tabs list every lead in their window whatever its status: they are this season's newborn
   * and birthday lists, not the part of each still to be called. That is Yet to connect.
   */
  if (view === "newborns") return occasionWindowSql("NEWBORN", today);
  if (view === "birthdays") return occasionWindowSql("BIRTHDAY", today);
  if (view === "converted") {
    // Both spellings of the combined status count as converted: the label was renamed from
    // "Followup & Converted", and rows written before that still hold the old order.
    // Not a lead whose every project is in the Recycling Bin: it reads "Project deleted", not Converted.
    return `REPLACE(REPLACE(${statusKey}, ' ', ''), '-', '') IN ('converted', 'followup&converted', 'converted&followup') AND NOT ${PROJECT_DELETED_SQL}`;
  }
  if (view === "rejected") {
    // The leads that have been turned down. One spelling, matched the way `statusDisplaySql` folds
    // it onto the label, so the tab holds exactly the rows whose Status column reads Rejected.
    return `${statusKey} = 'rejected' AND NOT ${PROJECT_DELETED_SQL}`;
  }
  return null;
}

/** The scope's own columns on this table, for `scope.sql()`. */
const SCOPE_SQL_COLUMNS = { branch: "`branch_id`", employee: "`owner_employee_id`", user: "`created_by_user_id`" };

/*
 * ── The header's date range ───────────────────────────────────────────────────────────────────
 *
 * Today, Yesterday, This Week, This Month or two days picked by hand, resolved to a pair of
 * `YYYY-MM-DD` keys by the client (`frontend/src/lib/crmDateRange.mjs`) and applied here to the day
 * the lead arrived.
 *
 * The **Enquiry Date** the Date column shows - `date`, then `created_date`, then the row's own
 * insert timestamp - and not `created_day`, the day the row was written. Those are the same thing
 * for a lead typed into Add Lead and are not the same thing for anything imported or synced, and a
 * reader who picks "This Month" means the enquiries of this month, not the rows that happened to be
 * written this month. It is the one expression every tab on this board now answers from, so a range
 * and a tab narrow the same set rather than two different readings of "when did this arrive".
 *
 * The cost is real and is accepted with open eyes: `created_day` is a stored, indexed column and
 * this is a function per row across the board. It is the same cost the Today New Leads tab has
 * always paid, the `board_key` clause still narrows the scan to one vertical before it runs, and the
 * alternative is a new STORED generated column over the three source columns - a migration that
 * rebuilds the whole table. If this board ever reaches a size where the range feels slow, that
 * generated column beside `created_day` is the fix, and it changes this expression only.
 *
 * Either end alone is a valid range, and a range is never a reason to return a lead whose day is
 * unreadable: the expression is NULL for one, and NULL fails both comparisons, which is the honest
 * answer for a row that cannot say when it arrived.
 */
function dateRangeClauses({ dateFrom = "", dateTo = "" } = {}, clauses, params) {
  const day = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "").slice(0, 10)) ? String(value).slice(0, 10) : "");
  const from = day(dateFrom);
  const to = day(dateTo);
  if (from) { clauses.push(`${enquiryDaySql()} >= ?`); params.push(from); }
  if (to) { clauses.push(`${enquiryDaySql()} <= ?`); params.push(to); }
}

/*
 * Which tabs the header's date range applies to.
 *
 * Three of the lead tabs are already a date: Today New Leads is the leads that arrived today, and
 * the two pending tabs are the follow-ups owed today and owed yesterday. A range on top of one of
 * them is two answers to one question, so the client does not offer the switch there - see
 * `showsDateRange` in frontend/src/lib/crmDateRange.mjs, which this mirrors and which
 * `crm-date-range.test.js` holds the two halves of together.
 *
 * It is mirrored here rather than left to the client because of the **counts**. The strip above the
 * board is counted in one pass, and the range used to be applied to that whole pass - so with a
 * range on All, the Incoming tab read "2" and then showed 6 rows when it was opened, because the
 * tab itself does not carry the range. A tab has to be counted the way it is read, or the number
 * beside its name is a promise it cannot keep.
 */
const DATED_VIEWS = new Set(["new", "pending", "yesterdayPending"]);

const viewCarriesDateRange = (view) => !DATED_VIEWS.has(String(view || ""));

/*
 * The board's column filters, as clauses pushed onto a list the caller owns.
 *
 * A helper rather than a loop inside `buildWhere` for the same reason `dateRangeClauses` is one:
 * the counts need these predicates somewhere other than the outer WHERE. `buildWhere` puts them
 * there because a page of rows is one query and the filter narrows all of it; `crmLeadTabCounts`
 * counts twelve tabs in a single pass and has to put them inside one tab's own CASE. Neither can
 * be written in terms of the other, so the predicate itself is what they share.
 *
 * Two shapes, and the shape is the question.
 *
 * A **string** is what somebody typed into the box above a column, and it narrows by matching text:
 * Word Chunk Search - one `LIKE ?` per word typed, all of them required, in any order.
 *
 * A **list** is what they ticked in a column that offers one, and it is an exact `IN`. Exact because
 * the list is built from `columnValues` - the values this board actually holds - so "Bala" chosen
 * from it means that value and not every value containing it, which is the difference between
 * reading one person's leads and reading everyone whose name contains theirs.
 *
 * Capped, de-duplicated and emptied of blanks: the list arrives as JSON on a query string, so its
 * length is the caller's to choose and the placeholder list is ours to bound.
 */
const MAX_FILTER_VALUES = 200;
/**
 * A board column's own search box (`CrmKanbanBoard`): every word typed must be found in the lead's
 * name, number or Enquiry ID - any of the three - so "naidu 98" finds Naidu whose number has 98.
 * Sent as the `_search` filter key, which no column is named.
 */
const SEARCH_FILTER = "_search";
const SEARCH_COLUMNS = ["name", "contact", "enquiryId"];
function columnFilterClauses({ filters = {}, board, today }, clauses, params) {
  for (const [columnId, rawValue] of Object.entries(filters)) {
    if (columnId === SEARCH_FILTER) {
      const fields = SEARCH_COLUMNS.map((id) => columnSql(id, { board, today })).filter(Boolean);
      for (const chunk of wordChunks(typeof rawValue === "string" ? rawValue : "")) {
        clauses.push(`(${fields.map((field) => `${field} LIKE ?`).join(" OR ")})`);
        params.push(...fields.map(() => `%${likeLiteral(chunk)}%`));
      }
      continue;
    }
    const sql = columnSql(columnId, { board, today });
    if (!sql) continue;

    if (Array.isArray(rawValue)) {
      const values = [...new Set(rawValue.map((entry) => String(entry ?? "").trim()).filter(Boolean))].slice(0, MAX_FILTER_VALUES);
      // An empty list is **no filter**, not a filter matching nothing - the same reading the
      // control gives it, so unticking the last value shows the board rather than emptying it.
      if (!values.length) continue;
      clauses.push(`${sql} IN (${values.map(() => "?").join(", ")})`);
      params.push(...values);
      continue;
    }

    for (const chunk of wordChunks(rawValue)) {
      clauses.push(`${sql} LIKE ?`);
      // The chunk as typed: `%`, `_` and `\` matched as themselves, never as wildcards.
      params.push(`%${likeLiteral(chunk)}%`);
    }
  }
}

/**
 * "Only mine", as the board's own toggle asks it.
 *
 * A **view filter, never a widening**: it is ANDed with the data scope that has already decided what
 * this reader may see at all, so it can only ever take rows away from that answer. That is what
 * makes it safe to offer to everybody - a manager narrowing to their own work, and a Super Admin,
 * who the scope narrows by nothing and who has no other way to ask this.
 *
 * Mine means **the CRM column and nothing else**: `owner_employee_id`, which is the person the lead
 * is assigned to.
 *
 * It used to mean that *or* `created_by_user_id` - the login that typed the lead in - and that is
 * the wrong question. Somebody adding a lead on a colleague's behalf, which is most of how leads
 * arrive here, then saw it under "My Leads" while the person actually working it saw it too; a
 * board meant to answer "what is on me today" answered with other people's work. Whoever is named
 * as CRM owns the lead, and nobody else's My Leads shows it - a Super Admin who created a hundred
 * leads and is named on none of them included.
 *
 * Deliberately not the branch either: a colleague's lead in my branch is not mine, and on this
 * board the branch never granted it anyway.
 *
 * `=` rather than `IN`, and null-safe by consequence: a lead with **no CRM** matches no CRM's own
 * board, because `NULL = 1` is null and not true.
 *
 * It does match for a reader who sees the whole studio (`seesUnassigned`), and only for them. An
 * unassigned lead is nobody's work, and if it appeared on no My Leads at all it could be found only
 * by turning the switch off and reading the entire board - so it surfaces for the people who hand
 * leads out, as work waiting to be given to somebody. A CRM reading their own leads is not shown
 * other people's unassigned work.
 *
 * An account with no employee record and no such reach matches nothing, which is the honest answer
 * to "show me mine" from a login named on no lead - an empty board rather than a borrowed one.
 */
function mineClause(mine) {
  if (!mine) return null;
  const limbs = [];
  const params = [];
  if (Number.isInteger(mine.employeeId) && mine.employeeId > 0) {
    limbs.push("`owner_employee_id` = ?");
    params.push(mine.employeeId);
  }
  // `0` as well as NULL: the CRM column resolves to an employee id, and a name that matched nobody
  // has been written as either over the life of this table.
  if (mine.seesUnassigned) limbs.push("(`owner_employee_id` IS NULL OR `owner_employee_id` = 0)");
  if (!limbs.length) return { clause: "1=0", params: [] };
  return { clause: limbs.length === 1 ? limbs[0] : `(${limbs.join(" OR ")})`, params };
}

function buildWhere({ board, view, filters = {}, today, scope = null, mine = null, dateFrom = "", dateTo = "" }) {
  const clauses = [];
  const params = [];

  /*
   * Whose leads: the resolved data scope, as the same ids the Prisma paths narrow by. First, and
   * never a clause a filter could stand in for - a column filter is `LIKE ?` on a text column and
   * cannot name a reference. Absent means the caller resolved nothing, which is only right for the
   * internal readers (the dashboard resolves once and passes it down).
   */
  if (scope) {
    const own = scope.sql(SCOPE_SQL_COLUMNS);
    if (own.clause !== "1=1") { clauses.push(own.clause); params.push(...own.params); }
  }

  const boardSql = boardClause(board);
  /*
   * A soft-deleted lead is on no board, which is why `board_key` is NULL for one - so naming a
   * board already excludes it and `deleted_at IS NULL` would only be a second way of saying so.
   *
   * That second way was expensive out of all proportion to what it said. MySQL saw a predicate on
   * `deleted_at`, an indexed column, and chose that index - which is one entry per lead in a table
   * where all but a handful are live, so it read 246,811 rows to answer a question the board index
   * could have answered from 125,000 index entries without touching a row. Counting one board took
   * 3.5 seconds that way and takes 62ms this way, and no hint or ANALYZE would talk the optimizer
   * out of it: the only reliable fix was to stop giving it the choice.
   *
   * Still applied when there is no board - `boardClause` answers null for a board nobody defined,
   * and a query with no board clause at all must not start returning deleted leads.
   */
  if (boardSql) clauses.push(boardSql);
  else clauses.push("`deleted_at` IS NULL");

  // Straight after the scope, because it narrows the same question: the scope says what this reader
  // may see, and this says which of that they asked to look at. See `mineClause`.
  const mineSql = mineClause(mine);
  if (mineSql) { clauses.push(mineSql.clause); params.push(...mineSql.params); }

  const viewSql = viewClause(view, today, params, board);
  if (viewSql) clauses.push(viewSql);

  /*
   * After the tab and before the column filters, which is where it belongs in both senses: it
   * narrows whatever the tab lists, and it is not one of the `LIKE` filters below.
   *
   * Only on a tab that carries it. The three dated tabs are already a date, and the client does not
   * offer the switch on them - so applying it here would narrow a board by a filter with no control
   * on screen to clear it.
   */
  if (viewCarriesDateRange(view)) dateRangeClauses({ dateFrom, dateTo }, clauses, params);

  columnFilterClauses({ filters, board, today }, clauses, params);

  return { where: clauses.join(" AND "), params };
}

/**
 * The occasion a row is currently being worked for, carried on the row itself.
 *
 * The board needs more than the status: the Status column, the CNA count on the pill and the
 * follow-up fields all have to show this occasion's values rather than the lead's, and the write
 * path has to know which occasion and which year it is writing. Sent as fields of their own rather
 * than folded over the lead's own columns on the way out, so that a screen which reads a lead and
 * saves it back cannot copy an occasion's status onto the lead by accident.
 *
 * `occasionOverrideSql` picks the open occasion for each field, so a lead in its newborn window
 * reads its newborn occurrence and one in its birthday window reads its birthday occurrence - and
 * `occasionKind` says which, so the screen can name it.
 *
 * Empty on every other board: only Qua Qua works these, and the override generates no occasion SQL
 * at all for the rest.
 */
function occasionSelectColumns(board, today) {
  if (!isOccasionVertical(board)) return [];
  const pick = (whenWorking) => occasionOverrideSql(board, today, whenWorking, "NULL");
  return [
    `IF(${anyOccasionWindowSql(today)}, 1, 0) AS \`occasionWindow\``,
    `${pick((occasion) => `'${occasion}'`)} AS \`occasionKind\``,
    `${pick((occasion) => occasionYearSql(occasion, today))} AS \`occasionYear\``,
    `${pick((occasion) => occasionOnSql(occasion, today))} AS \`occasionOn\``,
    `${pick((occasion) => occasionColumnSql(occasion, today, "status"))} AS \`occasionStatus\``,
    `${pick((occasion) => occasionColumnSql(occasion, today, "cna_sequence"))} AS \`occasionCnaSequence\``,
    `${pick((occasion) => occasionColumnSql(occasion, today, "next_follow_up_date"))} AS \`occasionNextFollowUpDate\``,
    `${pick((occasion) => occasionColumnSql(occasion, today, "next_follow_up_time"))} AS \`occasionNextFollowUpTime\``,
  ];
}

/*
 * What a board column's leads are worth, summed over the same rows its count is - the WHERE, the
 * scope and "only mine" are the count's own.
 *
 * Estimated: each lead's Estimated Value. The column is free text, so a value counts only once its
 * commas and spaces are gone and it reads as a plain number; anything else ("TBD") adds nothing.
 *
 * Converted: each lead's **last** conversion - the Initial Converted Value of its newest live project
 * (a lead booked twice counts once, at its latest booking), the figure its Converted History shows.
 */
const VALUE_TOTALS_SQL = `
  SUM(CASE WHEN REPLACE(REPLACE(\`estimated_value\`, ',', ''), ' ', '') REGEXP '^[0-9]+([.][0-9]+)?$'
    THEN CAST(REPLACE(REPLACE(\`estimated_value\`, ',', ''), ' ', '') AS DECIMAL(16, 2)) ELSE 0 END) AS estimatedValue,
  SUM((SELECT \`p\`.\`initial_converted_value\` FROM \`sales_project\` AS \`p\`
    WHERE \`p\`.\`enquiry_id\` = \`sales_crm_lead\`.\`enquiry_id\` AND \`p\`.\`deleted_at\` IS NULL
    ORDER BY \`p\`.\`created_at\` DESC LIMIT 1)) AS convertedValue`;

async function listCrmLeadsPage({
  board = "Dum Dum",
  view = "all",
  filters = {},
  sortColumn = "",
  sortDirection = "desc",
  offset = 0,
  limit = 100,
  today = "",
  // Whether to count the whole set as well as return this page. Defaults to true so every existing
  // caller keeps the answer it has always had; the board passes false for a scroll append.
  withTotal = true,
  // The resolved data scope, from the controller; see buildWhere.
  scope = null,
  // The board's "only mine" toggle - see `mineClause`. Threaded everywhere `scope` is, so the
  // rows, the tab counts and a filter's own menu can never describe different sets of leads.
  mine = null,
  // The header's date range, as two inclusive `YYYY-MM-DD` keys; see `dateRangeClauses`.
  dateFrom = "",
  dateTo = "",
  // The board's column totals - see `VALUE_TOTALS_SQL`. Asked only by a board column's first page.
  withValues = false,
}) {
  const { where, params } = buildWhere({ board, view, filters, today, scope, mine, dateFrom, dateTo });

  const orderSql = columnSql(sortColumn, { board, today }) || "`enquiry_id`";
  const direction = String(sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";
  /*
   * The enquiry id breaks every tie. Pages are cut with LIMIT / OFFSET, and leads that share the sort
   * column - a status, a date - come back in whatever order the database likes on each query, so
   * page 2 repeated leads from page 1 and never showed others (32 of 224 on the Status sort). One
   * fixed order means every lead is on exactly one page.
   */
  const order = orderSql === "`enquiry_id`" ? `\`enquiry_id\` ${direction}` : `${orderSql} ${direction}, \`enquiry_id\` ${direction}`;
  const size = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const start = Math.max(Number(offset) || 0, 0);

  // `created_at` is not one of the lead's own text columns, but it is the only record of when
  // a lead actually arrived, so the Added Time column needs it on every page.
  // Each column is aliased back to the name the code reads, so `toRecord` still receives the
  // camelCase keys it expects rather than the database's own snake_case.
  /*
   * `branchId` beside the branch's text, which is what lets the board name a branch the way the
   * register names it.
   *
   * The text is whatever wrote the lead - a CSV saying "Erode" where the branch is "Erode TN" - and
   * Assigned Branch is a picker built from the register, so text alone leaves the popup showing a
   * blank for a lead that is filed perfectly well. The reference has been right since the data-scope
   * backfill, so sending it is all the screen needs to show the right branch, whatever the text
   * says. One integer per row.
   */
  // The branch, CRM and vertical come through their references with the text as fallback, the way
  // every other read of a lead does (`RESOLVED_LEAD_SQL` in crmLeadService).
  const columns = ["enquiryId", ...CRM_LEAD_SQL_COLUMNS, "createdAt", "branchId"].map(leadColumnSql);
  columns.push(...occasionSelectColumns(board, today));
  columns.push(`${PROJECT_DELETED_SQL} AS \`projectDeleted\``);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${columns.join(", ")} FROM \`sales_crm_lead\` WHERE ${where} ORDER BY ${order} LIMIT ${size} OFFSET ${start}`,
    ...params,
  );

  /*
   * How many rows the board holds in total - the number under the table and the ceiling the
   * infinite scroll stops at.
   *
   * Counted only when the caller asks. It is a second pass over everything the WHERE matches, and
   * it cannot change while somebody scrolls: the board is appending pages of a set it has already
   * fixed. Running it per page meant scrolling to the fiftieth page paid for fifty counts of the
   * same 125,000 rows, which is most of what made scrolling feel like it had stopped.
   */
  if (!withTotal) return { rows, total: null };

  const [{ total, estimatedValue, convertedValue }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS total${withValues ? `, ${VALUE_TOTALS_SQL}` : ""} FROM \`sales_crm_lead\` WHERE ${where}`,
    ...params,
  );

  return {
    rows,
    total: Number(total || 0),
    ...(withValues ? { values: { estimated: Number(estimatedValue || 0), converted: Number(convertedValue || 0) } } : {}),
  };
}

// Every id the current board, tab and filters match - not just the page on screen. This is
// what "select all" resolves to when the user acts on it, so a selection can cover leads
// that have not been scrolled into view yet. Only the key column is read, so the payload
// stays small even for a board with tens of thousands of leads.
async function listCrmLeadIds({ board = "Dum Dum", view = "all", filters = {}, today = "", scope = null, mine = null, dateFrom = "", dateTo = "" }) {
  const { where, params } = buildWhere({ board, view, filters, today, scope, mine, dateFrom, dateTo });
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`enquiry_id\` AS \`enquiryId\` FROM \`sales_crm_lead\` WHERE ${where} ORDER BY \`enquiry_id\` ASC`,
    ...params,
  );
  return rows.map((row) => row.enquiryId);
}

// One row of counts for the tab labels, scoped to the board, the range, and - on the open tab
// alone - the column filters.
async function crmLeadTabCounts({ board = "Dum Dum", view: openView = "all", filters = {}, today = "", scope = null, mine = null, dateFrom = "", dateTo = "" }) {
  /*
   * Neither the range nor the column filters go into the base `WHERE`. Both belong inside a tab's
   * own CASE, for the same reason and with the same history.
   *
   * The range was in the base, which applied it to every tab in the pass - including the three that
   * do not carry it. So with a range chosen on All, Incoming read "2" on the strip and showed 6 rows
   * when it was opened: the count had been narrowed and the tab had not.
   *
   * The column filters were in the base too, and that was worse, because no tab escaped it. Typing
   * a name into the Client Name box re-counted the whole strip against that name: All, Converted and
   * Rejected all dropped to what that one person holds, and the strip stopped saying how big the
   * board's tabs are - which is the only question a number beside a tab label is asked. The filter
   * now narrows the tab being read and no other.
   *
   * A tab is counted the way it is read, or the number beside its name is a promise it cannot keep.
   * That promise is what makes the client clear the filters when the tab changes: an unfiltered
   * count on a tab the filter would follow you into is a lie the moment it is clicked.
   */
  const base = buildWhere({ board, view: "all", filters: {}, today, scope, mine });
  const parts = [];
  const params = [];

  for (const view of ["all", "yetToConnect", "unassigned", "pending", "new", "today", "converted", "rejected", "yesterdayPending", "overallPending", "newborns", "birthdays"]) {
    const viewParams = [];
    const viewSql = viewClause(view, today, viewParams, board);
    const rangeClauses = [];
    const rangeParams = [];
    if (viewCarriesDateRange(view)) dateRangeClauses({ dateFrom, dateTo }, rangeClauses, rangeParams);
    // The open tab, and only it. A filter is typed while looking at one tab and says nothing about
    // the others; an unmatched `openView` - the Calls board's tabs, counted in a pass of their own -
    // simply leaves every count here unfiltered.
    const filterClauses = [];
    const filterParams = [];
    if (view === openView) columnFilterClauses({ filters, board, today }, filterClauses, filterParams);
    const clauses = [viewSql, ...rangeClauses, ...filterClauses].filter(Boolean);
    parts.push(`SUM(CASE WHEN ${clauses.length ? clauses.join(" AND ") : "1=1"} THEN 1 ELSE 0 END) AS \`${view}\``);
    // In the order the clauses were joined: the tab's own parameters, then the range's, then the
    // filters'. These are positional `?` in a raw query - the order is the meaning.
    params.push(...viewParams, ...rangeParams, ...filterParams);
  }
  /*
   * CNA is a status count for the pills rather than a tab, so it is counted over the board as the
   * tabs beside it are - narrowed by the range wherever the tabs are, which is to say on the boards'
   * ordinary tabs. It takes the range for the same reason `all` does.
   *
   * It takes no column filter for the reason the *other* tabs take none: it is not the tab being
   * read. There is no CNA tab to open, so nothing here could narrow to match it.
   */
  const cnaRange = [];
  const cnaRangeParams = [];
  dateRangeClauses({ dateFrom, dateTo }, cnaRange, cnaRangeParams);
  parts.push(`SUM(CASE WHEN REPLACE(REPLACE(${statusKeySql(board, today)}, ' ', ''), '-', '') = 'cna'${cnaRange.length ? ` AND ${cnaRange.join(" AND ")}` : ""} THEN 1 ELSE 0 END) AS \`cna\``);
  params.push(...cnaRangeParams);

  const [row] = await prisma.$queryRawUnsafe(
    `SELECT ${parts.join(", ")} FROM \`sales_crm_lead\` WHERE ${base.where}`,
    ...params,
    ...base.params,
  );

  return {
    all: Number(row?.all || 0),
    yetToConnect: Number(row?.yetToConnect || 0),
    unassigned: Number(row?.unassigned || 0),
    pending: Number(row?.pending || 0),
    new: Number(row?.new || 0),
    today: Number(row?.today || 0),
    converted: Number(row?.converted || 0),
    rejected: Number(row?.rejected || 0),
    yesterdayPending: Number(row?.yesterdayPending || 0),
    overallPending: Number(row?.overallPending || 0),
    newborns: Number(row?.newborns || 0),
    birthdays: Number(row?.birthdays || 0),
    cna: Number(row?.cna || 0),
  };
}

/**
 * The values a column actually holds, for the tab being read.
 *
 * What a filter dropdown offers, and it is a different question from what the studio *has*. The
 * pickers used to be the registers themselves - every employee on the Sales roster under CRM, every
 * branch under Assigned Branch, the whole list of shoot types - so a reader working one tab of one
 * vertical was handed a menu mostly made of values no row in front of them holds, and picking one
 * emptied the board. This answers the question a spreadsheet's filter answers: what is *in* this
 * column, here, now.
 *
 * Narrowed by everything the tab is narrowed by - the board, the view, the header's date range, the
 * reader's own data scope - with one deliberate exception: **this column's own filter is left out**.
 * A dropdown narrowed by its own selection would offer one value the moment one was chosen, and
 * there would be no way back to the others without clearing it first. That is the rule every
 * spreadsheet follows, and the reason the filters are passed in rather than being someone else's
 * problem.
 *
 * Capped, and the cap is not a formality: `crm` and `assignedBranch` are a handful of values, but
 * the same endpoint answers for any filterable column, and a free-text one over a whole vertical
 * would otherwise build a menu of thirty thousand names nobody can use. A column with more than the
 * cap is a column somebody should type into instead.
 */
const COLUMN_VALUES_LIMIT = 500;

async function crmLeadColumnValues({
  column,
  board = "Dum Dum",
  view = "all",
  filters = {},
  today = "",
  scope = null,
  // The board's "only mine" toggle - see `mineClause`. Threaded everywhere `scope` is, so the
  // rows, the tab counts and a filter's own menu can never describe different sets of leads.
  mine = null,
  dateFrom = "",
  dateTo = "",
} = {}) {
  // Built from a known column name or not at all - `columnSql` answers null for anything else, and
  // nothing here ever interpolates caller text.
  const valueSql = columnSql(column, { board, today });
  if (!valueSql) return [];

  const others = { ...filters };
  delete others[column];

  const { where, params } = buildWhere({ board, view, filters: others, today, scope, mine, dateFrom, dateTo });
  const rows = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT ${valueSql} AS \`value\`
       FROM \`sales_crm_lead\`
      WHERE ${where}
      ORDER BY \`value\` ASC
      LIMIT ${COLUMN_VALUES_LIMIT}`,
    ...params,
  );

  // Blanks are dropped rather than offered as an empty row: "no value" is what clearing the filter
  // already means, and a menu entry that looks like nothing reads as a rendering fault.
  return rows.map((row) => String(row?.value ?? "").trim()).filter(Boolean);
}

/**
 * How many leads sit at each status, in one vertical.
 *
 * Here rather than in the reports module because the status a lead *reads as* is decided by
 * `statusDisplaySql` above, and that is not the raw column: a lead with no status set reads as
 * "Yet to connect" for as long as it has none, the spellings that arrive from
 * the sheets are folded onto one label, and a Qua Qua lead in its birthday window reads that
 * birthday's status. A dashboard counting the raw column would disagree with the board it is meant
 * to summarise, which is the one thing a dashboard must never do.
 *
 * `today` is the client's day, for the same reason the tabs take one - the studio's date, not the
 * server's timezone.
 */
async function crmLeadStatusCounts({ board = "Dum Dum", today = "", scope = null, mine = null } = {}) {
  const base = buildWhere({ board, view: "all", filters: {}, today, scope, mine });
  const rows = await prisma.$queryRawUnsafe(
    /*
     * The status is worked out in a subquery and grouped in the query around it.
     *
     * It used to be the expression written out twice - once in the SELECT and once in the GROUP BY -
     * because MySQL's `only_full_group_by` refuses to group by an alias standing for a CASE over
     * `status`, `created_date` and `created_at`: it sees the bare columns inside it and calls them
     * non-aggregated. Repeating it satisfied that check, which compares the two expressions.
     *
     * That stopped working the moment the status could come from a birthday, because the expression
     * now contains a correlated subquery and MySQL never treats two of those as the same expression
     * however identically they are written - so grouping was rejected outright (error 1055) on the
     * one board that has birthdays. Deriving the column first and grouping on a plain name is what
     * the mode is asking for either way, and it evaluates the whole thing once per row rather than
     * twice.
     */
    `SELECT \`status\`, COUNT(*) AS \`leads\` FROM (
       SELECT ${statusDisplaySql(board, today)} AS \`status\`
         FROM \`sales_crm_lead\` WHERE ${base.where}
     ) AS \`resolved\` GROUP BY \`status\` ORDER BY \`leads\` DESC`,
    ...base.params,
  );
  return rows.map((row) => ({ status: String(row.status || "").trim() || "Unknown", leads: Number(row.leads) || 0 }));
}

// `BOARD_SQL` is exported for the tests alone: the four boards have to be a clean split - every
// lead on exactly one of them - and that is a property of the clauses rather than of any one query.
// `BOARD_SQL_SOURCE` and `BOARD_KEY` are exported for the tests: the four boards have to be a
// clean split - every lead on exactly one - and the `board_key` column the queries now use has to
// mean the same thing those clauses do. Neither is a property of any one query, and if the column
// and the prose ever diverge leads sit on the wrong board with nothing on screen to say so.
module.exports = { listCrmLeadsPage, listCrmLeadIds, crmLeadTabCounts, crmLeadColumnValues, crmLeadStatusCounts, VERTICAL_SQL, BOARD_SQL, BOARD_SQL_SOURCE, BOARD_KEY };
