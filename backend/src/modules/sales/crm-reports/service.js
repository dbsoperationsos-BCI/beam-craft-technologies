const prisma = require("../../../config/db");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
// `numberKey` is the CRM's one rule for "the same phone": the last ten digits. Imported rather than
// restated because `EMPLOYEE_KEY_SQL` below is its mirror in SQL, and the two must agree.
const { ensureCallLogTable, ensureCallIds, numberKey } = require("../crm-leads/callLogService");
const { buildWhere, buildUsageWhere, dayStart, dayEnd, DURATION_BANDS, CALL_TYPES, CALL_METHODS, VERTICALS } = require("./filters");
const { studioDaySql } = require("../../../services/studioDay");
const { measuredTotals } = require("./signedIn");
// Who counts as working here, from HR's own read service rather than restated - so the Employee
// filter offers exactly the people the Employee Repository's Active tab lists. See
// `repositoryEmployees`.
const { WORKING_STATUSES } = require("../../hrm/employees/read.service");

/**
 * The CRM's lead reports, read from the calls this server already stores.
 *
 * Six views of one table. `sales_crm_call_log` holds every call Callyzer has delivered - who rang
 * whom, when, for how long, on which lead - and `sales_crm_lead` says which vertical that lead
 * belongs to and where it got to. That is everything these reports need, so they are answered here
 * rather than by asking Callyzer for its own.
 *
 * That is a deliberate choice and worth stating. `src/modules/sales/callyzer-api/` proxies
 * Callyzer's report endpoints and needs an AccessKey this studio has not issued; until it does,
 * every one of those reports answers "not configured". These read the studio's own data, so they
 * work today, they agree with the CRM's own screens because they read the same rows, and they can
 * say things Callyzer cannot - which vertical a call belonged to, and which lead it is against.
 *
 * Every report is a `SELECT` and nothing here writes. Missing tables answer with an empty report
 * rather than throwing: a CRM that has never received a delivery still opens its Reports page.
 */

/*
 * The employee a handset was matched to, when the call was delivered.
 *
 * `matched_employee_id` is written by the webhook - Callyzer's Employee Code against the
 * repository's own code first, the handset's label second - so the name a report shows is read from
 * the repository through this join rather than matched here. A handset relabelled in the Callyzer
 * app, or an employee renamed in the repository, therefore changes nothing about which row a call
 * is on and everything about the spelling it reads under, which is the right way round.
 *
 * LEFT, because a handset belonging to nobody is still a call. Its name then falls back to the
 * label Callyzer gave it - see `staffCallSql`.
 */
const EMPLOYEE_JOIN = " LEFT JOIN `employee` AS `e` ON `e`.`id` = `c`.`matched_employee_id`";

const CALL_LOG = "`sales_crm_call_log` AS `c` LEFT JOIN `sales_crm_lead` AS `l`"
  + " ON `l`.`enquiry_id` = `c`.`enquiry_id` AND `l`.`deleted_at` IS NULL"
  + EMPLOYEE_JOIN;

// A row's worth of numbers, so a count that comes back as a BigInt or a string is a number by the
// time it reaches JSON. `COUNT(*)` through Prisma's raw query is a BigInt, which JSON.stringify
// refuses outright - a report that threw "Do not know how to serialize a BigInt" on every request.
function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowNumbers(row = {}, keys = []) {
  const out = { ...row };
  for (const key of keys) out[key] = num(out[key]);
  return out;
}

/** Seconds as "4m 12s", which is how a call is talked about. */
function duration(seconds) {
  const total = Math.max(0, Math.round(num(seconds)));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

async function ready() {
  try {
    /*
     * `ensureCallIds` rather than the table alone, because these reports now read a call through
     * `matched_employee_id` and that column is filled in by the same cached, once-per-process pass
     * that mints the Call IDs. Opening Reports on a database whose calls predate the match - which
     * is every database the day this deploys - would otherwise show empty tables until somebody
     * happened to open the Calls board first.
     *
     * It creates the table on the way, so nothing is lost by asking for the whole chain.
     */
    await ensureCallIds();
    return true;
  } catch (error) {
    console.warn("Unable to prepare the CRM call log table for reports:", error?.message || error);
    return false;
  }
}

async function query(sql, params) {
  return prisma.$queryRawUnsafe(sql, ...params);
}

/**
 * The people the Employee filter offers: the studio's own staff, from the Employee Repository.
 *
 * **Not** the names Callyzer delivers. This list used to be `SELECT DISTINCT employee_name FROM
 * sales_crm_call_log` - whoever the call box had ever reported - which is a list nobody maintains
 * and nobody can correct. A misspelling on one handset became a permanent entry in a dropdown
 * ("Another Employee" and "Another Emplyoee" sat next to each other), a client's name recorded
 * against an outgoing call became an "employee", and somebody who left the studio years ago stayed
 * on the list forever. There is nowhere to fix any of that, because the source is a call record.
 *
 * The repository is the studio's own answer to "who works here", it is maintained on a screen built
 * for it, and a name corrected there is corrected here.
 *
 * `numbers` is what makes the filter still land. Callyzer keys a call on the handset, and its
 * `employee_name` is whatever that handset was labelled - so matching the repository's spelling
 * alone would answer "no calls" for somebody who has made hundreds. Each option carries the
 * repository's own contact number beside the name, and `buildWhere` matches either; see
 * `resolveEmployeeFilter` below, which is what turns the chosen name into the pair.
 */
async function reportOptions(scope = null) {
  if (!await ready()) return { employees: await repositoryEmployees(scope), verticals: VERTICALS, callTypes: CALL_TYPES, callMethods: CALL_METHODS, durations: [] };

  const employees = await repositoryEmployees(scope);

  /*
   * The usage reports need their own list, because they are about different people.
   *
   * `employees` above is the studio's staff as the Employee Repository records them, and a call
   * report is about the handset one of them rang from. The usage reports are about whoever did
   * something in *this system* - a login - and an account is not always an employee, nor an
   * employee always an account. Offering one list on the other's tabs would mean picking a name
   * that filters them to nothing, which reads as "this person has never used WhatsApp" rather than
   * "you are filtering on the wrong kind of name".
   */
  const users = await usageNames(scope);

  return {
    employees,
    users,
    verticals: VERTICALS,
    callTypes: CALL_TYPES,
    callMethods: CALL_METHODS,
    durations: Object.entries(DURATION_BANDS).map(([value, band]) => ({ value, label: band.label })),
  };
}

/**
 * The studio's staff, as the Employee Repository records them.
 *
 * ── Who is on the list ────────────────────────────────────────────────────────────────────────
 *
 * The people working here now: `WORKING_STATUSES` - Active, in Training, PIP - and not archived.
 * That is the same definition of "an employee" every other picker in the application uses, and it
 * is the one the HR screen's own Active tab is cut from, so the report filter and the repository
 * cannot disagree about who works here.
 *
 * It used to be every row in the table, on the reasoning that a report reads the past and somebody
 * who has since left made the calls they made. That is true and it was the wrong trade. The table
 * holds a row from the moment HR sends an onboarding invite, so the dropdown was offering people
 * who had not filled their form in yet, half-finished test rows, and everyone who has ever left -
 * and the studio has to scroll past all of them to find whoever they are actually reporting on. A
 * name that has left is still answerable: it can be typed, and `resolveEmployeeFilter` below
 * resolves any name the repository holds, offered or not.
 *
 * Ordered by name because that is how the dropdown reads, and de-duplicated on the name because the
 * filter matches on it: two people recorded under one spelling would otherwise be two options that
 * do exactly the same thing. The number kept for a name is the first one the repository holds for
 * it, which for a duplicate name is as good an answer as there is.
 *
 * A repository nobody has filled in yet answers with an empty list, and the filter bar then offers
 * "All employees" and nothing else - which is the honest state of a studio that has added no
 * employees, and better than the call box's guesses at who they might be.
 */
const ACTIVE_STATUS = "Active";

/**
 * The employees this reader may be shown, as a Prisma `where`.
 *
 * The same rule the rest of the application narrows records by (DATA-SCOPE.md), asked about *people*
 * rather than about rows: yourself, anybody who reports to you at any depth, and - for a branch
 * administrator - everybody in the branches that role reaches. A Super Admin is narrowed by nothing.
 *
 * It decides two things that must agree: which names the Employee filter offers, and whose calls the
 * reports attribute to a person at all. Offering a name whose rows the report would then refuse to
 * show is worse than not offering it - the reader picks it, sees an empty table, and concludes the
 * person did no work.
 *
 * A login named on nothing - no employee record, no team, no branch administration - is shown
 * nobody. That is the honest answer for somebody who is on no employee row: the reports are about
 * the studio's people, and this reader is not one of them as far as the repository is concerned.
 */
function visibleEmployeeWhere(scope) {
  if (!scope || scope.unlimited) return {};
  const limbs = [];
  if (scope.employeeIds?.length) limbs.push({ id: { in: scope.employeeIds } });
  if (scope.administersBranches && scope.branchIds?.length) limbs.push({ branchId: { in: scope.branchIds } });
  if (!limbs.length) return { id: { in: [] } };
  return limbs.length === 1 ? limbs[0] : { OR: limbs };
}

async function repositoryEmployees(scope = null) {
  const rows = await prisma.employee.findMany({
    /*
     * **Active alone**, which is narrower than every other picker in the application - those offer
     * the three working statuses together, Active, in Training and PIP (D23). The studio asked for
     * this one to list the people actually working now and nobody else: a report is read to judge
     * somebody's week, and a name that is still onboarding or on a plan is not a week anybody is
     * judging yet.
     *
     * A name that has left, or is not offered, can still be typed: `resolveEmployeeFilter` resolves
     * any name the repository holds, offered or not - subject to the same scope as everything else.
     */
    where: { archivedAt: null, employmentStatus: ACTIVE_STATUS, ...visibleEmployeeWhere(scope) },
    select: { employeeName: true, contactNumber: true },
    orderBy: { employeeName: "asc" },
  });

  const byName = new Map();
  for (const row of rows) {
    const name = String(row.employeeName || "").trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, { value: name, label: name, number: String(row.contactNumber || "").trim() });
  }
  return [...byName.values()];
}

/*
 * ── Who a call may be attributed to ───────────────────────────────────────────────────────────
 *
 * The reports that list **people** - Employee Analysis, Work Hours, the call half of WhatsApp Usage
 * - group the call log by `employee_name`, which is whatever the handset that made the call was
 * labelled in the Callyzer app. That is not a list of the studio's employees and it never was: it
 * held "Manjula DBS" beside "Manjula Donkena" and "Deploy Check" beside both, one row per label
 * anybody had ever typed into a phone, with nowhere to correct any of it.
 *
 * A person on these reports is somebody in the **Employee Repository**, at the working statuses -
 * the same list the Employee filter offers, so the filter and the table name the same people. A call
 * from a handset that belongs to nobody there is not attributed to anyone, so it is on no person's
 * row.
 *
 * ── Matched two ways, and labelled by the repository ──
 *
 * By the repository's **contact number** first, because that is the reliable key: Callyzer records
 * the handset's number, and it does not change when somebody renames the phone. So a handset
 * labelled "Manjula DBS" whose number is in the repository is that person's calls, and the row is
 * shown under the repository's spelling rather than the label - one person, one row, named the way
 * the studio names them.
 *
 * By **name** second, for a handset whose number the repository does not hold, which is the common
 * case for a studio that has not filled in every contact number. Matching on the name alone was
 * never enough - `resolveEmployeeFilter` below exists because of it - but as the fallback it costs
 * nothing and rescues the rows a number match would have dropped.
 *
 * The **call** reports (Summary, Lead Analysis, Never Attended, Not Picked Up, Call History) are
 * untouched. They count calls and clients rather than people, and dropping a call from them because
 * of who was holding the phone would make their totals disagree with the CRM's own call history.
 */

/** `numberKey` in SQL, over the call log's employee number. Mirrors the JavaScript exactly. */
const EMPLOYEE_KEY_SQL = "RIGHT(REGEXP_REPLACE(COALESCE(`c`.`employee_number`, ''), '[^0-9]', ''), 10)";

/** The call log's employee name, trimmed - the fallback label and the second way in. */
const EMPLOYEE_NAME_SQL = "TRIM(COALESCE(`c`.`employee_name`, ''))";

/**
 * The studio's staff, as the two things a call carries: their numbers and their names.
 *
 * Read once per report rather than joined in SQL. The repository is tens of rows against a call log
 * of hundreds of thousands, so this is a list to compare against rather than a table to join - and
 * it keeps the number → name mapping in one place, where both the label and the test can read it.
 */
async function staffIdentity(scope = null) {
  const rows = await prisma.employee.findMany({
    /*
     * The working statuses here, not Active alone: these are the people a *call* may be attributed
     * to, and somebody in training who spent the week on the phone made those calls. The filter's
     * own list is narrower on purpose - see `repositoryEmployees` - because choosing a name and
     * reading a row are different questions.
     *
     * Narrowed by `scope` for the same reason the filter is: a reader sees their own work and their
     * team's, so a call made by somebody they do not manage is on nobody's row for them.
     */
    where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() }, ...visibleEmployeeWhere(scope) },
    select: { id: true, employeeName: true, contactNumber: true },
    orderBy: { employeeName: "asc" },
  });

  const names = [];
  const seen = new Set();
  const byNumber = new Map();
  for (const row of rows) {
    const name = String(row.employeeName || "").trim();
    if (!name) continue;
    if (!seen.has(name)) { seen.add(name); names.push(name); }
    // The first name a number is held under wins, the same tie-break `repositoryEmployees` makes.
    const key = numberKey(row.contactNumber);
    if (key && !byNumber.has(key)) byNumber.set(key, name);
  }
  /*
   * Whether this reader is narrowed at all - the same test `visibleEmployeeWhere` makes, kept
   * beside the lists it produced so the two cannot drift apart. It is what decides whether a
   * handset belonging to nobody in the repository is shown; see `staffCallSql`.
   */
  /*
   * The ids, which is what a call is kept by now that the match is made at delivery rather than
   * here. `names` and `byNumber` remain for the Employee filter, which is still a name on a URL.
   */
  return { names, byNumber, ids: rows.map((row) => row.id), unlimited: !scope || Boolean(scope.unlimited) };
}

/**
 * That identity as SQL: the label to group by, and the test that keeps a call.
 *
 * Returns the two halves with their own parameters, because they land in different parts of a
 * statement - `nameExpr` in the SELECT and `where` in the WHERE - and MySQL binds by position, so a
 * caller has to be able to put each one's values where its placeholders are.
 *
 * A studio with nobody in the repository gets `1 = 0`: no call is attributable to anyone, so these
 * reports are empty. That is the honest answer, and it is the same one the Employee filter gives by
 * offering nothing - better than listing the call box's labels as if they were staff.
 *
 * `unlimited` says the reader is narrowed by nothing, and it is what lets a handset the repository
 * does not hold appear under its own label rather than be dropped. See the note on `where` below
 * for why that is offered to an unlimited reader and to nobody else.
 */
function staffCallSql({ ids, unlimited = false }) {
  /*
   * The name, read from the repository through the match the webhook already made.
   *
   * It used to be a CASE with a branch per employee number, bound per query - the report deciding
   * whose call this was, every time it was run, from the handset's own label. The decision is made
   * once now, at delivery, against Callyzer's Employee Code and then the label; this only reads it.
   * So it binds nothing, and a person renamed in the repository is renamed on every report at once,
   * including on the calls they made before.
   *
   * `COALESCE` to the handset's own label for a call matched to nobody - the join is LEFT, so
   * `e`.`employee_name` is NULL there, and Callyzer's name is the only name such a call has.
   */
  const nameExpr = `COALESCE(NULLIF(TRIM(\`e\`.\`employee_name\`), ''), ${EMPLOYEE_NAME_SQL})`;

  /*
   * And the test: the calls belonging to somebody this reader may see.
   *
   * By id rather than by name or number. A name is what a handset happens to be labelled and a
   * number is the company SIM - which the repository does not hold at all, so that half of the old
   * test could never match. The id is the answer the webhook worked out and wrote down.
   */
  const attributable = ids.length
    ? `\`c\`.\`matched_employee_id\` IN (${ids.map(() => "?").join(", ")})`
    : "1 = 0";

  /*
   * A handset matched to nobody, for the reader who is narrowed by nothing.
   *
   * Its calls used to be on no row at all, so a phone Callyzer names but the repository cannot place
   * simply did not appear, and the studio's own totals were short by however many calls it had made.
   * `nameExpr` above already falls back to the handset's label, so such a call has always had a name
   * to sit under; it was this test that dropped it before the label was ever reached.
   *
   * Only for an unlimited reader, and that is the whole of the restriction. `ids` is already
   * narrowed to the people this reader may see, so it does two jobs at once: naming the studio's
   * staff, and keeping one branch's calls off another branch's report. Relaxing it for a narrowed
   * reader would undo the second - and a call matched to nobody is in no branch and on no team, so
   * there is nothing to narrow it by and no honest way to decide whose it is.
   *
   * Not when the repository is empty, which stays `1 = 0`: nothing is matched then, so this would
   * put back the whole of the old behaviour - a row per label anybody had ever typed into a phone -
   * for a studio that has simply not added its employees yet.
   *
   * Named handsets only. A call matched to nobody and carrying no label would otherwise be grouped
   * under the empty string, which is a row headed by nothing.
   */
  const where = unlimited && ids.length
    ? `(${attributable} OR (\`c\`.\`matched_employee_id\` IS NULL AND ${EMPLOYEE_NAME_SQL} <> ''))`
    : attributable;

  // `nameParams` is kept, and empty: the callers interleave it with their own bindings by position,
  // and an expression that binds nothing is still one of the two halves they assemble.
  return { nameExpr, nameParams: [], where, whereParams: [...ids] };
}

/** The label and the test together, for the reports that list people. */
const staffCalls = async (scope = null) => staffCallSql(await staffIdentity(scope));

/**
 * The chosen employee, as the two things a call could have been logged under.
 *
 * The filter bar sends a name, because a name is what it shows. Callyzer logs a call against the
 * handset, and the `employee_name` on that row is whatever the handset was labelled - which is the
 * studio's spelling on a good day and something else on any other. So the name alone is not enough
 * to find somebody's calls, and the repository's contact number is added beside it.
 *
 * A value that matches no employee is passed through untouched: it is either a number somebody
 * typed, or a name from a saved link, and neither should stop being answerable because the
 * repository has changed since.
 */
async function resolveEmployeeFilter(filters = {}, scope = null) {
  /*
   * Whatever arrived under this name is dropped first. It is derived here from the repository, so a
   * caller putting `?employeeNumbers=` on the URL must not be able to hand the WHERE clause numbers
   * of its own - it grants nothing (the same rows are reachable by filtering on the number itself)
   * but a field the server owns should be written only by the server.
   */
  const { employeeNumbers: _ignoredNumbers, employeeIds: _ignoredIds, ...rest } = filters;
  // A list now, however the query string wrote it - see `employeeList` in `filters.js`.
  const chosen = Array.isArray(rest.employee)
    ? rest.employee.map((value) => String(value || "").trim()).filter(Boolean)
    : [String(rest.employee || "").trim()].filter(Boolean);
  if (!chosen.length) return rest;

  /*
   * And only somebody this reader may be shown.
   *
   * The dropdown offers their own people, but the filter is a name on a query string and a name can
   * be typed. Resolved without this, a colleague's name still found that colleague's handset number
   * and filtered the call reports by it - the rows would be narrowed to leads the reader may see,
   * but the question "how did *they* do last week" is not one this screen should answer about
   * somebody else's team. A name outside the scope resolves to no number, which leaves the filter as
   * the plain name it was: it then matches only where the handset happens to be labelled that way
   * and the rows are the reader's own anyway.
   */
  const employees = await prisma.employee.findMany({
    where: { employeeName: { in: chosen }, ...visibleEmployeeWhere(scope) },
    select: { id: true, contactNumber: true },
  });
  /*
   * The ids first, because that is what a call actually carries.
   *
   * The filter bar sends a name - the repository's own spelling - and the call log holds whatever
   * the handset is labelled in the Callyzer app, which is a different string whenever somebody has
   * set an Employee Code and named the phone something else. So choosing a person answered "no
   * calls" for somebody who had made hundreds. `matched_employee_id` is the answer the webhook
   * worked out at delivery, and filtering on it is filtering on the same thing the reports now
   * group by.
   *
   * The numbers are kept beside them and are nearly always empty: they are the repository's
   * *contact* number, and the handset reports the company SIM, so the two only meet where somebody
   * happens to be logged under their own phone.
   */
  const ids = [...new Set(employees.map((employee) => employee?.id).filter(Boolean))];
  // One query for the whole list rather than one per name: they are all matched by the same `IN`,
  // so resolving them individually would be several round trips for one clause.
  const numbers = [...new Set(employees.map((employee) => String(employee?.contactNumber || "").trim()).filter(Boolean))];
  if (!ids.length && !numbers.length) return rest;
  return { ...rest, ...(ids.length ? { employeeIds: ids } : {}), ...(numbers.length ? { employeeNumbers: numbers } : {}) };
}

/**
 * Everyone who has done something in this system, from both places that record it.
 *
 * Names, because that is what the usage reports group by - an activity row written before the actor
 * was linked has a name and no id, and that is the same person's work. Missing tables answer with
 * nothing rather than throwing: neither is created by a migration.
 */
async function usageNames(scope = null) {
  const names = new Set();
  // Narrowed exactly as the reports are, so every name offered is one whose rows the reader will
  // actually be shown - see `visibleEmployeeWhere` for why an option that answers nothing is worse
  // than no option at all.
  const activity = scope
    ? scope.sql({ user: "`a`.`actor_user_id`", branch: "`u`.`branch_id`" })
    : { clause: "1=1", params: [] };
  const messages = scope
    ? scope.sql({ user: "`m`.`userId`", branch: "`u`.`branch_id`" })
    : { clause: "1=1", params: [] };
  for (const [sql, params] of [
    [`SELECT DISTINCT ${ACTOR_NAME} AS \`name\`
       FROM \`sales_crm_lead_activity\` AS \`a\`
       LEFT JOIN \`user\` AS \`u\` ON \`u\`.\`id\` = \`a\`.\`actor_user_id\`
      WHERE ${activity.clause}`, activity.params],
    ["SELECT DISTINCT COALESCE(NULLIF(TRIM(`u`.`name`), ''), 'Unknown') AS `name`"
    + " FROM `SalesCrmWhatsAppMessage` AS `m` LEFT JOIN `user` AS `u` ON `u`.`id` = `m`.`userId`"
    + ` WHERE ${messages.clause}`, messages.params],
  ]) {
    try {
      for (const row of await query(sql, params)) {
        const name = String(row.name || "").trim();
        if (name && name !== "Unknown") names.add(name);
      }
    } catch (error) {
      console.warn("Unable to read the usage names:", error?.message || error);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
}

/**
 * The headline numbers for the range.
 *
 * "Unique clients" counts numbers rather than rows, which is the figure that answers "how many
 * people did we speak to" - three calls to one client is one client. Connected means the call
 * carried some audio: a zero-second call is one that rang and was not answered, whatever its type
 * says, and counting it as a conversation is what made every earlier tally look better than the day
 * actually was.
 */
async function summary(filters, scope = null) {
  if (!await ready()) return { totals: {}, byType: [], rows: [] };
  const { sql, params, filters: clean } = buildWhere(filters, scope);

  const [totals] = await query(
    `SELECT COUNT(*) AS \`calls\`,
            COUNT(DISTINCT \`c\`.\`client_number\`) AS \`clients\`,
            COUNT(DISTINCT \`c\`.\`enquiry_id\`) AS \`leads\`,
            COUNT(DISTINCT \`c\`.\`employee_number\`) AS \`employees\`,
            SUM(CASE WHEN \`c\`.\`duration_seconds\` > 0 THEN 1 ELSE 0 END) AS \`connected\`,
            SUM(CASE WHEN \`c\`.\`duration_seconds\` = 0 THEN 1 ELSE 0 END) AS \`notConnected\`,
            COALESCE(SUM(\`c\`.\`duration_seconds\`), 0) AS \`totalSeconds\`,
            COALESCE(ROUND(AVG(NULLIF(\`c\`.\`duration_seconds\`, 0))), 0) AS \`averageSeconds\`
       FROM ${CALL_LOG} ${sql}`,
    params,
  );

  const byType = await query(
    `SELECT COALESCE(NULLIF(TRIM(\`c\`.\`call_type\`), ''), 'Unknown') AS \`callType\`,
            COUNT(*) AS \`calls\`,
            COALESCE(SUM(\`c\`.\`duration_seconds\`), 0) AS \`totalSeconds\`
       FROM ${CALL_LOG} ${sql}
      GROUP BY \`callType\` ORDER BY \`calls\` DESC`,
    params,
  );

  // One row a day, so the page can show the shape of the range rather than one number for all of it.
  const byDay = await query(
    `SELECT ${studioDaySql("\`c\`.\`called_at\`")} AS \`day\`,
            COUNT(*) AS \`calls\`,
            COUNT(DISTINCT \`c\`.\`client_number\`) AS \`clients\`,
            SUM(CASE WHEN \`c\`.\`duration_seconds\` > 0 THEN 1 ELSE 0 END) AS \`connected\`,
            SUM(CASE WHEN \`c\`.\`duration_seconds\` = 0 THEN 1 ELSE 0 END) AS \`notConnected\`,
            COALESCE(SUM(\`c\`.\`duration_seconds\`), 0) AS \`totalSeconds\`,
            COALESCE(ROUND(AVG(NULLIF(\`c\`.\`duration_seconds\`, 0))), 0) AS \`averageSeconds\`
       FROM ${CALL_LOG} ${sql}
      GROUP BY \`day\` ORDER BY \`day\` DESC`,
    params,
  );

  const counted = rowNumbers(totals, ["calls", "clients", "leads", "employees", "connected", "notConnected", "totalSeconds", "averageSeconds"]);
  return {
    filters: clean,
    totals: {
      ...counted,
      totalDuration: duration(counted.totalSeconds),
      averageDuration: duration(counted.averageSeconds),
    },
    byType: byType.map((row) => ({ ...rowNumbers(row, ["calls", "totalSeconds"]), totalDuration: duration(row.totalSeconds) })),
    /*
     * Named `rows` like every other report, because the Summary is a table like every other report.
     *
     * It answered with `byDay` and nothing called `rows`, so the page rendered an empty table under
     * a row of figures that said there were nine calls. One name for "the rows of this report" is
     * what stops a report being right and blank at the same time.
     */
    rows: byDay.map((row) => ({
      ...rowNumbers(row, ["calls", "clients", "connected", "notConnected", "totalSeconds", "averageSeconds"]),
      day: row.day ? new Date(row.day).toISOString().slice(0, 10) : "",
      totalDuration: duration(row.totalSeconds),
      averageDuration: duration(row.averageSeconds),
    })),
  };
}

/**
 * One row per member of staff: how much calling they did, and how much of it connected.
 *
 * Grouped by the name, and by the number only for calls that carry no name - the same identity the
 * filter bar's employee list uses, so picking somebody from it lands on exactly one row. Grouped by
 * name *and* number it did not: Callyzer masks the number on some deliveries, so one person's calls
 * split into a numbered row and an unnumbered one and neither showed what they had actually done.
 */
async function employeeAnalysis(filters, scope = null) {
  if (!await ready()) return { rows: [] };
  const { sql, params, filters: clean } = buildWhere(filters, scope);
  /*
   * The people this table may have a row for, and the name each one reads under. Both halves are
   * needed here: `nameExpr` is what the rows are grouped by, so two handsets belonging to one
   * employee are one row rather than two, and the counts on it - including `COUNT(DISTINCT
   * client_number)` - are that person's rather than that handset's.
   */
  const staff = await staffCalls(scope);
  const rows = await query(
    `SELECT ${staff.nameExpr} AS \`employee\`,
            COALESCE(MAX(NULLIF(TRIM(\`c\`.\`employee_number\`), '')), '') AS \`employeeNumber\`,
            COUNT(*) AS \`calls\`,
            COUNT(DISTINCT \`c\`.\`client_number\`) AS \`clients\`,
            SUM(CASE WHEN \`c\`.\`duration_seconds\` > 0 THEN 1 ELSE 0 END) AS \`connected\`,
            SUM(CASE WHEN \`c\`.\`duration_seconds\` = 0 THEN 1 ELSE 0 END) AS \`notConnected\`,
            COALESCE(SUM(\`c\`.\`duration_seconds\`), 0) AS \`totalSeconds\`,
            COALESCE(ROUND(AVG(NULLIF(\`c\`.\`duration_seconds\`, 0))), 0) AS \`averageSeconds\`,
            MAX(\`c\`.\`called_at\`) AS \`lastCalledAt\`
       FROM ${CALL_LOG} ${sql} AND ${staff.where}
      GROUP BY \`employee\`
      ORDER BY \`calls\` DESC, \`employee\` ASC`,
    // Bound in the order the placeholders appear: the SELECT's CASE, then the WHERE, then the test
    // appended to it.
    [...staff.nameParams, ...params, ...staff.whereParams],
  );
  return {
    filters: clean,
    rows: rows.map((row) => ({
      ...rowNumbers(row, ["calls", "clients", "connected", "notConnected", "totalSeconds", "averageSeconds"]),
      totalDuration: duration(row.totalSeconds),
      averageDuration: duration(row.averageSeconds),
      lastCalledAt: row.lastCalledAt ? new Date(row.lastCalledAt).toISOString() : null,
    })),
  };
}

/**
 * One row per client, against the lead they belong to.
 *
 * Grouped by the number rather than by the lead id, so a client whose calls landed on more than one
 * record - which the CRM could produce before a delivery matched on either of a lead's two numbers -
 * still reads as one person here.
 */
async function leadAnalysis(filters, scope = null) {
  if (!await ready()) return { rows: [] };
  const { sql, params, filters: clean } = buildWhere(filters, scope);
  const rows = await query(
    `SELECT COALESCE(\`c\`.\`client_number\`, '') AS \`clientNumber\`,
            COALESCE(MAX(\`l\`.\`name\`), MAX(\`c\`.\`client_name\`), '') AS \`client\`,
            MAX(\`c\`.\`enquiry_id\`) AS \`enquiryId\`,
            COALESCE(MAX(\`l\`.\`vertical\`), '') AS \`vertical\`,
            COALESCE(MAX(\`l\`.\`status\`), '') AS \`status\`,
            COALESCE(MAX(COALESCE((SELECT \`e\`.\`employee_name\` FROM \`employee\` AS \`e\` WHERE \`e\`.\`id\` = \`l\`.\`owner_employee_id\`), \`l\`.\`crm\`)), '') AS \`crm\`,
            COUNT(*) AS \`calls\`,
            SUM(CASE WHEN \`c\`.\`duration_seconds\` > 0 THEN 1 ELSE 0 END) AS \`connected\`,
            COALESCE(SUM(\`c\`.\`duration_seconds\`), 0) AS \`totalSeconds\`,
            MIN(\`c\`.\`called_at\`) AS \`firstCalledAt\`,
            MAX(\`c\`.\`called_at\`) AS \`lastCalledAt\`
       FROM ${CALL_LOG} ${sql}
      GROUP BY \`clientNumber\`
      ORDER BY \`calls\` DESC, \`lastCalledAt\` DESC`,
    params,
  );
  return {
    filters: clean,
    rows: rows.map((row) => ({
      ...rowNumbers(row, ["calls", "connected", "totalSeconds"]),
      // Blank is Dum Dum on the CRM's own tabs, so it is named here rather than left empty.
      vertical: String(row.vertical || "").trim() || "Dum Dum",
      totalDuration: duration(row.totalSeconds),
      firstCalledAt: row.firstCalledAt ? new Date(row.firstCalledAt).toISOString() : null,
      lastCalledAt: row.lastCalledAt ? new Date(row.lastCalledAt).toISOString() : null,
    })),
  };
}

/**
 * Clients whose calls have never once connected, and clients who have not picked up.
 *
 * Two questions that look alike and are not. "Never attended" is about the studio: somebody rang in
 * and nobody here ever got to them. "Not picked up" is the other direction: the studio rang and the
 * client did not answer. Both are lists of people worth ringing again, which is the only reason to
 * run either.
 *
 * A client appears only when *every* call in the range failed that way - one connected call means
 * the conversation happened and the lead is not waiting on anybody.
 */
function unansweredReport({ direction, having }) {
  return async function run(filters, scope = null) {
    if (!await ready()) return { rows: [] };
    const { sql, params, filters: clean } = buildWhere(filters, scope);
    const rows = await query(
      `SELECT COALESCE(\`c\`.\`client_number\`, '') AS \`clientNumber\`,
              COALESCE(MAX(\`l\`.\`name\`), MAX(\`c\`.\`client_name\`), '') AS \`client\`,
              MAX(\`c\`.\`enquiry_id\`) AS \`enquiryId\`,
              COALESCE(MAX(\`l\`.\`vertical\`), '') AS \`vertical\`,
              COALESCE(MAX(\`l\`.\`status\`), '') AS \`status\`,
              // Read through the match like Call History below it; the fallback is Callyzer's label.
              COALESCE(MAX(COALESCE(NULLIF(TRIM(\`e\`.\`employee_name\`), ''), \`c\`.\`employee_name\`)), '') AS \`employee\`,
              COUNT(*) AS \`attempts\`,
              MAX(\`c\`.\`called_at\`) AS \`lastCalledAt\`
         FROM ${CALL_LOG} ${sql}
          AND ${direction}
        GROUP BY \`clientNumber\`
        HAVING ${having}
        ORDER BY \`attempts\` DESC, \`lastCalledAt\` DESC`,
      params,
    );
    return {
      filters: clean,
      rows: rows.map((row) => ({
        ...rowNumbers(row, ["attempts"]),
        vertical: String(row.vertical || "").trim() || "Dum Dum",
        lastCalledAt: row.lastCalledAt ? new Date(row.lastCalledAt).toISOString() : null,
      })),
    };
  };
}

// Rang in, or tried to; nobody here ever answered one of them.
const neverAttended = unansweredReport({
  direction: "`c`.`call_type` IN ('Incoming', 'Missed', 'Rejected')",
  having: "MAX(`c`.`duration_seconds`) = 0",
});

// The studio rang out and the client never picked up.
const notPickedUp = unansweredReport({
  direction: "`c`.`call_type` = 'Outgoing'",
  having: "MAX(`c`.`duration_seconds`) = 0",
});

/**
 * The calls themselves, newest first.
 *
 * Capped rather than paged: a report is read on screen and exported whole, and a range that returns
 * more than this wants narrowing rather than scrolling. The cap is reported alongside the rows so
 * the page can say it has been reached instead of quietly showing part of an answer.
 */
const HISTORY_LIMIT = 1000;

async function callHistory(filters, scope = null) {
  if (!await ready()) return { rows: [], limit: HISTORY_LIMIT, capped: false };
  const { sql, params, filters: clean } = buildWhere(filters, scope);
  const rows = await query(
    `SELECT \`c\`.\`id\`,
            \`c\`.\`enquiry_id\` AS \`enquiryId\`,
            COALESCE(NULLIF(TRIM(\`l\`.\`name\`), ''), \`c\`.\`client_name\`, '') AS \`client\`,
            COALESCE(\`c\`.\`client_number\`, '') AS \`clientNumber\`,
            /*
             * The repository's own spelling, through the match the webhook made, and Callyzer's
             * label where it made none - the same shape as \`client\` two lines above, which reads
             * the lead's name and falls back to what the call carried. This showed the handset's
             * label alone, so a phone named anything but its owner read as somebody who is not in
             * the repository, and the Employee filter - which offers the repository's spelling -
             * found none of those calls.
             */
            COALESCE(NULLIF(TRIM(\`e\`.\`employee_name\`), ''), \`c\`.\`employee_name\`, '') AS \`employee\`,
            COALESCE(\`c\`.\`call_type\`, '') AS \`callType\`,
            COALESCE(\`c\`.\`call_method\`, '') AS \`callMethod\`,
            \`c\`.\`duration_seconds\` AS \`durationSeconds\`,
            /*
             * How many times this client has been rung inside the range on screen.
             *
             * A window function rather than a second query: it counts over the rows this report
             * already selected, so it narrows with the filters instead of quietly reporting the
             * all-time total beside a filtered list.
             */
            COUNT(*) OVER (PARTITION BY \`c\`.\`client_number\`) AS \`attempts\`,
            COALESCE(\`l\`.\`vertical\`, '') AS \`vertical\`,
            COALESCE(\`l\`.\`created_date\`, '') AS \`leadCreatedDate\`,
            COALESCE(\`l\`.\`status\`, '') AS \`leadStatus\`,
            COALESCE(\`c\`.\`crm_status\`, '') AS \`crmStatus\`,
            COALESCE(\`c\`.\`note\`, '') AS \`note\`,
            \`c\`.\`recording_url\` AS \`recordingUrl\`,
            \`c\`.\`called_at\` AS \`calledAt\`
       FROM ${CALL_LOG} ${sql}
      ORDER BY \`c\`.\`called_at\` DESC, \`c\`.\`id\` DESC
      LIMIT ${HISTORY_LIMIT + 1}`,
    params,
  );

  const capped = rows.length > HISTORY_LIMIT;
  return {
    filters: clean,
    limit: HISTORY_LIMIT,
    capped,
    rows: rows.slice(0, HISTORY_LIMIT).map((row) => ({
      ...rowNumbers(row, ["durationSeconds", "attempts"]),
      vertical: String(row.vertical || "").trim() || "Dum Dum",
      duration: duration(row.durationSeconds),
      // Whether there is one, not where it is: a recording URL is the client's own voice and does
      // not belong in a report payload that is exported and emailed around.
      hasRecording: Boolean(String(row.recordingUrl || "").trim()),
      recordingUrl: undefined,
      calledAt: row.calledAt ? new Date(row.calledAt).toISOString() : null,
    })),
  };
}

/*
 * ---------------------------------------------------------------------------------------------
 * Usage by employee: WhatsApp, and the application itself.
 *
 * These two answer a different question from the five above, and off different tables. The call
 * reports are about the Callyzer employee who made a call; these are about the **ERP user** who
 * did something in this system - sent a WhatsApp message, changed a lead. The two are not the same
 * list of people and are not joined into one: a Callyzer employee is a phone, an ERP user is a
 * login, and pretending a name links them would put one person's work under another's row.
 *
 * The vertical, call type and duration filters have no meaning here and are ignored rather than
 * returning nothing; the report says which it could not honour so the page can pass that on.
 * ---------------------------------------------------------------------------------------------
 */

// The user's own name where the row is linked to one, and whatever was recorded against it where
// it is not - `actor_name` on an older activity row, before the actor was linked.
const ACTOR_NAME = "COALESCE(NULLIF(TRIM(`u`.`name`), ''), NULLIF(TRIM(`a`.`actor_name`), ''), 'Unknown')";

/**
 * WhatsApp, per employee: the messages they sent and the calls they made.
 *
 * Two sources, because WhatsApp is two things here. The messages come from this application's own
 * chat (`SalesCrmWhatsAppMessage`, keyed on the ERP user who sent them); the calls come from
 * Callyzer, which reports a WhatsApp call like any other with `call_method = 'WhatsAppCall'` and
 * keys it on the employee's phone. Both already land against the lead they belong to - the calls
 * have been in the lead's Call Logs tab all along - and this is where they are counted together.
 *
 * The two are matched **by name**, which is the only thing they share: one identity is a login, the
 * other is a handset. That is an honest join rather than a certain one - somebody whose Callyzer
 * name is spelled differently from their user name appears as two rows - and it is the reason the
 * call columns are named as calls rather than folded silently into the message counts.
 *
 * Answers an empty report rather than throwing when either table has never been created: a studio
 * that has not paired WhatsApp, or never had a delivery, still opens this tab.
 */
async function whatsappUsage(filters, scope = null) {
  const { sql, params, filters: clean, ignored } = buildUsageWhere(filters, {
    dateColumn: "`m`.`sentAt`",
    nameExpr: "COALESCE(NULLIF(TRIM(`u`.`name`), ''), 'Unknown')",
    /*
     * Whose messages: the reader's own and their team's, by the login that sent them - and a branch
     * administrator's branches, read off the sender's own `user` row, since a message carries no
     * branch of its own.
     */
    scope,
    scopeColumns: { user: "`m`.`userId`", branch: "`u`.`branch_id`" },
  });
  try {
    const rows = await query(
      `WITH \`events\` AS (
         SELECT COALESCE(NULLIF(TRIM(\`u\`.\`name\`), ''), 'Unknown') AS \`employee\`,
                \`m\`.\`direction\` AS \`direction\`,
                \`m\`.\`enquiryId\` AS \`enquiryId\`,
                \`m\`.\`mediaType\` AS \`mediaType\`,
                \`m\`.\`sentAt\` AS \`at\`
           FROM \`SalesCrmWhatsAppMessage\` AS \`m\`
           LEFT JOIN \`user\` AS \`u\` ON \`u\`.\`id\` = \`m\`.\`userId\`
           ${sql}
       )
       SELECT \`employee\`,
              SUM(CASE WHEN \`direction\` = 'out' THEN 1 ELSE 0 END) AS \`sent\`,
              SUM(CASE WHEN \`direction\` = 'in' THEN 1 ELSE 0 END) AS \`received\`,
              COUNT(DISTINCT \`enquiryId\`) AS \`leads\`,
              SUM(CASE WHEN COALESCE(\`mediaType\`, '') <> '' THEN 1 ELSE 0 END) AS \`attachments\`,
              MIN(\`at\`) AS \`firstAt\`,
              MAX(\`at\`) AS \`lastAt\`
         FROM \`events\`
        GROUP BY \`employee\`
        ORDER BY \`sent\` DESC, \`employee\` ASC`,
      params,
    );
    /*
     * The WhatsApp calls, from the same call log the call reports read.
     *
     * Its own clause because it is its own table: the dates are `called_at` rather than `sentAt`,
     * and the person is the employee Callyzer named rather than the user who signed in. A failure
     * here costs the call columns and leaves the message ones standing, which is the right way
     * round - a studio with no Callyzer deliveries still has its messages.
     */
    // The people this half may report on, resolved and tested the way Employee Analysis does - so a
    // handset nobody in the repository holds does not appear here as a person who uses WhatsApp.
    const staff = await staffCalls(scope);
    const callWhere = buildUsageWhere(filters, {
      dateColumn: "`c`.`called_at`",
      nameExpr: staff.nameExpr,
      nameParams: staff.nameParams,
    });
    let callRows = [];
    try {
      callRows = await query(
        `SELECT ${staff.nameExpr} AS \`employee\`,
                COUNT(*) AS \`calls\`,
                SUM(CASE WHEN \`c\`.\`duration_seconds\` > 0 THEN 1 ELSE 0 END) AS \`callsConnected\`,
                COALESCE(SUM(\`c\`.\`duration_seconds\`), 0) AS \`callSeconds\`,
                MAX(\`c\`.\`called_at\`) AS \`lastCallAt\`
           FROM \`sales_crm_call_log\` AS \`c\`${EMPLOYEE_JOIN}
           ${callWhere.sql}
            AND \`c\`.\`call_method\` = 'WhatsAppCall'
            AND ${staff.where}
          GROUP BY \`employee\``,
        [...staff.nameParams, ...callWhere.params, ...staff.whereParams],
      );
    } catch (error) {
      console.warn("Unable to read the WhatsApp calls for the usage report:", error?.message || error);
    }

    /*
     * One row a person, from whichever of the two they appear in.
     *
     * Somebody who only ever rings on WhatsApp and never types has calls and no messages, and is a
     * WhatsApp user all the same - starting from the message rows alone would leave them out of a
     * report about WhatsApp use.
     */
    // Time with the chat panel actually open, which is what the usage column on this report means.
    const measured = await measuredUsage({ from: clean.from, to: clean.to, context: "whatsapp", scope });

    const byEmployee = new Map();
    for (const row of rows) {
      byEmployee.set(row.employee, {
        ...rowNumbers(row, ["sent", "received", "leads", "attachments"]),
        // Answering and replying alike: "how much did they use WhatsApp" is both directions.
        messages: num(row.sent) + num(row.received),
        ...usageFrom(measured.get(String(row.employee || "").trim())),
        firstAt: row.firstAt ? new Date(row.firstAt).toISOString() : null,
        lastAt: row.lastAt ? new Date(row.lastAt).toISOString() : null,
      });
    }
    for (const row of callRows) {
      const employee = String(row.employee || "").trim();
      const current = byEmployee.get(employee) || {
        employee, sent: 0, received: 0, messages: 0, leads: 0, attachments: 0,
        usageSeconds: 0, usageSessions: 0, usage: hoursMinutes(0), firstAt: null, lastAt: null,
      };
      const callSeconds = num(row.callSeconds);
      byEmployee.set(employee, {
        ...current,
        calls: num(row.calls),
        callsConnected: num(row.callsConnected),
        callSeconds,
        callTime: hoursMinutes(callSeconds),
        lastCallAt: row.lastCallAt ? new Date(row.lastCallAt).toISOString() : null,
        /*
         * Time on a call is time on WhatsApp, so it counts towards the usage beside it.
         *
         * The call half is measured rather than estimated - Callyzer reports the seconds - so this
         * is a better number than the message half, not a worse one. Both are seconds spent on the
         * same thing, which is what the column answers.
         */
        usageSeconds: num(current.usageSeconds) + callSeconds,
        usage: hoursMinutes(num(current.usageSeconds) + callSeconds),
      });
    }

    const merged = [...byEmployee.values()].map((row) => ({
      calls: 0, callsConnected: 0, callSeconds: 0, callTime: hoursMinutes(0), lastCallAt: null,
      ...row,
    }));
    // Busiest first, counting both halves - a person is as busy on WhatsApp as the two come to.
    merged.sort((a, b) => (b.messages + b.calls) - (a.messages + a.calls) || a.employee.localeCompare(b.employee));

    return { filters: clean, ignored, rows: merged };
  } catch (error) {
    console.warn("Unable to build the WhatsApp usage report:", error?.message || error);
    return { filters: clean, ignored, rows: [] };
  }
}

/**
 * The application, per employee.
 *
 * What somebody actually did in the CRM, from the activity log every edit already writes: how many
 * changes, across how many leads, and which kinds. It is a better measure of use than a count of
 * sign-ins, which says somebody opened the page and nothing about whether they worked in it - the
 * last sign-in is reported beside it rather than instead of it.
 *
 * Grouped by the resolved name rather than the user id, because an activity row written before the
 * actor was linked has a name and no id, and those are the same person's work.
 */
/**
 * Every employee still working here - not archived, employment status one that counts as working -
 * as Application Usage lists them: by their login's name (what usage is keyed on), or their own name
 * where they have no login, with that login's last sign-in. Narrowed to the people this reader may
 * see (`scope`, on the employee, their login and the employee's branch) and the employee filter.
 * Somebody who has left, and a login with no employee behind it, are not among them.
 */
async function activeEmployeesForUsage(scope = null, employees = []) {
  const statuses = await workingEmployeeStatuses();
  if (!statuses.length) return [];
  const nameExpr = "COALESCE(NULLIF(TRIM(`u`.`name`), ''), TRIM(`e`.`employee_name`))";
  const clauses = ["`e`.`archived_at` IS NULL", `\`e\`.\`employment_status\` IN (${statuses.map(() => "?").join(", ")})`];
  const params = [...statuses];
  if (employees.length) {
    clauses.push(`${nameExpr} IN (${employees.map(() => "?").join(", ")})`);
    params.push(...employees);
  }
  if (scope) {
    const { clause, params: scopeParams } = scope.sql({ employee: "`e`.`id`", user: "`u`.`id`", branch: "`e`.`branch_id`" });
    clauses.push(clause);
    params.push(...scopeParams);
  }
  const rows = await query(
    `SELECT ${nameExpr} AS \`employee\`, MAX(\`u\`.\`last_login_at\`) AS \`lastLoginAt\`
       FROM \`employee\` AS \`e\`
       LEFT JOIN \`user\` AS \`u\` ON \`u\`.\`linked_employee_id\` = \`e\`.\`id\`
      WHERE ${clauses.join(" AND ")}
      GROUP BY \`employee\``,
    params,
  );
  return rows.map((row) => ({ employee: String(row.employee || "").trim(), lastLoginAt: row.lastLoginAt || null })).filter((row) => row.employee);
}

async function applicationUsage(filters, scope = null) {
  const { sql, params, filters: clean, ignored } = buildUsageWhere(filters, {
    dateColumn: "`a`.`created_at`",
    nameExpr: ACTOR_NAME,
    // Whose activity: the login that did it, and the branch of that login for an administrator.
    scope,
    scopeColumns: { user: "`a`.`actor_user_id`", branch: "`u`.`branch_id`" },
  });
  try {
    const rows = await query(
      `WITH \`events\` AS (
         SELECT ${ACTOR_NAME} AS \`employee\`,
                \`a\`.\`action\` AS \`action\`,
                \`a\`.\`enquiry_id\` AS \`enquiryId\`,
                \`a\`.\`created_at\` AS \`at\`,
                \`u\`.\`last_login_at\` AS \`lastLoginAt\`
           FROM \`sales_crm_lead_activity\` AS \`a\`
           LEFT JOIN \`user\` AS \`u\` ON \`u\`.\`id\` = \`a\`.\`actor_user_id\`
           ${sql}
       )
       SELECT \`employee\`,
              COUNT(*) AS \`actions\`,
              COUNT(DISTINCT \`enquiryId\`) AS \`leads\`,
              SUM(CASE WHEN \`action\` = 'CREATED' THEN 1 ELSE 0 END) AS \`created\`,
              SUM(CASE WHEN \`action\` = 'UPDATED' THEN 1 ELSE 0 END) AS \`updates\`,
              SUM(CASE WHEN \`action\` = 'STATUS_CHANGED' THEN 1 ELSE 0 END) AS \`statusChanges\`,
              SUM(CASE WHEN \`action\` = 'REMARK_ADDED' THEN 1 ELSE 0 END) AS \`remarks\`,
              MIN(\`at\`) AS \`firstAt\`,
              MAX(\`at\`) AS \`lastAt\`,
              MAX(\`lastLoginAt\`) AS \`lastLoginAt\`
         FROM \`events\`
        GROUP BY \`employee\`
        ORDER BY \`actions\` DESC, \`employee\` ASC`,
      params,
    );
    /*
     * The `app` context alone, which is the whole of the time in question - not every context
     * summed, which was counting some of it twice.
     *
     * The two contexts run *concurrently*, not one after the other. `AppShell` beats as "app" for
     * the entire session and the chat panel beats as "whatsapp" alongside it while it is open, so
     * the same wall-clock minute spent in the chat produces a stretch in each. Adding them made an
     * hour in the chat panel read as two hours of application use, and it broke the idle figure
     * worse than the usage one: idle is the span *minus* the active time, so an inflated active
     * subtracts too much and understates - or, with enough chat, goes negative and clamps to zero.
     *
     * "app" already covers the chat: the shell's own heartbeat never stops while the panel is open.
     * The WhatsApp report reads the "whatsapp" context to answer the narrower question of how much
     * of that time was spent in the chat, which is what that column there means.
     */
    /*
     * Everybody who used the application, not only those with CRM activity.
     *
     * The rows above come from the CRM's activity log, so on their own they listed the sales team
     * alone. The measured time is everybody's - every signed-in screen beats - so it is read here as
     * a list in its own right, narrowed to the people this reader may see (`scope`) and the ones
     * they filtered to, exactly as Work Hours lists them; somebody with time but no CRM activity
     * gets a row with zero CRM counts.
     */
    const employees = Array.isArray(clean.employee) ? clean.employee : [clean.employee].filter(Boolean);
    const measured = await measuredUsage({ from: clean.from, to: clean.to, context: "app", scope, employees });
    const iso = (value) => (value ? new Date(value).toISOString() : null);
    const crmRows = rows.map((row) => ({
      ...rowNumbers(row, ["actions", "leads", "created", "updates", "statusChanges", "remarks"]),
      ...usageFrom(measured.get(String(row.employee || "").trim())),
      firstAt: iso(row.firstAt),
      lastAt: iso(row.lastAt),
      lastLoginAt: iso(row.lastLoginAt),
    }));
    const listed = new Set(crmRows.map((row) => String(row.employee || "").trim()));
    const usageOnly = [...measured.entries()]
      .filter(([employee]) => employee && !listed.has(employee))
      .map(([employee, usage]) => ({
        employee, actions: 0, leads: 0, created: 0, updates: 0, statusChanges: 0, remarks: 0,
        ...usageFrom(usage),
        firstAt: null, lastAt: null, lastLoginAt: iso(usage.lastLoginAt),
      }))
      .sort((a, b) => b.usageSeconds - a.usageSeconds || a.employee.localeCompare(b.employee));
    /*
     * Every active employee, and only them (`activeEmployeesForUsage`): those who used the
     * application as above, and everyone else still working with a 0m row - so somebody who never
     * opened it in the range shows rather than goes missing.
     */
    const active = await activeEmployeesForUsage(scope, employees);
    const activeNames = new Set(active.map((row) => row.employee));
    const used = [...crmRows, ...usageOnly].filter((row) => activeNames.has(String(row.employee || "").trim()));
    const shown = new Set(used.map((row) => String(row.employee || "").trim()));
    const notUsed = active
      .filter((row) => !shown.has(row.employee))
      .map((row) => ({
        employee: row.employee, actions: 0, leads: 0, created: 0, updates: 0, statusChanges: 0, remarks: 0,
        ...usageFrom(null),
        firstAt: null, lastAt: null, lastLoginAt: iso(row.lastLoginAt),
      }))
      .sort((a, b) => a.employee.localeCompare(b.employee));
    return { filters: clean, ignored, rows: [...used, ...notUsed] };
  } catch (error) {
    console.warn("Unable to build the application usage report:", error?.message || error);
    return { filters: clean, ignored, rows: [] };
  }
}

/*
 * How long somebody actually spent using a thing.
 *
 * This used to be inferred: a person's recorded actions were put in order and the gaps between them
 * added up, with anything over fifteen minutes treated as a break. It was a reasonable estimate of
 * "time between two things they did" and a poor answer to the question the studio actually asks -
 * somebody who saved a lead, spent twelve minutes in their email and saved another was credited
 * with thirteen minutes of work in here.
 *
 * It is measured now. The browser beats while the tab is visible and the person has interacted
 * recently, and `app_usage_session` holds the stretches those beats make; time in another
 * application, or in front of a tab nobody is touching, is never written and so can never be
 * counted. See `src/modules/usage/heartbeat/service.js` for what a beat is and when one is sent.
 *
 * The two reports read the same table and differ only in which context they ask for - the whole
 * application, or the WhatsApp panel - so their two usage columns remain the same measure and can
 * still be read side by side.
 */

/** Seconds as the hours and minutes a usage column is read in: "2h 15m", "45m", "under a minute". */
function hoursMinutes(seconds) {
  const total = Math.max(0, Math.round(num(seconds)));
  if (total < 60) return total ? "<1m" : "0m";
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * Measured time at the application, by the name the reports group people under.
 *
 * Keyed on the user's name rather than their id, because that is what both reports group by - a
 * report row is a person as they are written on the screen, and an activity row from before the
 * actor was linked has only a name to offer. Two logins with one name would be counted together,
 * which is the same compromise the reports already make everywhere else.
 *
 * `context` narrows it: `"whatsapp"` for time with the chat panel open, `"app"` for the application
 * at large. `scope` and `employees` narrow it to the people a reader may see and the ones they
 * filtered to - needed where the measure is the list itself (Application Usage lists everybody who
 * used the application), not only looked up by name.
 *
 * Answers, per name, the seconds used, the sittings, and `inactiveSeconds`: the time signed in less
 * the time used, day by day. Signed in is read from the audit log's Login and Logout lines for the
 * application at large only - Login-to-Logout less time in the chat panel is not a figure that
 * means anything, so the WhatsApp context keeps the span of its own use. See `signedIn.js`.
 */
async function measuredUsage({ from, to, context = null, scope = null, employees = [], now = new Date() } = {}) {
  const clauses = [];
  const params = [];
  /*
   * Whole days, the way every other query in this module bounds a range.
   *
   * `from` and `to` arrive as plain days - "2026-09-02" - and MySQL reads a bare day as the midnight
   * that *starts* it. So `started_at <= '2026-09-02'` excluded everything recorded during the 2nd,
   * and since a report's range ends on today by default, that was every stretch anybody had opened
   * today. With all of a studio's usage inside the last day of its own range, both usage columns
   * read 0m however long the application had been in use. Bounded as `buildWhere` bounds its own
   * dates - from the first moment of `from` to the last of `to` - the day named is included.
   *
   * The comparison is deliberately across the two columns: a stretch counts if it *overlaps* the
   * range at all, so a sitting that began before the range and ran into it is not lost either.
   */
  if (from) { clauses.push("`s`.`ended_at` >= ?"); params.push(dayStart(from)); }
  if (to) { clauses.push("`s`.`started_at` <= ?"); params.push(dayEnd(to)); }
  if (context) { clauses.push("`s`.`context` = ?"); params.push(context); }
  /*
   * Whose time: the people this reader may see and the ones they filtered to. Built once and used
   * by both reads below, on the `user` row each joins, so the sign-in lines are narrowed to exactly
   * the people whose stretches are.
   */
  const people = [];
  const peopleParams = [];
  if (employees.length) {
    people.push(`COALESCE(NULLIF(TRIM(\`u\`.\`name\`), ''), 'Unknown') IN (${employees.map(() => "?").join(", ")})`);
    peopleParams.push(...employees);
  }
  if (scope) {
    const { clause, params: scopeParams } = scope.sql({ user: "`u`.`id`", branch: "`u`.`branch_id`" });
    people.push(clause);
    peopleParams.push(...scopeParams);
  }
  const where = [...clauses, ...people];

  try {
    const dayRows = await query(
      /*
       * Active seconds, and the span they are spread across, per person per day.
       *
       * A day is the unit somebody actually works in - the studio's day, midnight to midnight in
       * Asia/Kolkata, which `studioDaySql` reads off the stored UTC column. `DATE()` of the column
       * itself filed anything before 05:30 under the day before and ran every day from half past
       * five. The days are added up in `measuredTotals`, not here: taken across a whole month the
       * span would run from the first morning to the last evening and count every night and
       * weekend as inactive time.
       *
       * The span - first stretch to last - is the fallback for a day with no sign-in line to read
       * the signed-in time from. Per login as well as per name, so the sign-in lines below can be
       * matched to the person they belong to before the names are merged.
       */
      `SELECT COALESCE(NULLIF(TRIM(\`u\`.\`name\`), ''), 'Unknown') AS \`employee\`,
              ${studioDaySql("\`s\`.\`started_at\`")} AS \`day\`,
              SUM(TIMESTAMPDIFF(SECOND, \`s\`.\`started_at\`, \`s\`.\`ended_at\`)) AS \`seconds\`,
              COUNT(*) AS \`sessions\`,
              TIMESTAMPDIFF(SECOND, MIN(\`s\`.\`started_at\`), MAX(\`s\`.\`ended_at\`)) AS \`spanSeconds\`,
              MAX(\`u\`.\`last_login_at\`) AS \`lastLoginAt\`
         FROM \`app_usage_session\` AS \`s\`
         JOIN \`user\` AS \`u\` ON \`u\`.\`id\` = \`s\`.\`user_id\`
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY \`employee\`, \`u\`.\`id\`, \`day\``,
      [...params, ...peopleParams],
    );
    const authRows = context === "whatsapp" ? [] : await signInLines({ from, to, people, peopleParams });
    return measuredTotals({ dayRows, authRows, now });
  } catch (error) {
    // A studio that has not run the application since this was added has no rows, and an older
    // database may not have the table at all. Either way the rest of the report is still worth
    // showing - the usage column reads zero rather than the page failing.
    console.warn("Unable to read measured usage:", error?.message || error);
    return new Map();
  }
}

/**
 * The sign-in and sign-out lines in the range, for the people the report is about.
 *
 * Inactive Time Track reads "signed in" from these: a `Login` line opens a session and a `Logout`
 * line closes it, and a session nobody closed runs to the end of the studio day - the rule is in
 * `signedIn.js`. The lines are the audit log's (`user_activity_log`, written by the sign-in and
 * sign-out handlers), bounded on the same studio days as the stretches.
 *
 * Nothing rather than a failure where the log is not there to read: a database from before the
 * audit log has no table, and a day past the log's retention has no lines - either way every day
 * falls back to the span of its own use, which is what the figure was before there was a log.
 */
async function signInLines({ from, to, people = [], peopleParams = [] } = {}) {
  const clauses = ["`l`.`module` = 'Auth'", "`l`.`action` IN ('Login', 'Logout')", "`l`.`status_code` = 200", ...people];
  const params = [...peopleParams];
  if (from) { clauses.push("`l`.`created_at` >= ?"); params.push(dayStart(from)); }
  if (to) { clauses.push("`l`.`created_at` <= ?"); params.push(dayEnd(to)); }
  try {
    return await query(
      `SELECT COALESCE(NULLIF(TRIM(\`u\`.\`name\`), ''), 'Unknown') AS \`employee\`,
              \`l\`.\`action\` AS \`action\`,
              \`l\`.\`created_at\` AS \`at\`
         FROM \`user_activity_log\` AS \`l\`
         JOIN \`user\` AS \`u\` ON \`u\`.\`id\` = \`l\`.\`user_id\`
        WHERE ${clauses.join(" AND ")}
        ORDER BY \`l\`.\`created_at\``,
      params,
    );
  } catch (error) {
    console.warn("Unable to read the sign-in lines for the usage report:", error?.message || error);
    return [];
  }
}

/**
 * The seconds a row's sittings come to, and the sittings themselves.
 *
 * `activeSeconds` and `sessions` are the two aggregates the SQL produces to get here. They are
 * removed rather than left on the row: they are the working, not the answer, and the table builds a
 * column for every field it finds in the data it is given - so leaving them in put "Active Seconds"
 * and "Sessions" in front of somebody as columns of a report that never meant to have them.
 */
/**
 * A row's measured time, in the shape the table reads.
 *
 * `measured` is what `measuredUsage` found for that person, or nothing at all - somebody who did
 * work in the range but has never been beaten for reads as no time rather than as an error. The
 * working is not left on the row: the table builds a column for every field it is handed, so a
 * stray `activeSeconds` put "Active Seconds" in front of somebody as a column of a report that
 * never meant to have one.
 */
function usageFrom(measured) {
  const seconds = num(measured?.seconds);
  return {
    activeSeconds: undefined,
    sessions: undefined,
    usageSeconds: seconds,
    usageSessions: num(measured?.sessions),
    usage: hoursMinutes(seconds),
    // Time signed in and idle: the day's signed-in time (Login to Logout, or to the end of the
    // studio day) less the time actually used, summed over the days - see `signedIn.js`. Zero when
    // there is nothing measured yet.
    inactiveSeconds: num(measured?.inactiveSeconds),
    inactive: hoursMinutes(num(measured?.inactiveSeconds)),
  };
}

/**
 * A person's call time, by the day they made or took the calls.
 *
 * The other half of Work Hours. `sales_crm_call_log` is what Callyzer delivers - one row per call,
 * with the seconds it lasted - so this is the studio's time on the phone, which the browser cannot
 * see and never could: a salesperson on a forty-minute call is not touching the application, and
 * every minute of that call was being read as idle.
 *
 * ── Matched by name, and that is a real caveat ──
 *
 * Callyzer knows an employee as a handset and the application knows them as a login; there is no id
 * joining the two, so the only key is the name. WhatsApp Usage already matches the same two
 * identities the same way, and this makes the same match rather than inventing a second rule: a
 * name with no login of the same spelling contributes a row of call time and no application time,
 * and a login nobody has ever called from contributes the reverse. Neither is lost - both appear -
 * which is the honest way to be wrong about a join that has no key.
 *
 * The Callyzer side of that join is the **repository's** spelling now, not the handset's: `staffCalls`
 * resolves a handset to the employee whose number it is before this ever sees a name. So the join
 * lands far more often than it used to - a phone labelled "Manjula DBS" no longer produces a person
 * of that name with call time and no application time beside the real row - and a handset belonging
 * to nobody in the repository contributes no row at all, which is what keeps this a timesheet of the
 * studio's people rather than of its phones.
 *
 * ── Which day a call belongs to ──
 *
 * `called_at`, the moment it happened, in the same day the app stretches are filed under. Bounded on
 * the column rather than on `DATE()` of it, for the reason the query below is.
 */
async function callHoursByDay({ from, to, employee }, scope = null) {
  /*
   * Whose call time this is. A timesheet is a list of the studio's people, so a handset that belongs
   * to nobody in the repository contributes no row - and one that belongs to somebody contributes to
   * *their* row, under the repository's spelling, which is the name the application half is joined
   * on below.
   */
  const staff = await staffCalls(scope);
  const clauses = [staff.where];
  const params = [...staff.whereParams];
  if (from) { clauses.push("`c`.`called_at` >= ?"); params.push(dayStart(from)); }
  if (to) { clauses.push("`c`.`called_at` <= ?"); params.push(dayEnd(to)); }
  // A list, for the same reason and with the same fault as `workHours` below - and here the `catch`
  // around the query swallowed the failure, so the figures simply read as zero.
  const callHourNames = Array.isArray(employee) ? employee : [employee].filter(Boolean);
  if (callHourNames.length) {
    clauses.push(`${staff.nameExpr} IN (${callHourNames.map(() => "?").join(", ")})`);
    params.push(...staff.nameParams, ...callHourNames);
  }
  // A negative or absent length would subtract from the day, which no call can do.
  clauses.push("COALESCE(`c`.`duration_seconds`, 0) >= 0");

  try {
    return await query(
      `SELECT ${staff.nameExpr} AS \`employee\`,
              ${studioDaySql("\`c\`.\`called_at\`")} AS \`day\`,
              COALESCE(SUM(\`c\`.\`duration_seconds\`), 0) AS \`callSeconds\`,
              COUNT(*) AS \`calls\`,
              MIN(\`c\`.\`called_at\`) AS \`firstAt\`,
              MAX(\`c\`.\`called_at\`) AS \`lastAt\`
         FROM \`sales_crm_call_log\` AS \`c\`${EMPLOYEE_JOIN}
        WHERE ${clauses.join(" AND ")}
        GROUP BY \`employee\`, \`day\``,
      [...staff.nameParams, ...params],
    );
  } catch (error) {
    /*
     * No call log at all, which is a studio that has never received a Callyzer delivery. That is a
     * timesheet of application time and nothing else rather than a report that fails to open - the
     * same trade the whole of this function makes.
     */
    console.warn("Unable to read call hours for the work hours report:", error?.message || error);
    return [];
  }
}

/**
 * Work Hours: what each person's days actually looked like.
 *
 * Application Usage answers "how long has this person been in the application over the range", which
 * is one number per person. This answers the question a timesheet asks - *which days, and how long
 * on each* - so a fortnight is fourteen rows per person rather than one, and a day somebody did not
 * work is a day with no row.
 *
 * ── Work Hours is Call Hours plus Application Usage ──
 *
 * The hours column used to be the application alone, and it undercounted the job it was measuring.
 * The people this report is read about spend their day on the phone: a salesperson on a forty-minute
 * call is not touching the browser, so the browser recorded nothing, and the timesheet read that
 * forty minutes as idle. Half of a CRM's working day was invisible to the one screen that claimed to
 * measure it.
 *
 * So the column is the two added: the time measured in the application, plus the time Callyzer says
 * they were on a call. Both halves are shown beside it - a manager reading a short day needs to know
 * which of the two it was short on - and the addition is done here so the row cannot disagree with
 * its own parts.
 *
 * It is **effort across two systems, not wall clock**, and it can exceed the length of the day: a
 * call taken with the application open is counted in both halves, because both are true and nothing
 * records which minutes overlapped. Day Span is what stays wall clock, and it is why the two columns
 * sit next to each other.
 *
 * ── Where the application half comes from ──
 *
 * `app_usage_session`, the same measured table both usage columns read. The browser beats while the
 * tab is visible and the person has interacted recently, and a stretch ends when they stop touching
 * anything for the usage timeout; so time in another application, or in front of a tab nobody is
 * touching, was never written and cannot be counted here. This is measured time, not the gaps
 * between somebody's saved records.
 *
 * ── The figures, and why they are these ──
 *
 *   Application Usage  the stretches in the browser, added up.
 *   Call Hours         the seconds Callyzer reports, added up.
 *   Work Hours         the two together. The column the report is named for.
 *   Idle               the gaps between the *application* stretches - signed in, not touching
 *                      anything. Left as it was rather than reduced by call time, because nothing
 *                      says which of a day's idle minutes were spent on which call, and a figure
 *                      guessed at is worse than one that is plainly the browser's own.
 *   Span               first activity to last, across both. The length of the working day.
 *
 * ── Which day a stretch belongs to ──
 *
 * The one it started on. A stretch that runs through midnight - somebody working at 23:55 and still
 * at it at 00:05 - is counted whole against the day it began, rather than split across the two.
 *
 * That is a deliberate choice and the alternative is worse: splitting would make this report's
 * totals disagree with Application Usage beside it, which files a stretch the same way, and two
 * screens in the same module giving different hours for the same fortnight is a worse fault than a
 * few minutes filed under yesterday. It is also the rarer case by far - the studio's CRM staff work
 * days, and a stretch only survives midnight if somebody is actively working through it.
 *
 * ── Which days are in range ──
 *
 * The day itself, not the stretch. `measuredUsage` counts a stretch that *overlaps* the range,
 * because a total for a range should not lose a sitting that began just before it. A timesheet is
 * the other question: a row is a day, and a day is either inside the range or it is not.
 */
async function workHours(filters, scope = null) {
  const { filters: clean, ignored } = buildUsageWhere(filters, {
    dateColumn: "`s`.`started_at`",
    nameExpr: "`u`.`name`",
  });

  const clauses = [];
  const params = [];
  /*
   * Bounded on the column rather than on `DATE()` of it.
   *
   * The two say the same thing - `started_at` between the first moment of `from` and the last of
   * `to` is exactly "the day it began is in the range" - but a function around the column is a
   * predicate no index can answer, so the report would read the whole table however narrow the
   * range. The same reasoning as the note on `board_key` in the CRM's own board query.
   */
  if (clean.from) {
    clauses.push("`s`.`started_at` >= ?");
    params.push(dayStart(clean.from));
    /*
     * True by construction, and here to be indexable.
     *
     * A stretch always ends at or after it started, so this says nothing the line above does not
     * already say - but `app_usage_session` is indexed on `ended_at` and on nothing that leads with
     * `started_at`, so it is the predicate MySQL can actually narrow the table by. Stating both
     * gives the optimiser the index and keeps the exact bound.
     */
    clauses.push("`s`.`ended_at` >= ?");
    params.push(dayStart(clean.from));
  }
  if (clean.to) { clauses.push("`s`.`started_at` <= ?"); params.push(dayEnd(clean.to)); }
  /*
   * A list, not a name - `resolveEmployeeFilter` above hands one back however the query string
   * wrote it. Bound as a single `= ?` this pushed the array itself as one parameter, and the test
   * that guarded it was `if (clean.employee)`, which an empty array passes: the clause went on
   * every query and matched nobody, so this report was empty for everyone. `IN` with a placeholder
   * per name, and the guard on the length, the way `staffCallSql` builds its own tests.
   */
  const workHoursNames = Array.isArray(clean.employee) ? clean.employee : [clean.employee].filter(Boolean);
  if (workHoursNames.length) {
    clauses.push(`COALESCE(NULLIF(TRIM(\`u\`.\`name\`), ''), 'Unknown') IN (${workHoursNames.map(() => "?").join(", ")})`);
    params.push(...workHoursNames);
  }
  /*
   * The whole application, not every context added together.
   *
   * The contexts run concurrently - the shell beats as "app" for the entire session while the chat
   * panel beats as "whatsapp" alongside it - so summing them would count a minute spent in the chat
   * twice and report a nine-hour day as fourteen. "app" already covers the chat. This is the same
   * reasoning, and the same fault, as the note in `applicationUsage` above.
   */
  clauses.push("`s`.`context` = 'app'");
  /*
   * Whose hours: the reader's own and their team's, by the login the stretch was measured against -
   * and a branch administrator's branches, read off that login's own `user` row, since a stretch
   * carries no branch of its own. The call half below is narrowed separately, through `staffCalls`,
   * because it is keyed on a handset rather than a login.
   */
  if (scope) {
    const { clause, params: scopeParams } = scope.sql({ user: "`s`.`user_id`", branch: "`u`.`branch_id`" });
    clauses.push(clause);
    params.push(...scopeParams);
  }
  /*
   * A stretch that is still being worked counts, and counts correctly.
   *
   * `ended_at` is not an end-of-session marker - every beat moves it forward, so an open stretch is
   * one whose end is its most recent beat. Today's row is therefore the hours worked so far, which
   * is what somebody looking at a timesheet at four in the afternoon expects to see.
   *
   * The one guard worth keeping is against a row whose end is somehow before its start, which would
   * subtract from the day's total.
   */
  clauses.push("`s`.`ended_at` >= `s`.`started_at`");

  try {
    const rows = await query(
      `SELECT COALESCE(NULLIF(TRIM(\`u\`.\`name\`), ''), 'Unknown') AS \`employee\`,
              ${studioDaySql("\`s\`.\`started_at\`")} AS \`day\`,
              SUM(TIMESTAMPDIFF(SECOND, \`s\`.\`started_at\`, \`s\`.\`ended_at\`)) AS \`workedSeconds\`,
              COUNT(*) AS \`sittings\`,
              MIN(\`s\`.\`started_at\`) AS \`firstAt\`,
              MAX(\`s\`.\`ended_at\`) AS \`lastAt\`,
              TIMESTAMPDIFF(SECOND, MIN(\`s\`.\`started_at\`), MAX(\`s\`.\`ended_at\`)) AS \`spanSeconds\`
         FROM \`app_usage_session\` AS \`s\`
         JOIN \`user\` AS \`u\` ON \`u\`.\`id\` = \`s\`.\`user_id\`
        WHERE ${clauses.join(" AND ")}
        GROUP BY \`employee\`, \`day\`
        ORDER BY \`day\` DESC, \`workedSeconds\` DESC, \`employee\` ASC`,
      params,
    );

    /*
     * The two halves, merged on the person and the day.
     *
     * A full outer join, done here rather than in SQL: a day of calls with the application never
     * opened is still a working day, and a day in the application with no calls plainly is - so
     * neither half may drop a row the other has. `app_usage_session` and `sales_crm_call_log` also
     * live behind different readiness guards, and one of them being absent must not take the other
     * with it.
     */
    // The call half narrowed the same way: `staffCalls` inside it is given this reader's scope, so a
    // handset belonging to somebody they do not manage contributes to nobody's row.
    const calls = await callHoursByDay(clean, scope);
    const byKey = new Map();
    const dayOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
    const at = (value) => (value ? new Date(value) : null);

    for (const row of rows) {
      const employee = String(row.employee || "Unknown");
      const day = dayOf(row.day);
      byKey.set(`${employee}\u0000${day}`, {
        employee,
        day,
        appSeconds: num(row.workedSeconds),
        spanSeconds: num(row.spanSeconds),
        sittings: num(row.sittings),
        firstAt: at(row.firstAt),
        lastAt: at(row.lastAt),
        callSeconds: 0,
        calls: 0,
      });
    }

    for (const row of calls) {
      const employee = String(row.employee || "Unknown");
      const day = dayOf(row.day);
      const key = `${employee}\u0000${day}`;
      const existing = byKey.get(key) || {
        employee, day, appSeconds: 0, spanSeconds: 0, sittings: 0, firstAt: null, lastAt: null, callSeconds: 0, calls: 0,
      };
      existing.callSeconds += num(row.callSeconds);
      existing.calls += num(row.calls);
      // The day's span is the whole day's activity, so a call before the first beat or after the
      // last one widens it. Wall clock, unlike the hours above it, which is what it is for.
      const firstCall = at(row.firstAt);
      const lastCall = at(row.lastAt);
      if (firstCall && (!existing.firstAt || firstCall < existing.firstAt)) existing.firstAt = firstCall;
      if (lastCall && (!existing.lastAt || lastCall > existing.lastAt)) existing.lastAt = lastCall;
      byKey.set(key, existing);
    }

    const merged = [...byKey.values()].map((row) => {
      /*
       * Idle: the gaps between the application's own stretches.
       *
       * Measured against the application half alone rather than against Work Hours, and the
       * difference matters now that Work Hours can exceed the day. `span` from the query is the
       * browser's first beat to its last; a call outside that widens the row's *displayed* span but
       * must not create idle time out of a stretch of the day nobody was signed in for.
       *
       * Never negative: worked can exceed the browser's own span only if two stretches overlap,
       * which one browser cannot produce but two tabs, or one account signed in twice, can.
       */
      const idleSeconds = Math.max(0, num(row.spanSeconds) - row.appSeconds);
      // Wall clock across both halves, and never shorter than the application half it contains.
      const span = row.firstAt && row.lastAt
        ? Math.max(0, Math.round((row.lastAt - row.firstAt) / 1000), num(row.spanSeconds))
        : Math.max(num(row.spanSeconds), row.appSeconds);
      const worked = row.appSeconds + row.callSeconds;
      return {
        employee: row.employee,
        day: row.day,
        // The application half, named for what it is. It is the same measure the Application Usage
        // report shows, so the two screens can be read against each other.
        appSeconds: row.appSeconds,
        appUsage: hoursMinutes(row.appSeconds),
        // The phone half, from Callyzer.
        callSeconds: row.callSeconds,
        callHours: hoursMinutes(row.callSeconds),
        calls: row.calls,
        // The two together: the column this report is named for. Added here rather than in the
        // browser so the row cannot disagree with its own parts.
        workedSeconds: worked,
        worked: hoursMinutes(worked),
        idleSeconds,
        idle: hoursMinutes(idleSeconds),
        spanSeconds: span,
        span: hoursMinutes(span),
        sittings: row.sittings,
        firstAt: row.firstAt ? row.firstAt.toISOString() : null,
        lastAt: row.lastAt ? row.lastAt.toISOString() : null,
      };
    });

    // The order the SQL asked for, reapplied over the merged set: newest day first, then the
    // longest day, then by name. A day that arrived only from the call log has to be sorted into
    // the same list rather than appended after it.
    merged.sort((first, second) => (
      second.day.localeCompare(first.day)
      || second.workedSeconds - first.workedSeconds
      || first.employee.localeCompare(second.employee)
    ));

    return { filters: clean, ignored, rows: merged };
  } catch (error) {
    // An older database has no `app_usage_session` at all, and a studio that has not run the
    // application since it was added has no rows in it. Either is an empty timesheet, not a page
    // that fails to open.
    console.warn("Unable to build the work hours report:", error?.message || error);
    return { filters: clean, ignored, rows: [] };
  }
}

const REPORTS = {
  summary,
  "employee-analysis": employeeAnalysis,
  "lead-analysis": leadAnalysis,
  "never-attended": neverAttended,
  "not-picked-up": notPickedUp,
  "call-history": callHistory,
  "whatsapp-usage": whatsappUsage,
  "application-usage": applicationUsage,
  "work-hours": workHours,
};

module.exports = {
  REPORTS, reportOptions, repositoryEmployees, resolveEmployeeFilter, duration,
  summary, employeeAnalysis, leadAnalysis, neverAttended, notPickedUp, callHistory,
  whatsappUsage, applicationUsage, workHours,
  // The measured-time read behind both usage reports, exported for the tests that stub the database.
  measuredUsage,
  // Who a call may be attributed to. Exported for the tests, which hold the label and the test to
  // each other - the two have to name the same people or a row appears under a name it excludes.
  staffIdentity, staffCallSql,
};
