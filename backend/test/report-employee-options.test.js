const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { repositoryEmployees, resolveEmployeeFilter, staffIdentity, staffCallSql, employeeAnalysis } = require("../src/modules/sales/crm-reports/service");
const { buildWhere } = require("../src/modules/sales/crm-reports/filters");
const { WORKING_STATUSES } = require("../src/modules/hrm/employees/read.service");
const { numberKey } = require("../src/modules/sales/crm-leads/callLogService");

/*
 * Who the Reports & Analytics Employee filter offers.
 *
 * It used to be `SELECT DISTINCT employee_name FROM sales_crm_call_log` - whoever the Callyzer call
 * box had ever named. That is a list nobody maintains and nobody can correct: a handset labelled
 * with a typo became a permanent option beside the correct spelling ("Another Employee" and "Another
 * Emplyoee" sat next to each other in the studio's own dropdown), a client's name recorded against
 * an outgoing call became an "employee", and somebody who left years ago stayed on it forever.
 * There is nowhere to fix any of that, because the source is a call record.
 *
 * The Employee Repository is the studio's answer to "who works here", and a name corrected there is
 * corrected here. "Who works here" is the working statuses and nothing else: a row exists from the
 * moment HR sends an onboarding invite and stays after somebody leaves, so offering every row put
 * half-finished invites and everyone who has ever left in front of the studio on every report.
 *
 * The half that is easy to get wrong is the filter still landing afterwards. Callyzer labels a call
 * with whatever the handset is called, so matching the repository's spelling alone would answer "no
 * calls" for somebody who has made hundreds - the resolver puts their contact number in the query
 * beside the name.
 *
 * Needs MySQL, like test/iam.test.js. The rows it makes are its own and are removed either way.
 */

const STAMP = `ZZREP-${Date.now()}`;
const NAME = `${STAMP} Camera Op`;
const NUMBER = `+91 9${String(Date.now()).slice(-9)}`;
// The two rows the repository holds that are not somebody working here: an invite HR has sent and
// nobody has filled in, and a colleague who has left. Neither belongs in the filter.
const PENDING_NAME = `${STAMP} Not Onboarded`;
const LEFT_NAME = `${STAMP} Left Last Year`;
// Working here, but not Active: this screen asks for the people actually working now and nobody
// else, which is narrower than every other picker in the application.
const TRAINING_NAME = `${STAMP} Still Learning`;

test.before(async () => {
  await prisma.employee.create({ data: { employeeId: STAMP, employeeName: NAME, contactNumber: NUMBER, employmentStatus: "Active" } });
  await prisma.employee.create({ data: { employeeId: `${STAMP}-P`, employeeName: PENDING_NAME, contactNumber: NUMBER, employmentStatus: "HR Onboarding Pending" } });
  await prisma.employee.create({ data: { employeeId: `${STAMP}-L`, employeeName: LEFT_NAME, contactNumber: NUMBER, employmentStatus: "Relieved" } });
  await prisma.employee.create({ data: { employeeId: `${STAMP}-T`, employeeName: TRAINING_NAME, contactNumber: NUMBER, employmentStatus: "in Training" } });
});

test.after(async () => {
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: STAMP } } });
  await prisma.$disconnect();
});

test("the filter offers the studio's own employees", async () => {
  const offered = await repositoryEmployees();
  const mine = offered.find((option) => option.value === NAME);
  assert.ok(mine, "an employee in the repository is not offered by the report filter");
  assert.equal(mine.label, NAME);
  // The number rides along, because it is what makes the filter land on Callyzer's rows.
  assert.equal(mine.number, NUMBER);
});

test("nothing the call box invented is offered", async () => {
  /*
   * The property, rather than a list of the particular junk names this studio collected: every
   * option must be a name the repository holds. A name that appears only in the call log - a
   * mislabelled handset, a client recorded on an outgoing call - is not an employee.
   */
  // Employees are read before and after the filter: the suite runs in parallel, and another file's
  // fixture employee can be made or removed between two reads. A name that was an employee at either
  // moment is one; a name the call box invented is in neither.
  const names = async () => (await prisma.employee.findMany({ select: { employeeName: true } })).map((row) => String(row.employeeName || "").trim());
  const before = await names();
  const offered = await repositoryEmployees();
  if (offered.length === 0) return;
  const known = new Set([...before, ...(await names())]);
  const strangers = offered.map((option) => option.value).filter((value) => !known.has(value));
  assert.deepEqual(strangers, [], "the Employee filter is offering names that are in no employee record");
});

test("only the people working here are offered", async () => {
  /*
   * A row exists in the repository from the moment HR sends an onboarding invite, and it stays after
   * somebody leaves - so "every employee record" is not the same list as "the studio's employees".
   * The filter offers the second: the statuses HR's own Active tab is cut from. Anything else made
   * the dropdown a list the studio had to scroll past to reach whoever they were reporting on.
   */
  const offered = new Set((await repositoryEmployees()).map((option) => option.value));
  assert.ok(offered.has(NAME), "an active employee is missing from the report filter");
  assert.ok(!offered.has(PENDING_NAME), "somebody who has not finished onboarding is offered as an employee");
  assert.ok(!offered.has(LEFT_NAME), "somebody who has left the studio is still offered");

  // The property behind the three assertions above, over whatever else this studio holds.
  const working = new Set((await prisma.employee.findMany({
    where: { archivedAt: null, employmentStatus: { in: WORKING_STATUSES } },
    select: { employeeName: true },
  })).map((row) => String(row.employeeName || "").trim()));
  for (const name of offered) {
    assert.ok(working.has(name), `"${name}" is offered by the Employee filter but is not working at the studio`);
  }
});

/*
 * And **Active alone** on this screen, which is narrower than the three working statuses every other
 * picker offers (DATA-SCOPE.md D23). A report is read to judge somebody's week; a name that is still
 * in training or on a plan is not a week anybody is judging yet, and the studio asked for a list of
 * the people actually working now.
 *
 * `staffIdentity` below deliberately keeps the wider list: choosing a name and attributing a call
 * are different questions, and somebody in training who spent the week on the phone made those
 * calls.
 */
test("only Active employees are offered, not everybody working here", async () => {
  const offered = new Set((await repositoryEmployees()).map((option) => option.value));
  assert.ok(offered.has(NAME));
  assert.ok(!offered.has(TRAINING_NAME), "somebody in training is offered by the report's Employee filter");

  const active = new Set((await prisma.employee.findMany({
    where: { archivedAt: null, employmentStatus: "Active" },
    select: { employeeName: true },
  })).map((row) => String(row.employeeName || "").trim()));
  // Other suites create and remove employees in parallel, so a name missing from the second read
  // only fails when it still exists: one deleted in between was Active when it was offered.
  const stillThere = new Set((await prisma.employee.findMany({
    where: { employeeName: { in: [...offered].filter((name) => !active.has(name)) } },
    select: { employeeName: true },
  })).map((row) => String(row.employeeName || "").trim()));
  for (const name of offered) {
    assert.ok(active.has(name) || !stillThere.has(name), `"${name}" is offered by the Employee filter and is not an Active employee`);
  }

  // A call made from that person's handset is still theirs, and still attributable.
  const identity = await staffIdentity();
  assert.ok(identity.names.includes(TRAINING_NAME), "a call made by somebody in training is attributable to nobody");
});

test("no employee is offered twice", async () => {
  // The filter matches on the name, so two options with one name would be two entries doing exactly
  // the same thing - which is what the old call-log list produced for every re-spelled handset.
  const offered = await repositoryEmployees();
  assert.equal(new Set(offered.map((option) => option.value)).size, offered.length);
});

test("choosing an employee searches for the calls matched to them, and their name and number", async () => {
  const resolved = await resolveEmployeeFilter({ employee: NAME });
  assert.ok(Array.isArray(resolved.employeeIds) && resolved.employeeIds.length, "the chosen employee's id was not resolved");
  assert.deepEqual(resolved.employeeNumbers, [NUMBER], "the chosen employee's number was not resolved");

  /*
   * The **id** first, because that is what a call actually carries.
   *
   * `matched_employee_id` is what the webhook worked out when the call was delivered - Callyzer's
   * Employee Code against the repository's code, then the handset's label. Without it the filter
   * compared the repository's spelling against whatever the phone happened to be named in the
   * Callyzer app, so choosing somebody whose handset is labelled anything else answered "no calls"
   * however many they had made.
   *
   * The name and number stay beside it: a handset the match could not place carries no id, and the
   * label is then both the only thing to filter it by and the name the report shows for it.
   */
  const { sql, params } = buildWhere(resolved);
  assert.match(sql, /`c`\.`matched_employee_id` IN \(\?\) OR `c`\.`employee_number` IN \(\?\) OR `c`\.`employee_name` IN \(\?\) OR `c`\.`employee_number` IN \(\?\)/);
  assert.deepEqual(params, [resolved.employeeIds[0], NAME, NAME, NUMBER], "the values are no longer bound in the order the tests were written");
});

test("an id the caller supplies is not taken as the employee's own", async () => {
  /*
   * The same rule `employeeNumbers` keeps below. `employeeIds` is derived from the repository under
   * this reader's scope, so a caller putting it on the query string must not be able to name a
   * colleague's id and read their calls - which, unlike the number, would actually work.
   */
  const resolved = await resolveEmployeeFilter({ employee: NAME, employeeIds: [999999] });
  assert.ok(!resolved.employeeIds.includes(999999), "an id from the query string reached the filter");

  const noEmployee = await resolveEmployeeFilter({ employeeIds: [999999] });
  assert.equal(noEmployee.employeeIds, undefined);
});

test("a number the caller supplies is not taken as the employee's own", async () => {
  /*
   * `employeeNumbers` is derived from the repository, so a caller putting it on the query string
   * must not be able to write it. It grants nothing - the same rows are reachable by filtering on
   * the number directly - but a field the server owns should be written only by the server.
   */
  const resolved = await resolveEmployeeFilter({ employee: NAME, employeeNumbers: ["+91 0000000000"] });
  assert.deepEqual(resolved.employeeNumbers, [NUMBER]);

  const noEmployee = await resolveEmployeeFilter({ employeeNumbers: ["+91 0000000000"] });
  assert.equal(noEmployee.employeeNumbers, undefined);
});

test("a value that matches no employee is still answerable", async () => {
  // A number typed into a saved link, or a name from before the repository had that person: it is
  // passed through and matched as it always was, rather than being dropped.
  const resolved = await resolveEmployeeFilter({ employee: "9876500000" });
  assert.equal(resolved.employee, "9876500000");
  const { params } = buildWhere(resolved);
  assert.deepEqual(params, ["9876500000", "9876500000"]);
});

/* ------------------------------------------- and the tables, not only the dropdown above them */

/*
 * The Employee filter was only half of the studio's complaint. Employee Analysis, Work Hours and the
 * call half of WhatsApp Usage all grouped the call log by `employee_name` - whatever the handset was
 * labelled in the Callyzer app - so the tables listed people the dropdown above them refused to
 * offer: "Manjula DBS" beside "Manjula Donkena", "Deploy Check" beside both, one row per label
 * anybody had ever typed into a phone.
 *
 * `staffCallSql` is the one answer to "whose call is this", used by all three. It has two halves
 * that must agree: `where` decides whether a call is on anybody's row, and `nameExpr` decides whose.
 */

test("a call is kept for the employee it was matched to, by id", async () => {
  /*
   * By id, not by name and not by number.
   *
   * The number half could never match: Callyzer reports the company SIM and the repository holds
   * the employee's own number, so the two never meet. The name half made the report decide whose
   * call this was, from the handset's label, every time it was run. The webhook decides it once now
   * - Callyzer's Employee Code against the repository's code, then the label - and writes the id.
   */
  const { where, whereParams } = staffCallSql({ ids: [11, 22] });
  assert.match(where, /`c`\.`matched_employee_id` IN \(\?, \?\)/);
  assert.deepEqual(whereParams, [11, 22]);
  assert.doesNotMatch(where, /employee_number/, "a call is still kept by a number the repository cannot hold");
});

test("a handset is shown under the repository's own spelling", async () => {
  /*
   * Read from the joined employee, so a person renamed in the repository is renamed on every report
   * at once - including on the calls they made before. It binds nothing: this used to be a CASE with
   * a branch per employee, bound on every query.
   */
  const { nameExpr, nameParams } = staffCallSql({ ids: [11] });
  assert.match(nameExpr, /`e`\.`employee_name`/, "the report no longer reads the repository's name");
  assert.deepEqual(nameParams, [], "the label still binds parameters of its own");
  // And Callyzer's label for a call matched to nobody - the join is LEFT, so there is nothing else.
  assert.match(nameExpr, /COALESCE\(NULLIF\(TRIM\(`e`\.`employee_name`\), ''\), TRIM\(COALESCE\(`c`\.`employee_name`, ''\)\)\)/);
});

/*
 * A handset matched to nobody, for the reader who may see the whole studio.
 *
 * Its calls were on no row at all: a phone Callyzer names but the repository cannot place simply did
 * not appear, and the studio's totals were short by every call it had made. `nameExpr` has always had
 * a label for such a call; it was `where` that dropped it before the label was reached.
 */
test("an unmatched handset is shown to an unlimited reader, under its own label", async () => {
  const { where, whereParams } = staffCallSql({ ids: [11], unlimited: true });
  assert.match(where, /`c`\.`matched_employee_id` IS NULL AND TRIM\(COALESCE\(`c`\.`employee_name`, ''\)\) <> ''/);
  assert.deepEqual(whereParams, [11], "the relaxation binds nothing of its own");
});

/*
 * `ids` is already narrowed to the people this reader may see, so it does two jobs at once: naming
 * the studio's staff, and keeping one branch's calls off another branch's report. Relaxing it for a
 * narrowed reader would undo the second - and a call matched to nobody is in no branch and on no
 * team, so there is nothing to narrow it by.
 */
test("a narrowed reader is not shown handsets belonging to nobody they manage", async () => {
  const { where } = staffCallSql({ ids: [11] });
  assert.doesNotMatch(where, /IS NULL/, "a scoped reader reaches every unmatched handset in the studio");
  // The default is the narrow one, so a caller that forgets to say cannot widen it by accident.
  assert.equal(staffCallSql({ ids: [11] }).where, staffCallSql({ ids: [11], unlimited: false }).where);
});

test("a repository nobody has filled in reports on nobody, rather than on the call box", async () => {
  /*
   * `1 = 0` and not `1 = 1`. Nothing is matched when the repository is empty, so these tables are
   * empty - the honest state of a studio that has added no employees, and the same answer the filter
   * gives by offering nothing. Falling back to the handset labels would put the whole of the old
   * behaviour back the moment the repository was empty, for an unlimited reader too.
   */
  assert.equal(staffCallSql({ ids: [] }).where, "1 = 0");
  assert.deepEqual(staffCallSql({ ids: [] }).whereParams, []);
  assert.equal(staffCallSql({ ids: [], unlimited: true }).where, "1 = 0");
});

test("Employee Analysis names every call it shows, and resolves a handset it can", async () => {
  /*
   * The property, over whatever this database actually holds. Run against the real query rather than
   * the SQL builder, because the label and the test are separate expressions and only the assembled
   * statement proves they agree.
   *
   * It used to be "every name on the table is somebody working here", and a handset the repository
   * did not hold was on no row at all - so the studio's totals were short by every call such a phone
   * had made. An unlimited reader is now shown those calls under the handset's own label, which is
   * what `nameExpr` had always fallen back to; what has to stay true is that a handset the repository
   * *can* place is still placed, rather than appearing twice under two spellings.
   */
  const { rows } = await employeeAnalysis({ from: "2000-01-01", to: "2100-01-01" });
  const { names, byNumber } = await staffIdentity();
  const working = new Set(names);

  for (const row of rows) {
    assert.ok(String(row.employee || "").trim(), "Employee Analysis has a row headed by nothing");
    if (working.has(row.employee)) continue;

    // Not one of ours, so it has to be a handset label that is really in the log - never a stray
    // grouping the query invented.
    const [handset] = await prisma.$queryRawUnsafe(
      "SELECT `employee_number` FROM `sales_crm_call_log` WHERE TRIM(COALESCE(`employee_name`, '')) = ? LIMIT 1",
      row.employee,
    );
    assert.ok(handset, `Employee Analysis has a row for "${row.employee}", who is neither an employee nor a handset in the log`);

    // And it is unplaceable, rather than merely unplaced: a number the repository holds must have
    // been resolved to that person's name by `nameExpr`, not left under the handset's own spelling.
    const key = numberKey(handset.employee_number);
    assert.ok(
      !key || !byNumber.has(key),
      `"${row.employee}" is the repository's ${byNumber.get(key)} by number, and should read under that name`,
    );
  }
});
