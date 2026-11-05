const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Prisma } = require("@prisma/client");
const { importColumns, rowSchema, parseDate, parseTime, parseYesNo, parseLink, parseProjectStatus, VERTICALS } = require("../src/modules/project-management/pre-production/importColumns");
const { importTableRows } = require("../src/services/tableImport");

/*
 * The template the studio downloads is written by the browser from `constants/importColumns.js`,
 * and the file it uploads is read here. The two lists are only right if they are the same list, so
 * the frontend's copy is evaluated as text (it is an ES module in another package) and compared.
 */
function frontendColumns(vertical) {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "constants", "importColumns.js"), "utf8");
  // eslint-disable-next-line no-new-func
  const load = new Function(`${source.replace(/^export /gm, "")}; return preProductionImportColumns;`);
  return load()(vertical);
}

test("each vertical's template matches the frontend's, heading for heading", () => {
  for (const vertical of VERTICALS) {
    const server = importColumns(vertical).map(({ field, label, required }) => ({ field, label, required: Boolean(required) }));
    assert.deepEqual(frontendColumns(vertical), server, vertical);
  }
});

test("only the wedding template asks Groom/Bride questions; Corp asks only the shared ones", () => {
  const labels = (vertical) => importColumns(vertical).map((column) => column.label);
  assert.ok(labels("WED").includes("Intro Call Groom"));
  assert.ok(!labels("QQ").includes("Intro Call Groom"));
  assert.ok(!labels("QQ").includes("Google Review"), "no longer asked on Pre Production");
  assert.ok(!labels("CORP").some((label) => ["Intro Call", "Google Review", "Preference"].includes(label)));
});

test("dates are read day first and impossible dates are refused", () => {
  assert.equal(parseDate("10-06-2026").toISOString(), "2026-06-10T00:00:00.000Z");
  assert.equal(parseDate("5/3/2026").toISOString(), "2026-03-05T00:00:00.000Z");
  assert.equal(parseDate("31-02-2026"), "31-02-2026");
  assert.equal(parseDate("2026-06-10"), "2026-06-10");
  // The day first, the month by name - as the old sheets write it.
  for (const [text, iso] of [["6 Sept 2026", "2026-09-06"], ["06 Sep 2026", "2026-09-06"], ["8-Aug-2026", "2026-08-08"], ["29-Aug -2026", "2026-08-29"], ["3 July 2026", "2026-07-03"], ["1st October 2026", "2026-10-01"]]) {
    assert.equal(parseDate(text).toISOString().slice(0, 10), iso, text);
  }
  // A month written first, a month that is not one, a day the month does not have: refused, never guessed.
  for (const text of ["June 5 2026", "7/31/2026", "6 Septx 2026", "31 Sept 2026"]) assert.equal(parseDate(text), text, text);
});

test("times and yes/no cells are read the way a sheet writes them", () => {
  assert.equal(parseTime("9:30"), "09:30");
  assert.equal(parseTime("6:15 PM"), "18:15");
  assert.equal(parseTime("12:00 AM"), "00:00");
  assert.equal(parseYesNo("YES"), true);
  assert.equal(parseYesNo("n"), false);
  // A cell that says neither comes in empty rather than refusing the row.
  assert.equal(parseYesNo("in bride home"), undefined);
  // The sheet's own clock times.
  for (const [cell, read] of [["11:00:00 AM", "11:00"], ["10.30 am", "10:30"], ["5.00AM", "05:00"], ["10. 00 am", "10:00"], ["11:OO AM", "11:00"], ["1:00 Pm (16-Nov-2026)", "13:00"], ["MIDNIGHT1:00 am", "01:00"], ["03 :00 Pm", "15:00"]]) {
    assert.equal(parseTime(cell), read, cell);
  }
  assert.equal(parseTime("Yet to start"), undefined);
});

test("the sheet's placeholders come in empty, in every column", () => {
  const columns = importColumns("WED");
  const of = (field) => columns.find((column) => column.field === field);
  for (const word of ["IN OLD SHEET", "WCR", "NA", "N/A", "n/a", "NIL", "#REF!", "TBD", "null"]) {
    for (const field of ["locationAddress", "studioStartDate", "reportingTime", "travelAccommodationNeeded", "locationLink", "district", "shootTypes"]) {
      assert.equal(of(field).parse(word), undefined, `${field}: ${word}`);
    }
  }
  // Real values are kept.
  assert.equal(of("locationAddress").parse("Golden Mahal, Erode"), "Golden Mahal, Erode");
});

test("links, Pending and Indian numbers are read the way the sheet writes them", () => {
  assert.equal(parseLink(":https://maps.app.goo.gl/abc"), "https://maps.app.goo.gl/abc");
  assert.equal(parseLink("Bride https://maps.app.goo.gl/a, Groom: https://maps.app.goo.gl/b"), "https://maps.app.goo.gl/a");
  assert.equal(parseLink("google.com/maps?q=17.66,80.88&z=17"), "https://google.com/maps?q=17.66,80.88&z=17");
  assert.equal(parseLink("Electronic city (blr)"), undefined);
  assert.equal(parseProjectStatus("Pending"), "In Progress");
  assert.equal(parseProjectStatus("Yet to Start"), "In Progress");
  assert.equal(parseProjectStatus("Completed"), "In Progress");
});

const HEADERS = importColumns("WED").map((column) => column.label);
const rowOf = (values) => HEADERS.map((label) => values[label] ?? "");
const GOOD = {
  "Event ID": "DBS-EVT-05044", "Client Name": "Wed CBE Ben - Angelin June 5th 2026", "Client Number": "+91 9876543210",
  Branch: "Coimbatore", "CRM Employee Code": "E001", "Pre Production Coordinator Employee Code": "E002",
  "Shoot ID": "DBS-SID-2519", "Shoot Name": "Wedding", "Shoot Place": "Hall", District: "Coimbatore", State: "Tamil Nadu",
  "Shoot Type": "Outdoor", "Session Timing": "Full Session",
};

async function run(values, { lenient = false } = {}) {
  const created = [];
  const result = await importTableRows({ headers: HEADERS, rows: [rowOf(values)], columns: importColumns("WED"), schema: rowSchema, create: async (row) => { created.push(row); }, lenient });
  return { result, created };
}

test("a good row reaches the creator with its cells already typed", async () => {
  const { result, created } = await run({ ...GOOD, "Shoot Date": "05-06-2026", "Site Visit": "Yes", "Intro Call Groom": "completed" });
  assert.equal(result.imported, 1, JSON.stringify(result.errors));
  assert.equal(created[0].dateCreated.toISOString(), "2026-06-05T00:00:00.000Z");
  assert.equal(created[0].siteVisit, true);
  assert.equal(created[0].introCallGroom, "Completed");
  assert.deepEqual(created[0].shootTypes, ["Outdoor / On-Location"]);
});

test("a bad cell is refused naming its column and saying how to write it", async () => {
  const cases = [
    [{ "Shoot Date": "June 5 2026" }, "Shoot Date: Enter the date as DD-MM-YYYY"],
    [{ "Intro Call Groom": "half" }, "Intro Call Groom: Enter Pending or Completed."],
    [{ "Project Status": "Finished" }, "Project Status: Use one of"],
    [{ "Shoot Name": "" }, "Shoot Name is required."],
  ];
  for (const [change, message] of cases) {
    const { result } = await run({ ...GOOD, ...change });
    assert.equal(result.imported, 0, message);
    assert.match(result.errors[0].message, new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

// ---- Which project a row lands on, and what it may change there ----

const projectScope = require("../src/services/projectScope");
const projects = require("../src/modules/sales/projects/controller");
// Stood in before the service is required: it takes `workingEmployeeStatuses` by destructuring.
require("../src/services/employeeOptionLists").workingEmployeeStatuses = async () => ["Active"];
const { projectForRow, resolvePeople, appShootFor, shootUpdate } = require("../src/modules/project-management/pre-production/import.service");

test("every people cell may be empty, CRM and Pre Production Coordinator included", async () => {
  // The old sheet leaves them, and the row is worth having without them: the headings stay part of the
  // template, so a file that drops the column is still refused, but an empty cell is not.
  const { result, created } = await run({ ...GOOD, "CRM Employee Code": "", "Pre Production Coordinator Employee Code": "" });
  assert.equal(result.imported, 1, JSON.stringify(result.errors));
  assert.equal(created[0].crmCode, undefined);
  assert.equal(created[0].preProductionCoordinatorCode, undefined);
});

test("a people cell links a working employee by code or exact name, and keeps anybody else's name as written", async () => {
  // E001 Asha works here; E009 Ravi has left; "Sudeep" is in the sheet but not in HRM at all.
  const staff = { E001: { id: 1, employeeName: "Asha" }, asha: { id: 1, employeeName: "Asha" }, E009: { id: 9, employeeName: "Ravi" } };
  const refs = { employee: (text) => (staff[text] ? { kind: text.startsWith("E") ? "employee-id" : "exact", target: staff[text] } : { kind: "unmatched" }) };
  const transaction = { employee: { findMany: async ({ where }) => where.id.in.filter((id) => id === 1).map((id) => ({ id, employeeName: "Asha" })) } };
  const people = await resolvePeople(transaction, {
    crmCode: "E001", projectManagerCode: "asha", preProductionCoordinatorCode: "Sudeep", creativeManagerCode: "E009",
  }, refs);
  const by = Object.fromEntries(people.map((person) => [person.field, { id: person.id, name: person.name }]));
  assert.deepEqual(by.crmCode, { id: 1, name: "Asha" });
  assert.deepEqual(by.projectManagerCode, { id: 1, name: "Asha" });
  assert.deepEqual(by.preProductionCoordinatorCode, { id: null, name: "Sudeep" });
  assert.deepEqual(by.creativeManagerCode, { id: null, name: "Ravi" });
});

/*
 * A transaction holding one project imported before (sheet Event ID DBS-EVT-1, branch "Erode TN",
 * project manager already named) and one typed into the app for client +91 9000000001. The caller
 * may reach only the ids in `reachable`; branch checks are recorded rather than run.
 */
function world({ reachable = [], branchCheck = async () => {}, typedVertical = "WED", extraNamed = [] } = {}) {
  const imported = { id: "p-imported", sheetEventId: "DBS-EVT-1", vertical: "WED", sourceBranch: "Erode TN", deletedAt: null, projectManagerEmployeeId: 9, preProductionCoordinatorEmployeeId: null };
  const typed = { id: "p-typed", eventId: "DBS-EVT-WED-ERD-000001", clientMainNumber: "+91 9000000001", whatsappGroupName: "WED ERD Aravindh & Yamini", vertical: typedVertical, verticalId: null, sheetEventId: null, deletedAt: null };
  const calls = { updates: [], creates: [], branchChecks: [] };
  const sameVertical = (limb) => limb.OR.some((option) => option.vertical?.in.includes(typed.vertical) || (option.verticalId && option.verticalId === typed.verticalId));
  const originals = { scope: projectScope.projectAccessWhere, branch: projects.validateSourceBranch };
  projectScope.projectAccessWhere = async () => ({ id: { in: reachable } });
  projects.validateSourceBranch = async (tx, branch) => { calls.branchChecks.push(branch); await branchCheck(branch); };
  const transaction = {
    salesProject: {
      // By the sheet's Event ID, or by an Event ID - which the typed project holds.
      findUnique: async ({ where }) => (where.sheetEventId === imported.sheetEventId ? imported : where.eventId === typed.eventId ? typed : null),
      findFirst: async ({ where }) => {
        if (where.id) return reachable.includes(where.id) ? { id: where.id } : null;
        // The number-only lookup.
        return where.clientMainNumber === typed.clientMainNumber && sameVertical(where.AND[0]) ? typed : null;
      },
      // The name lookup. MySQL's collation compares the name without regard to case; the stand-in does the same.
      findMany: async ({ where }) => {
        const [vertical, name] = where.AND;
        const hit = sameVertical(vertical) && name.whatsappGroupName.in.some((value) => value.toLowerCase() === typed.whatsappGroupName.toLowerCase());
        return hit ? [typed, ...extraNamed] : [];
      },
      update: async (args) => { calls.updates.push(args); return { ...(args.where.id === typed.id ? typed : imported), ...args.data }; },
      create: async (args) => { calls.creates.push(args); return { id: "p-new", ...args.data }; },
    },
  };
  const refs = { branchName: (value) => value, branchId: () => 5, verticalId: () => 1 };
  const restore = () => { projectScope.projectAccessWhere = originals.scope; projects.validateSourceBranch = originals.branch; };
  return { transaction, refs, calls, restore };
}

const PM = { idField: "projectManagerEmployeeId", nameField: "projectManager", id: 11, name: "New PM" };
const PPC = { idField: "preProductionCoordinatorEmployeeId", nameField: "preProductionCoordinator", id: 12, name: "Asha" };
const rowFor = (overrides = {}) => ({ sheetEventId: "DBS-EVT-1", whatsappGroupName: "Wed ERD A - B", sourceBranch: "Coimbatore", ...overrides });

test("a row cannot reach a project outside the caller's scope by quoting its Event ID", async () => {
  const { transaction, refs, calls, restore } = world({ reachable: [] });
  try {
    await assert.rejects(
      projectForRow(transaction, { vertical: "WED", row: rowFor(), userId: 1, refs, people: [], clientMainNumber: "+91 9000000002" }),
      /DBS-EVT-1 is not a project you can update/,
    );
    assert.equal(calls.updates.length, 0);
  } finally { restore(); }
});

test("an existing project is checked against its own branch, not the row's", async () => {
  const { transaction, refs, calls, restore } = world({ reachable: ["p-imported"], branchCheck: async (branch) => { if (branch === "Erode TN") throw new Error("You cannot file a project against that branch."); } });
  try {
    await assert.rejects(
      projectForRow(transaction, { vertical: "WED", row: rowFor({ sourceBranch: "Coimbatore" }), userId: 1, refs, people: [], clientMainNumber: "+91 9000000002" }),
      /cannot file a project against that branch/,
    );
    assert.deepEqual(calls.branchChecks, ["Erode TN"]);
    assert.equal(calls.updates.length, 0);
  } finally { restore(); }
});

test("a second upload names people only where nobody is, and never moves the status", async () => {
  const { transaction, refs, calls, restore } = world({ reachable: ["p-imported"] });
  try {
    await projectForRow(transaction, { vertical: "WED", row: rowFor({ projectStatus: "Delivered" }), userId: 1, refs, people: [PM, PPC], clientMainNumber: "+91 9000000002" });
    const { data } = calls.updates[0];
    assert.equal(data.projectManagerEmployeeId, undefined, "the named project manager was replaced");
    assert.equal(data.preProductionCoordinatorEmployeeId, 12);
    assert.equal(data.preProductionCoordinator, "Asha");
    assert.equal(data.projectStatus, undefined);
  } finally { restore(); }
});

test("a client already typed into the app is refused, and named only to somebody who may see it", async () => {
  const hidden = world({ reachable: [] });
  try {
    await assert.rejects(
      projectForRow(hidden.transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-2" }), userId: 1, refs: hidden.refs, people: [], clientMainNumber: "+91 9000000001" }),
      (error) => /already has a project/.test(error.message) && !/DBS-EVT-WED/.test(error.message),
    );
  } finally { hidden.restore(); }
  const seen = world({ reachable: ["p-typed"] });
  try {
    await assert.rejects(
      projectForRow(seen.transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-2" }), userId: 1, refs: seen.refs, people: [], clientMainNumber: "+91 9000000001" }),
      /DBS-EVT-WED-ERD-000001/,
    );
    assert.equal(seen.calls.creates.length, 0);
  } finally { seen.restore(); }
});

test("a client typed in under the vertical's name rather than its code is still found", async () => {
  // Older bookings store "Dum Dum" where newer ones store WED; both are the same vertical.
  const legacy = world({ reachable: ["p-typed"], typedVertical: "Dum Dum" });
  try {
    await assert.rejects(
      projectForRow(legacy.transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-2" }), userId: 1, refs: legacy.refs, people: [], clientMainNumber: "+91 9000000001" }),
      /already on project DBS-EVT-WED-ERD-000001/,
    );
  } finally { legacy.restore(); }
});

test("a client typed into the app is found by its client name, whatever its capitals and spacing, and linked to the sheet", async () => {
  // Many old rows carry no number; the sheet's Client Name is the app's group name as written.
  const { transaction, refs, calls, restore } = world({ reachable: ["p-typed"] });
  try {
    const project = await projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-2", whatsappGroupName: "Wed Erd  Aravindh & Yamini" }), userId: 1, refs, people: [], clientMainNumber: "+91 9111111111" });
    // Nothing new is made: the app's project is kept, given the sheet's Event ID, then updated like any imported one.
    assert.equal(calls.creates.length, 0);
    assert.equal(project.id, "p-typed");
    assert.deepEqual(calls.updates[0].data, { sheetEventId: "DBS-EVT-2" });
    const second = calls.updates[1].data;
    // Both IDs kept: the app's Event ID is not renamed, and the sheet's was saved beside it.
    assert.equal("eventId" in second, false);
    // What the app already has is kept: its group name, and the number it holds (the sheet's differs).
    assert.equal("whatsappGroupName" in second, false);
    assert.equal("clientMainNumber" in second, false);
    assert.equal("initialConvertedValue" in second, false);
  } finally { restore(); }
});

test("a second upload fills a client's number and value only where they are empty, and never renames it", async () => {
  const { transaction, refs, calls, restore } = world({ reachable: ["p-typed"] });
  try {
    const original = transaction.salesProject.update;
    transaction.salesProject.update = async (args) => { const row = await original(args); return args.where.id === "p-typed" && args.data.sheetEventId ? { ...row, clientMainNumber: null, initialConvertedValue: 0 } : row; };
    await projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-2", whatsappGroupName: "Wed Erd  Aravindh & Yamini", initialConvertedValue: 55000 }), userId: 1, refs, people: [], clientMainNumber: "+91 9111111111" });
    const data = calls.updates.at(-1).data;
    assert.equal(data.clientMainNumber, "+91 9111111111");
    assert.equal(data.initialConvertedValue, 55000);
    assert.equal("whatsappGroupName" in data, false);
  } finally { restore(); }
});

// ---- A shoot added in the app is linked to the sheet's row, not copied ----

const appShoots = (...shoots) => ({ projectShoot: { findMany: async () => shoots } });
const rowShoot = (name, day) => ({ shoot: name, dateCreated: day ? new Date(`${day}T00:00:00.000Z`) : null });
const sheetRow = { sheetShootId: "DBS-SID-1" };

test("a shoot added in the app is taken as the sheet's row by its name, whatever date either side holds", async () => {
  const app = appShoots({ id: "s1", shoot: "Reception ", dateCreated: new Date("2026-08-26T11:30:00.000Z") }, { id: "s2", shoot: "Wedding", dateCreated: null });
  // The name alone, read without regard to capitals or spacing - the row then updates it, date included.
  assert.equal((await appShootFor(app, "p1", sheetRow, rowShoot("reception", "2026-09-04"))).id, "s1");
  assert.equal((await appShootFor(app, "p1", sheetRow, rowShoot("Wedding", "2026-08-26"))).id, "s2");
  assert.equal((await appShootFor(app, "p1", sheetRow, rowShoot("Reception", null))).id, "s1");
  // No shoot of that name: a new shoot is the answer.
  assert.equal(await appShootFor(appShoots({ id: "s2", shoot: "Wedding", dateCreated: null }), "p1", sheetRow, rowShoot("Rituals", "2026-08-26")), null);
});

test("several shoots of one name are told apart by the day, and otherwise taken in order", async () => {
  const three = appShoots(
    { id: "a", shoot: "Rituals", dateCreated: new Date("2026-08-26T00:00:00.000Z") },
    { id: "b", shoot: "Rituals", dateCreated: new Date("2026-08-27T00:00:00.000Z") },
    { id: "c", shoot: "Rituals", dateCreated: null },
  );
  assert.equal((await appShootFor(three, "p1", sheetRow, rowShoot("Rituals", "2026-08-27"))).id, "b");
  /*
   * No day to go by, or none of them on it: one with no date of its own is taken first, so a row of an
   * unknown day fills a blank rather than writing its day over a day the app already holds. The row is
   * never refused, so a booking's three Rituals rows pair with its three Rituals shoots one for one -
   * each shoot linked here carries the sheet's Shoot ID afterwards and is no longer offered.
   */
  for (const day of ["2026-09-01", null]) {
    assert.equal((await appShootFor(three, "p1", sheetRow, rowShoot("Rituals", day))).id, "c", String(day));
  }
  // All of them dated, none on the row's day: the first is taken, and the sheet's day replaces its own.
  const dated = appShoots({ id: "a", shoot: "Rituals", dateCreated: new Date("2026-08-26T00:00:00.000Z") }, { id: "b", shoot: "Rituals", dateCreated: new Date("2026-08-27T00:00:00.000Z") });
  assert.equal((await appShootFor(dated, "p1", sheetRow, rowShoot("Rituals", "2026-09-01"))).id, "a");
});

test("a re-upload writes what the sheet gave and never erases with an empty cell", () => {
  const row = { shoot: "Reception", shootPlace: "Erode" };
  const written = shootUpdate({ shoot: "Reception", dateCreated: null, shootPlace: "Erode", district: null, state: null, shootTypes: null, isMainEvent: false, preference: "Both", sessionDurationHours: null }, row);
  // A place the sheet gives replaces the shoot's, so a place-per-name it held is cleared with it.
  assert.deepEqual(written, { shoot: "Reception", shootPlace: "Erode", shootLocations: Prisma.DbNull });
  // Said in the sheet, it is written - including a "No" main event.
  const said = shootUpdate({ shoot: "Reception", isMainEvent: false, preference: "Bride" }, { isMainEvent: false, preference: "Bride" });
  assert.deepEqual(said, { shoot: "Reception", isMainEvent: false, preference: "Bride" });
});

test("the gifts, Storage Needed and their assignees reach the project, and are not overruled on one already there", async () => {
  const answers = { welcomeGift: "Applicable", shootCompletedGift: "Not Applicable", storageNeeded: "Yes" };
  const fresh = world();
  try {
    const giftee = { field: "shootCompletedGiftCode", idField: "shootCompletedGiftEmployeeId", nameField: "shootCompletedGiftAssignee", id: 12, name: "Asha" };
    await projectForRow(fresh.transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-3", ...answers }), userId: 1, refs: fresh.refs, people: [PPC, giftee], clientMainNumber: "+91 9000000003" });
    const { data } = fresh.calls.creates[0];
    assert.equal(data.welcomeGift, "Applicable");
    assert.equal(data.shootCompletedGift, "Not Applicable");
    assert.equal(data.storageNeeded, "Yes");
    // An Applicable gift is tracked from the start, which is what puts it on the Client Gifts tab.
    assert.equal(data.welcomeGiftStatus, "Yet To Sent");
    // A gift nobody is giving keeps no status and no assignee, even with a code in that column.
    assert.equal(data.shootCompletedGiftStatus, null);
    assert.equal(data.shootCompletedGiftAssignee, null);
    assert.equal(data.shootCompletedGiftEmployeeId, null);
  } finally { fresh.restore(); }
  // The app has already answered Welcome Gift: the sheet fills the two it has not answered, and leaves that one.
  const held = world({ reachable: ["p-imported"] });
  held.transaction.salesProject.findUnique = async ({ where }) => (where.sheetEventId === "DBS-EVT-1"
    ? { id: "p-imported", sheetEventId: "DBS-EVT-1", vertical: "WED", sourceBranch: "Erode TN", deletedAt: null, welcomeGift: "Not Applicable" }
    : null);
  try {
    await projectForRow(held.transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1", ...answers }), userId: 1, refs: held.refs, people: [], clientMainNumber: "+91 9000000009" });
    const { data } = held.calls.updates[0];
    assert.equal("welcomeGift" in data, false);
    assert.equal(data.shootCompletedGift, "Not Applicable");
    assert.equal(data.storageNeeded, "Yes");
  } finally { held.restore(); }
});

test("Date Created sets the project's own date, on a new booking and on one already there", async () => {
  const day = new Date("2026-06-05T00:00:00.000Z");
  const fresh = world();
  try {
    await projectForRow(fresh.transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-3", projectCreatedAt: day }), userId: 1, refs: fresh.refs, people: [PPC], clientMainNumber: "+91 9000000003" });
    assert.deepEqual(fresh.calls.creates[0].data.createdAt, day);
  } finally { fresh.restore(); }
  // Nothing in the app edits a project's date, so the sheet's is taken on a project already there too.
  const held = world({ reachable: ["p-imported"] });
  try {
    await projectForRow(held.transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1", projectCreatedAt: day }), userId: 1, refs: held.refs, people: [], clientMainNumber: "+91 9000000009" });
    assert.deepEqual(held.calls.updates[0].data.createdAt, day);
  } finally { held.restore(); }
  // Left empty, the project keeps the date it has.
  const blank = world({ reachable: ["p-imported"] });
  try {
    await projectForRow(blank.transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1" }), userId: 1, refs: blank.refs, people: [], clientMainNumber: "+91 9000000009" });
    assert.equal("createdAt" in blank.calls.updates[0].data, false);
  } finally { blank.restore(); }
});

test("a new booking is created under the sheet's Event ID, and starts", async () => {
  const { transaction, refs, calls, restore } = world();
  try {
    await projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-3" }), userId: 1, refs, people: [PPC], clientMainNumber: "+91 9000000003" });
    const { data } = calls.creates[0];
    assert.equal(data.eventId, "DBS-EVT-3");
    assert.equal(data.sheetEventId, "DBS-EVT-3");
    assert.equal(data.projectStatus, "In Progress");
    assert.equal(data.enquiryId, null);
    assert.equal(data.preProductionCoordinatorEmployeeId, 12);
    assert.deepEqual(calls.branchChecks, ["Coimbatore"]);
  } finally { restore(); }
});

test("a project already holding the row's Event ID keeps its own Event ID - the sheet's sits beside it", async () => {
  const { transaction, refs, calls, restore } = world({ reachable: ["p-imported"] });
  try {
    await projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1" }), userId: 1, refs, people: [], clientMainNumber: "+91 9000000009" });
    assert.equal("eventId" in calls.updates[0].data, false);
  } finally { restore(); }
});

test("a sheet Event ID another project already holds is refused by name", async () => {
  const { transaction, refs, calls, restore } = world();
  try {
    await assert.rejects(
      projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-WED-ERD-000001", whatsappGroupName: "Someone new" }), userId: 1, refs, people: [PPC], clientMainNumber: "+91 9000000005" }),
      /Event ID DBS-EVT-WED-ERD-000001 is already used by another project/,
    );
    assert.equal(calls.creates.length, 0);
  } finally { restore(); }
});

// ---- Replace: the matching project is deleted and the sheet's booking imported in its place ----

/**
 * The world above, with the typed project's payments and galleries counted, its deletion recorded,
 * and the delete rule and the Delete button's own steps stood in for.
 */
function replaceWorld({ payments = 0, galleries = 0, mayDelete = true, alreadyDeleted = false, extraNamed = [] } = {}) {
  const base = world({ reachable: ["p-typed"], extraNamed });
  const originals = { mayDelete: projects.mayDeleteProject, retire: projects.retireProjectWithin };
  const retired = [];
  projects.mayDeleteProject = async () => mayDelete;
  projects.retireProjectWithin = async (tx, id) => { retired.push(id); return {}; };
  const deleted = [];
  base.transaction.salesProject.updateMany = async ({ where, data }) => {
    if (alreadyDeleted || where.deletedAt !== null) return { count: 0 };
    deleted.push(where.id);
    return { count: data.deletedAt ? 1 : 0 };
  };
  base.transaction.cashEntry = { count: async () => payments };
  base.transaction.imageSelectionProject = { count: async () => galleries };
  const restore = () => { base.restore(); projects.mayDeleteProject = originals.mayDelete; projects.retireProjectWithin = originals.retire; };
  return { ...base, deleted, retired, restore };
}
const replaceRow = (overrides = {}) => rowFor({ sheetEventId: "DBS-EVT-2", whatsappGroupName: "WED ERD  aravindh & Yamini", ...overrides });
const replacing = (onReplaced = () => {}) => ({ user: { id: 1 }, onReplaced });

test("with Replace, a project with the same client name is deleted and the sheet's booking created", async () => {
  const w = replaceWorld();
  const seen = [];
  try {
    await projectForRow(w.transaction, { vertical: "WED", row: replaceRow(), userId: 1, refs: w.refs, people: [], clientMainNumber: "+91 9111111111", replace: replacing((p) => seen.push(p)) });
    assert.deepEqual(w.deleted, ["p-typed"]);
    assert.deepEqual(w.retired, ["p-typed"], "deleted without the Delete button's own steps");
    assert.equal(w.calls.creates.length, 1);
    assert.equal(seen[0].eventId, "DBS-EVT-WED-ERD-000001");
  } finally { w.restore(); }
});

test("a project with payments or a gallery is never deleted: it is kept and linked to the sheet", async () => {
  for (const [held, reason] of [[{ payments: 2 }, /2 payments/], [{ galleries: 1 }, /an Image Selection gallery/]]) {
    const w = replaceWorld(held);
    const linked = [];
    try {
      await projectForRow(w.transaction, { vertical: "WED", row: replaceRow(), userId: 1, refs: w.refs, people: [], clientMainNumber: "+91 9111111111", replace: replacing(), onLinked: (item) => linked.push(item) });
      assert.deepEqual(w.retired, []);
      assert.deepEqual(w.deleted, []);
      assert.equal(w.calls.creates.length, 0);
      assert.match(linked[0].reason, reason);
    } finally { w.restore(); }
  }
});

test("a project found only by its number is refused, and one the importer may not delete is kept, not replaced", async () => {
  const byNumber = replaceWorld();
  try {
    // Same number, different name: one client can book twice, so this is never taken as the same booking.
    await assert.rejects(projectForRow(byNumber.transaction, { vertical: "WED", row: replaceRow({ whatsappGroupName: "WED ERD Another Couple" }), userId: 1, refs: byNumber.refs, people: [], clientMainNumber: "+91 9000000001", replace: replacing() }), /under another name, so it is not imported/);
    assert.deepEqual(byNumber.deleted, []);
  } finally { byNumber.restore(); }
  // Somebody who may not delete it: the project is kept and linked rather than the row thrown away.
  const forbidden = replaceWorld({ mayDelete: false });
  try {
    await projectForRow(forbidden.transaction, { vertical: "WED", row: replaceRow(), userId: 1, refs: forbidden.refs, people: [], clientMainNumber: "+91 9111111111", replace: replacing() });
    assert.deepEqual(forbidden.deleted, []);
    assert.equal(forbidden.calls.creates.length, 0);
  } finally { forbidden.restore(); }
});

test("a project deleted by somebody else meanwhile is not replaced twice", async () => {
  // Two uploads, or an upload and the Delete button: only one may claim the project.
  const w = replaceWorld({ alreadyDeleted: true });
  try {
    await assert.rejects(projectForRow(w.transaction, { vertical: "WED", row: replaceRow(), userId: 1, refs: w.refs, people: [], clientMainNumber: "+91 9111111111", replace: replacing() }), /changed meanwhile/);
    assert.deepEqual(w.retired, []);
    assert.equal(w.calls.creates.length, 0);
  } finally { w.restore(); }
});

test("two projects with the client's name are a question for a person, not a replace", async () => {
  const w = replaceWorld({ extraNamed: [{ id: "p-other", eventId: "DBS-EVT-WED-ERD-000009", whatsappGroupName: "WED ERD Aravindh & Yamini" }] });
  try {
    await assert.rejects(projectForRow(w.transaction, { vertical: "WED", row: replaceRow(), userId: 1, refs: w.refs, people: [], clientMainNumber: "+91 9111111111", replace: replacing() }), /on 2 projects in the app \(DBS-EVT-WED-ERD-000001\)/);
    assert.deepEqual(w.deleted, []);
  } finally { w.restore(); }
});

// ---- Restore: a project deleted in the app, named again by a re-uploaded row ----

function restoreWorld({ galleries = 0, logins = 0, discs = 0, mayDelete = true } = {}) {
  const base = world({ reachable: ["p-imported"] });
  const deletedProject = { id: "p-imported", sheetEventId: "DBS-EVT-1", vertical: "WED", sourceBranch: "Erode TN", deletedAt: new Date(), whatsappGroupName: "WED ERD Old" };
  const restoredIds = [];
  const original = projects.mayDeleteProject;
  projects.mayDeleteProject = async () => mayDelete;
  base.transaction.salesProject.findUnique = async ({ where }) => (where.sheetEventId === "DBS-EVT-1" ? deletedProject : null);
  base.transaction.salesProject.updateMany = async ({ where, data }) => {
    if (where.id === deletedProject.id && data.deletedAt === null) { restoredIds.push(where.id); return { count: 1 }; }
    return { count: 0 };
  };
  base.transaction.imageSelectionProject = { count: async () => galleries };
  base.transaction.user = { count: async () => logins };
  /*
   * Restoring a project re-deletes its shoots, and a payment that followed one of them waits with
   * it (`syncShootLinkedDueDates`). This world has no shoot-linked payments, so the sync reads an
   * empty list - but it must be able to read one, or the restore throws on a table nobody stubbed.
   */
  base.transaction.projectPaymentSchedule = { findMany: async () => [] };
  base.transaction.clientStorage = { count: async () => discs };
  const hiddenShoots = [];
  base.transaction.projectShoot = { updateMany: async (args) => { hiddenShoots.push(args); return { count: 3 }; } };
  return { ...base, restoredIds, hiddenShoots, restore: () => { base.restore(); projects.mayDeleteProject = original; } };
}
const restoring = (seen = []) => ({ user: { id: 1 }, onRestored: (item) => seen.push(item) });

test("unticked, a deleted project named again is refused and says how to bring it back", async () => {
  const { transaction, refs, restoredIds, restore } = restoreWorld();
  try {
    await assert.rejects(
      projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1" }), userId: 1, refs, people: [], clientMainNumber: "+91 9000000009" }),
      /was deleted in the app\. Tick "Restore deleted projects and shoots"/,
    );
    assert.deepEqual(restoredIds, []);
  } finally { restore(); }
});

test("ticked, a deleted project is undeleted - the same row, no duplicate - and updated from the sheet", async () => {
  const { transaction, refs, calls, restoredIds, restore } = restoreWorld();
  const seen = [];
  try {
    await projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1" }), userId: 1, refs, people: [], clientMainNumber: "+91 9000000009", restore: restoring(seen) });
    assert.deepEqual(restoredIds, ["p-imported"]);
    assert.equal(calls.creates.length, 0);
    // The same row, its own Event ID kept.
    assert.equal("eventId" in calls.updates[0].data, false);
    assert.deepEqual(seen.map((item) => [item.kind, item.id]), [["Project", "DBS-EVT-1"]]);
  } finally { restore(); }
});

test("a restored project's shoots stay deleted until a row of the file names them", async () => {
  const { transaction, refs, hiddenShoots, restore } = restoreWorld();
  try {
    await projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1" }), userId: 1, refs, people: [], clientMainNumber: "+91 9000000009", restore: restoring() });
    // Every shoot still showing as live is marked deleted; each row's own shoot is restored by `restoreShoot`.
    assert.equal(hiddenShoots.length, 1);
    assert.deepEqual(hiddenShoots[0].where, { projectId: "p-imported", deletedAt: null });
    assert.ok(hiddenShoots[0].data.deletedAt instanceof Date);
  } finally { restore(); }
});

test("a deleted project that had a gallery, a client login or client storage is not restored", async () => {
  const { transaction, refs, restoredIds, restore } = restoreWorld({ galleries: 1, discs: 2 });
  try {
    await assert.rejects(
      projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1" }), userId: 1, refs, people: [], clientMainNumber: "+91 9000000009", restore: restoring() }),
      /deleted with an Image Selection gallery and client storage, so it is not restored/,
    );
    assert.deepEqual(restoredIds, []);
  } finally { restore(); }
});

test("restoring answers to the delete rule", async () => {
  const { transaction, refs, restoredIds, restore } = restoreWorld({ mayDelete: false });
  try {
    await assert.rejects(
      projectForRow(transaction, { vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-1" }), userId: 1, refs, people: [], clientMainNumber: "+91 9000000009", restore: restoring() }),
      /you may not restore it/,
    );
    assert.deepEqual(restoredIds, []);
  } finally { restore(); }
});

test("a client number is optional; Indian numbers get +91 and a foreign one is kept as written", () => {
  const { indianNumber } = require("../src/modules/project-management/pre-production/import.service");
  assert.equal(indianNumber("9443634232"), "+91 9443634232");
  assert.equal(indianNumber("918328117823"), "+91 8328117823");
  // A Malaysian number without its "+": where its country code ends is not guessed.
  assert.equal(indianNumber("60166802197"), "+60166802197");
  assert.equal(indianNumber("+60 16-6802197"), "+60166802197");
  assert.equal(indianNumber("call later"), null);
  // Two numbers in one cell: each is read in turn and the first that can be read is taken.
  assert.equal(indianNumber("9443634232 / 9876543210"), "+91 9443634232");
  assert.equal(indianNumber("9443634232, 9876543210"), "+91 9443634232");
  assert.equal(indianNumber("+91 9443634232 or 9876543210"), "+91 9443634232");
  assert.equal(indianNumber("call later / 9876543210"), "+91 9876543210");
  assert.equal(indianNumber("rubbish / nonsense"), null);
});

test("a clock time typed into a date column comes in empty, and the rest of the row stays", () => {
  assert.equal(parseDate("8:00 AM"), undefined);
  assert.equal(parseDate("25-12-2026").toISOString(), "2026-12-25T00:00:00.000Z");
});

// ---- A project or shoot the app had keeps its own details; the sheet adds what is missing ----

test("Replace leaves a project with payments, a gallery, or that the importer may not delete - and links it instead of skipping the row", async () => {
  for (const { payments, galleries, mayDelete, reason } of [
    { payments: 2, galleries: 0, mayDelete: true, reason: /2 payments/ },
    { payments: 0, galleries: 1, mayDelete: true, reason: /Image Selection gallery/ },
    { payments: 0, galleries: 0, mayDelete: false, reason: /may not delete/ },
  ]) {
    const base = world({ reachable: ["p-typed"] });
    const original = projects.mayDeleteProject;
    projects.mayDeleteProject = async () => mayDelete;
    base.transaction.cashEntry = { count: async () => payments };
    base.transaction.imageSelectionProject = { count: async () => galleries };
    base.transaction.salesProject.updateMany = async () => { throw new Error("nothing should be deleted"); };
    const linked = [];
    try {
      const project = await projectForRow(base.transaction, {
        vertical: "WED", row: rowFor({ sheetEventId: "DBS-EVT-2", whatsappGroupName: "Wed Erd  Aravindh & Yamini" }), userId: 1, refs: base.refs, people: [], clientMainNumber: null,
        replace: { user: { id: 1 }, onReplaced: () => { throw new Error("not replaced"); } }, onLinked: (item) => linked.push(item),
      });
      assert.equal(project.id, "p-typed");
      assert.equal(base.calls.creates.length, 0);
      assert.deepEqual(base.calls.updates[0].data, { sheetEventId: "DBS-EVT-2" });
      assert.match(linked[0].reason, reason);
    } finally { base.restore(); projects.mayDeleteProject = original; }
  }
});

test("a timing written on a sheet-made shoot takes its minutes with it, even empty", () => {
  assert.equal(shootUpdate({ shoot: "Reception", sessionTimings: ["Full Session"], sessionTiming: "Full Session", sessionDurationMinutes: null }, {}).sessionDurationMinutes, null);
  assert.equal("sessionDurationMinutes" in shootUpdate({ shoot: "Reception", sessionDurationMinutes: null }, {}), false);
});

// ---- The project's Client Storage record ----

const { storageForRow } = require("../src/modules/project-management/pre-production/import.service");
const storage = require("../src/modules/assets/client-storage.service");

/** `ensureProjectClientStorage` stood in for: it answers with the record the register would raise. */
function storageWorld(record) {
  const updates = [];
  const original = storage.ensureProjectClientStorage;
  storage.ensureProjectClientStorage = async () => record;
  return {
    transaction: {
      clientStorage: { update: async (args) => { updates.push(args); return args; } },
      // No shoot still ahead, so a delivered disc is finished with - `shootStatusPendingFor`'s question.
      projectShoot: { findMany: async () => [] },
    },
    updates,
    restore: () => { storage.ensureProjectClientStorage = original; },
  };
}

test("Received The Storage marks the project's disc Delivered, and never moves one already on its way", async () => {
  const fresh = storageWorld({ id: 7, status: "Yet to Receive", isDeleted: false });
  try {
    await storageForRow(fresh.transaction, "p1", { storageReceived: true }, 1);
    assert.deepEqual(fresh.updates[0], { where: { id: 7 }, data: { status: "Delivered", updatedBy: 1 } });
  } finally { fresh.restore(); }

  // Not said, said No, a record the studio has moved on, one removed with a reason, or a booking that
  // raises none at all: the register's own record is left exactly as it is.
  for (const [record, row] of [
    [{ id: 7, status: "Yet to Receive", isDeleted: false }, {}],
    [{ id: 7, status: "Yet to Receive", isDeleted: false }, { storageReceived: false }],
    [{ id: 7, status: "Footage Backup Done", isDeleted: false }, { storageReceived: true }],
    [{ id: 7, status: "Yet to Receive", isDeleted: true }, { storageReceived: true }],
    [null, { storageReceived: true }],
  ]) {
    const w = storageWorld(record);
    try {
      await storageForRow(w.transaction, "p1", row, 1);
      assert.deepEqual(w.updates, [], JSON.stringify({ record, row }));
    } finally { w.restore(); }
  }
});

test("a disc is left at Yet to Receive while the project still has a shoot to come", async () => {
  const ahead = storageWorld({ id: 7, status: "Yet to Receive", isDeleted: false });
  const flow = require("../src/modules/assets/client-storage.controller");
  const original = flow.shootStatusPendingFor;
  flow.shootStatusPendingFor = async () => true;
  try {
    await storageForRow(ahead.transaction, "p1", { storageReceived: true }, 1);
    // The register sends a delivered disc back round for that shoot, so Delivered is not a state it
    // could rest in: the record waits where it is.
    assert.deepEqual(ahead.updates, []);
  } finally { ahead.restore(); flow.shootStatusPendingFor = original; }
});

test("a booking dated in the future is refused", async () => {
  const { importRow } = require("../src/modules/project-management/pre-production/import.service");
  const ahead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await assert.rejects(
    importRow({ vertical: "WED", row: { sheetEventId: "DBS-EVT-9", sheetShootId: "DBS-SID-9", whatsappGroupName: "X", sourceBranch: "Erode", shoot: "Wedding", projectCreatedAt: ahead }, userId: 1 }),
    /Date Created: the booking cannot have been made in the future/,
  );
});

test("a Studio Start Date the sheet got wrong is refused by name, not left to the database", async () => {
  // Pulled out for Production's row (`studioStartForRow`), it is still checked before anything is written.
  const { importRow } = require("../src/modules/project-management/pre-production/import.service");
  await assert.rejects(
    importRow({ vertical: "WED", row: { sheetEventId: "DBS-EVT-9", sheetShootId: "DBS-SID-9", whatsappGroupName: "X", sourceBranch: "Erode", shoot: "Wedding", studioStartDate: "31/02/2026" }, userId: 1 }),
    /Studio Start Date/,
  );
});

// ---- "Import rows with errors": a cell the file got wrong comes in empty ----

test("a bad cell comes in empty and the row still imports, while a cell the row cannot do without still refuses it", async () => {
  const bad = {
    ...GOOD,
    "Shoot Date": "MFCV+2HJ Siddipalle, Telangana",
    "Project Status": "Finished",
    "Main Event": "maybe",
    "Session Hours": "two",
    "Welcome Gift": "sometimes",
    "Project Validity (In Months)": "a year",
  };
  const { result, created } = await run(bad, { lenient: true });
  assert.equal(result.imported, 1, JSON.stringify(result.errors));
  // Every cell it could not read is empty, and named in the summary by its heading.
  for (const field of ["dateCreated", "projectStatus", "isMainEvent", "sessionDurationHours", "welcomeGift", "projectValidityMonths"]) {
    assert.equal(created[0][field], undefined, field);
  }
  // Main Event is not among them: a yes/no cell that reads as neither is already empty by the time the
  // schema sees it, so there was nothing to drop.
  assert.deepEqual(result.emptied[0].columns.sort(), ["Project Status", "Project Validity (In Months)", "Session Hours", "Shoot Date", "Welcome Gift"]);
  // The rest of the row arrives as the file wrote it.
  assert.equal(created[0].whatsappGroupName, GOOD["Client Name"]);
  assert.equal(created[0].shoot, "Wedding");

  // A heading the table cannot do without is not something an empty cell can stand in for.
  const { result: refused } = await run({ ...GOOD, "Shoot Name": "" }, { lenient: true });
  assert.equal(refused.imported, 0);
  assert.match(refused.errors[0].message, /^Shoot Name is required\./);
});

test("a row that fails to save is not also listed as having come in with cells empty", async () => {
  const headers = ["ID", "When"];
  const columns = [{ field: "id", label: "ID", required: true }, { field: "when", label: "When", kind: "date", parse: (value) => value }];
  const { z } = require("zod");
  const schema = z.object({ id: z.string().min(1), when: z.date({ message: "Enter the date as DD-MM-YYYY." }).optional() });
  const result = await importTableRows({
    headers,
    rows: [["A", "rubbish"]],
    columns,
    schema,
    create: async () => { throw new Error("the board refused it"); },
    lenient: true,
  });
  assert.equal(result.imported, 0);
  assert.deepEqual(result.emptied, []);
  assert.equal(result.errors[0].message, "the board refused it");
});
