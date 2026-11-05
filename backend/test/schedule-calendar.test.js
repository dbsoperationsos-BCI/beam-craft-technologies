const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SOURCES, listSchedule } = require("../src/modules/schedule/calendar/service");

/*
 * The studio calendar reads three modules' bookings into one grid. Three things can go wrong
 * there, and none of them announce themselves:
 *
 *   * a source added without a permission, which turns the calendar into a way around the guard on
 *     the board the booking lives on;
 *   * an entry that carries neither a day nor an instant, which is simply never drawn;
 *   * a whole-day booking sent as a timestamp, which lands on the wrong day for every viewer west
 *     of Greenwich and still looks like a perfectly good calendar.
 *
 * `listSchedule` takes its permission check as an argument, so the scoping can be tested with a
 * stub and no database at all.
 */

const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "schedule", "calendar", "service.js"), "utf8");

/* -------------------------------------------------------- nobody sees what they may not read */

test("every source names the permission its own module enforces", () => {
  assert.ok(SOURCES.length >= 3, "the calendar is meant to read across the modules, not one of them");
  for (const source of SOURCES) {
    /*
     * `always` is the one way out of this, and two sources are allowed to take it.
     *
     * Both are facts about the studio rather than records belonging to one person: the office is
     * shut on the 20th whoever is asking, and a team is out shooting on Saturday whoever is asking.
     * Neither has a scope to narrow or anything a permission here would protect. Every other source
     * draws somebody's records, and naming the two is what stops a source being added later with
     * `always` on it as the quick way past this test.
     */
    if (source.always) {
      assert.ok(["holiday", "shoot"].includes(source.key), `source "${source.key}" is ungated and is not one of the sources allowed to be`);
      continue;
    }
    const required = source.anyOf || [{ module: source.module, feature: source.feature }];
    assert.ok(required.length > 0, `source "${source.key}" declares no permission, so its bookings would be read for anybody`);
    for (const permission of required) {
      assert.ok(permission.module, `source "${source.key}" has no module`);
      assert.ok(permission.feature, `source "${source.key}" has no feature`);
    }
  }
});

test("the permissions are ones the catalogue can actually grant", () => {
  // Read rather than scraped. This matched `module:` and `feature:` on consecutive lines in the
  // seed, which stopped finding anything the moment the catalogue moved into a module of its own -
  // and a catalogue that reads as empty makes every assertion below vacuously true.
  const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
  const catalogue = new Set(PERMISSIONS.map((permission) => `${permission.module}:${permission.feature}`));
  assert.ok(catalogue.size > 5, "the permission catalogue could not be read");

  for (const source of SOURCES) {
    if (source.always) continue;
    const required = source.anyOf || [{ module: source.module, feature: source.feature }];
    for (const permission of required) {
      assert.ok(
        catalogue.has(`${permission.module}:${permission.feature}`),
        `source "${source.key}" answers for ${permission.module}:${permission.feature}, which is not in iam-roles-permissions.js`,
      );
    }
  }
  /*
   * The holidays source names no permission, because it has no audience to narrow to - but the
   * screen that *writes* the list does, and it has to be grantable or nobody but a Super Admin
   * could ever declare a holiday for the calendar to draw. See `modules/settings/holidays`.
   */
  assert.ok(catalogue.has("SETTINGS:Holidays"), "the holidays Settings screen answers for a permission the catalogue cannot grant");
});

test("a source is not even queried for somebody who may not read it", async () => {
  // The strongest form of the guard: not "filtered out afterwards" but never loaded, so a viewer
  // without Project Management cannot have a shoot reach them by any route.
  const loaded = [];
  const stub = SOURCES.map((source) => ({ ...source, load: async () => { loaded.push(source.key); return []; } }));
  const original = SOURCES.splice(0, SOURCES.length, ...stub);
  try {
    const crmOnly = await listSchedule({ can: async ({ module, feature }) => module === "SALES" && feature === "CRM Leads" });
    // CRM Leads reaches the meetings; it is none of the four the shoots now name, so the shoots are
    // not even queried for this viewer.
    assert.deepEqual(loaded, ["holiday", "meeting"]);
    assert.deepEqual(crmOnly.kinds, ["holiday", "meeting"]);

    loaded.length = 0;
    const nobody = await listSchedule({ can: async () => false });
    /*
     * The holidays and the shoots, and nothing else.
     *
     * An employee holding no module permission at all still gets a month with the days the studio is
     * closed on it - the studio being shut is the same fact for everybody. The **shoots** are not
     * theirs: the studio's rule is that the wide permissions see every shoot, Production sees the
     * ones that person is named on, and somebody holding neither sees none. Nothing else is even
     * queried for them, and an otherwise empty calendar is the correct answer rather than a failure -
     * `unavailable` stays empty.
     */
    assert.deepEqual(loaded, ["holiday"], "a viewer holding nothing is still owed the holidays");
    assert.deepEqual(nobody.kinds, ["holiday"]);
    assert.deepEqual(nobody.unavailable, []);
  } finally {
    SOURCES.splice(0, SOURCES.length, ...original);
  }
});

test("who sees which shoots: the wide permissions see them all, Production sees its own, nobody else sees any", () => {
  /*
   * The studio's rule, in three readings:
   *
   *   - **Projects, Pre Production or Bookings & Converted** - the permissions about the studio's
   *     work as a whole - see every shoot;
   *   - **Production alone** sees the shoots that person is **named on**, which is their roster;
   *   - **neither** sees no shoots at all.
   *
   * It was `always` - every signed-in employee saw every shoot, on the grounds that a driver or
   * somebody in accounts should be able to see a team was out. The studio's answer is the one
   * above, so the source names its permissions again and the narrowing happens inside it.
   */
  const shoots = SOURCES.find((source) => source.key === "shoot");
  assert.equal(shoots.always, undefined, "no longer a source everybody sees the whole of");
  assert.deepEqual(shoots.anyOf, [
    { module: "PROJECT", feature: "Projects" },
    { module: "PROJECT", feature: "Pre Production" },
    { module: "SALES", feature: "Sales Manager" },
    { module: "PROJECT", feature: "Production" },
  ]);
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "schedule", "calendar", "service.js"), "utf8");
  // Holding any of the wide three is the whole board; only somebody who holds none of them is
  // narrowed, to their own shoots - the Shoot Board's `boardWhere` only for who sees the whole board.
  assert.match(service, /const \{ boardWhere \} = require\("\.\.\/\.\.\/project-management\/shoot-board\/read"\);/);
  assert.match(service, /if \(!wide\.some\(Boolean\)\) \{\s*\n\s*named = await ownShootsWhere\(viewer\?\.userId\);\s*\n\s*if \(!named\) return \[\];/);
  assert.match(service, /where: \{ deletedAt: null, project: \{ deletedAt: null \}, \.\.\.named,/);
});

test("opening a shoot is still somebody's permission, and the calendar hands over what decides it", () => {
  /*
   * Seeing and opening are different questions. The window a shoot opens into - the Production
   * panel - answers to `PROJECT / Production` and needs the production record's own id, which the
   * calendar never sent because nothing here opened it before.
   */
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "schedule", "calendar", "service.js"), "utf8");
  assert.match(service, /production: \{ select: \{ id: true, planSubmittedAt: true/);
  assert.match(service, /productionShootId: shoot\.production\?\.id \?\? null,/);
});

/* ------------------------------------------------------- one bad source does not empty the day */

test("a source that fails is named rather than silently missing", async () => {
  const stub = SOURCES.map((source) => ({
    ...source,
    load: source.key === "shoot"
      ? async () => { throw new Error("board is down"); }
      : async () => [{ id: `${source.key}:1`, kind: source.key, title: "x", day: "2026-09-02" }],
  }));
  const original = SOURCES.splice(0, SOURCES.length, ...stub);
  try {
    const result = await listSchedule({ can: async () => true });
    // The others still arrive: a calendar short of one module is better than an empty one.
    assert.deepEqual(result.entries.map((entry) => entry.kind), ["holiday", "block", "meeting", "interview", "attendance"]);
    // And it says which is missing, because a day quietly short of its shoots is worse than a day
    // that admits it could not read them.
    assert.deepEqual(result.unavailable, ["shoot"]);
  } finally {
    SOURCES.splice(0, SOURCES.length, ...original);
  }
});

/* ------------------------------------------------------------------- days stay on their day */

test("a booking made by the day is sent as text, never as a timestamp", () => {
  /*
   * `dayOf` slices the stored date rather than handing over an instant. A shoot stored as
   * 2026-09-01T00:00:00Z sent as an instant is 31 August in the Americas, and the browser would
   * draw it one cell to the left - which is the exact fault `dayKey`'s own comment describes.
   */
  assert.match(SERVICE, /const dayOf = \(value\) => \{[\s\S]*?toISOString\(\)\.slice\(0, 10\)/);
  // Shoots and main events are day-based and carry no instant...
  assert.match(SERVICE, /kind: "shoot",[\s\S]*?day: dayOf\(shoot\.dateCreated\),\s*\n[\s\S]*?startAt: null/);
  // A project's main event is not on the calendar: its shoots are.
  assert.doesNotMatch(SERVICE, /kind: "project"|key: "project"/);
  // ...and a meeting is the other way round: a real instant, with the browser placing the day.
  assert.match(SERVICE, /kind: "meeting",[\s\S]*?day: null,\s*\n\s*startAt: meeting\.startAt/);
});

test("a holiday is a day, belongs to nobody, and is offered to everybody", () => {
  /*
   * Three things about this source, each of which has its own way of going wrong:
   *
   *   * `always`, so the employee holding no module permission still sees that the office is shut;
   *   * `day: dayOf(...)`, because `holiday_date` is a `@db.Date` and sending it as an instant
   *     would draw Diwali on the 19th for every viewer west of Greenwich;
   *   * no owner, reference or subject, because a holiday is not somebody's booking - the details
   *     panel draws only the fields with a value, and a name is the whole of it.
   */
  const holidays = SOURCES.find((source) => source.key === "holiday");
  assert.ok(holidays, "the calendar no longer draws the studio's holidays");
  assert.equal(holidays.always, true);
  assert.equal(holidays.module, undefined, "a holiday is the same fact for everybody and takes no permission");
  assert.match(SERVICE, /kind: "holiday",[\s\S]*?day: dayOf\(holiday\.holidayDate\),\s*\n\s*startAt: null/);
  assert.match(SERVICE, /kind: "holiday",[\s\S]*?owner: "",/);
});

test("an interview answers for the register it is read out of, and lands on its own day", () => {
  /*
   * The calendar reads HR's register, so three things have to hold.
   *
   *   * `HRM / Interview` and nothing finer, because that is the whole of the guard the register's
   *     own router mounts - a screen may not be given a finer permission than the endpoint it
   *     reads, and a guard may only name a permission the catalogue can actually grant;
   *   * a **day**, never an instant. `interview_date` and `interview_time` are text columns filled
   *     by hand, by a CSV or by a linked sheet, so there is no instant behind them to send - and
   *     sending one would move a 10:30 am interview into the previous evening for a viewer far
   *     enough west;
   *   * the day is read with `toIsoDay` rather than compared in SQL. The column is text, so a
   *     `gte` / `lte` on it would be an alphabetical comparison - right for the ISO days the
   *     register writes and quietly wrong for a `09/09/2026` that reached the table before the
   *     column was normalised, which would vanish from every window it actually falls in.
   */
  const interviews = SOURCES.find((source) => source.key === "interview");
  assert.ok(interviews, "the calendar no longer draws the interviews HR has scheduled");
  assert.equal(interviews.module, "HRM");
  assert.equal(interviews.feature, "Interview");
  assert.equal(interviews.always, undefined, "the interview register is not everybody's business");
  assert.match(SERVICE, /kind: "interview",[\s\S]*?day,\s*\n\s*startAt: null/);
  assert.match(SERVICE, /const day = toIsoDay\(candidate\.interviewDate\);/);
  // And the hour travels as text beside it, twice: one to read, one to sort by.
  assert.match(SERVICE, /clock: toClockTime\(candidate\.interviewTime\)/);
  assert.match(SERVICE, /clock24: clock24\(candidate\.interviewTime\)/);
});

test("an interview's hour is sortable without ever going through a timezone", () => {
  /*
   * `clock24` is what the Time column sorts by. The printed "03:00 pm" cannot be sorted - it files
   * above "10:00 am" on the alphabet - and a `Date` cannot be used either, because a clock time
   * carries no day and no zone and a zone-aware formatter would shift it by the offset.
   */
  const body = /function clock24\(value\) \{([\s\S]*?)\n\}/.exec(SERVICE)?.[1] || "";
  assert.ok(body, "the calendar no longer has one reading of a stored interview hour");
  // Read through `toClockTime`, which is what the register normalises the column with on the way
  // in, so the two cannot read the same cell differently.
  assert.match(body, /toClockTime\(value\)/);
  assert.doesNotMatch(body, /new Date|Intl\./);
});

test("meetings are read through the meetings module rather than re-queried", () => {
  // The calendar must not have a second opinion about what a meeting is or which lead it is with -
  // nor about whose meetings they are, which is why the viewer travels with the window.
  assert.match(SERVICE, /const \{ listAllMeetings \} = require\("\.\.\/\.\.\/sales\/crm-meetings\/service"\);/);
  assert.match(SERVICE, /listAllMeetings\(\{ from, to, includeCancelled: false, reader: \{ userId: viewer\?\.userId, permissions \} \}\)/);
});

test("every source that reaches a project or a lead is handed who is asking", () => {
  /*
   * The calendar reads across modules, so it is the easiest place to serve rows a screen would
   * not. Each source gets the permissions that let it in and the viewer behind them; a source
   * added later that queries projects, shoots or meetings without them is the failure this pins.
   */
  assert.match(SERVICE, /permissions: source\.anyOf \|\| \[\{ module: source\.module, feature: source\.feature \}\]/);
  const loads = SERVICE.match(/async load\(\{[^}]*\}\)/g) || [];
  const reaching = loads.filter((signature) => /viewer/.test(signature));
  assert.ok(reaching.length >= 3, `expected the project, shoot and meeting sources to take the viewer, saw ${loads.join(" | ")}`);
});

test("each entry carries its branch - the lead's, the project's, the candidate's - and a holiday none", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "schedule", "calendar", "service.js"), "utf8");
  assert.match(source, /branchId: leadBranch\.get\(meeting\.enquiryId\) \?\? null/);
  assert.match(source, /branchId: shoot\.project\?\.branchId \?\? null/);
  assert.match(source, /branchId: candidate\.branchId \?\? null/);
  assert.match(source, /return \{ entries: await withBranches\(entries\)/);
});
