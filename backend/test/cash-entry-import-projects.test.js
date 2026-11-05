const test = require("node:test");
const assert = require("node:assert/strict");
const { importProjectFor, importDate, importSchema, CASH_ENTRY_IMPORT_COLUMNS } = require("../src/modules/accounts/cash-entries/controller");

const project = (id, eventId, whatsappGroupName) => ({ id, eventId, whatsappGroupName });
const sameName = (value) => String(value).replace(/\s+/g, " ").trim().toUpperCase();
const lookupOf = (projects) => {
  const byName = new Map();
  for (const item of projects) byName.set(sameName(item.whatsappGroupName), [...(byName.get(sameName(item.whatsappGroupName)) || []), item]);
  return { byEventId: new Map(projects.map((item) => [sameName(item.eventId), item])), byName };
};
const lookup = lookupOf([
  project("p1", "DBS-EVT-05599", "Corp ERD Ahamed Raseen MTY SM IH"),
  project("p2", "DBS-EVT-05477", "WED 3T3 CBE MANOJ & KEERTHANA | NSM | ANNUR"),
  project("p3", "DBS-EVT-05519", "WED 3T3 CBE MANOJ & KEERTHANA | NSM | ANNUR"),
]);

test("a row is filed against the project whose WhatsApp group is its Client Name", () => {
  assert.equal(importProjectFor({ entryType: "Received", clientName: "corp erd  Ahamed Raseen MTY SM IH " }, lookup).id, "p1", "case and spacing do not matter");
});

test("the Event ID names the project, and wins over the Client Name", () => {
  assert.equal(importProjectFor({ entryType: "Received", clientName: "WED 3T3 CBE MANOJ & KEERTHANA | NSM | ANNUR", eventId: "dbs-evt-05519" }, lookup).id, "p3");
  assert.throws(() => importProjectFor({ entryType: "Received", eventId: "DBS-EVT-99999" }, lookup), /No project has the Event ID DBS-EVT-99999/);
});

test("two projects sharing a group name, or none having it, is refused for money in rather than guessed", () => {
  assert.throws(() => importProjectFor({ entryType: "Received", clientName: "WED 3T3 CBE MANOJ & KEERTHANA | NSM | ANNUR" }, lookup), /2 projects \(DBS-EVT-05477, DBS-EVT-05519\)\. Add the Event ID/);
  assert.throws(() => importProjectFor({ entryType: "Received", clientName: "Ahamed" }, lookup), /No project has the WhatsApp group "Ahamed"/);
  assert.throws(() => importProjectFor({ entryType: "Received" }, lookup), /Name the project/);
});

test("money out may belong to no project and goes in unlinked", () => {
  assert.equal(importProjectFor({ entryType: "Spent", clientName: "Office rent" }, lookup), null);
  assert.equal(importProjectFor({ entryType: "Spent" }, lookup), null);
});

test("an imported date is read day first", () => {
  assert.equal(importDate("05/10/2026"), "2026-10-05");
  assert.equal(importDate("05-10-2026"), "2026-10-05");
  assert.equal(importDate("26/10/2026"), "2026-10-26");
  assert.equal(importDate("5 Oct 2026"), "2026-10-05");
  assert.equal(importDate("2026-10-05"), "2026-10-05");
  assert.equal(importDate("not a date"), "not a date", "left for the schema to refuse");
});

test("Branch is no longer required, and Event ID is a column", () => {
  assert.equal(CASH_ENTRY_IMPORT_COLUMNS.find((column) => column.field === "branch").required, undefined);
  assert.ok(CASH_ENTRY_IMPORT_COLUMNS.some((column) => column.field === "eventId" && column.label === "Event ID"));
});

test("an imported row may leave the transaction ID, the account and the remark empty", async () => {
  const row = { entryType: "Received", entryDate: "05/10/2026", category: "Advance", amount: "25000", clientName: "X", handlerName: "Nobody On The Staff" };
  for (const paymentMode of ["UPI", "Bank Transfer", "Net Banking", "Credit / Debit Cards"]) {
    const parsed = await importSchema.safeParseAsync({ ...row, paymentMode });
    assert.ok(parsed.success, `${paymentMode}: ${parsed.success ? "" : parsed.error.issues[0].message}`);
  }
  assert.ok((await importSchema.safeParseAsync({ ...row, paymentMode: "Other", handlerName: "" })).success);
});

test("Handled By is read before the row is checked, so a named handler is accepted", async () => {
  const row = { entryType: "Received", entryDate: "2026-10-05", category: "Advance", amount: "25000", paymentMode: "UPI", clientName: "X" };
  const named = await importSchema.safeParseAsync({ ...row, handlerName: "Nobody On The Staff" });
  assert.ok(named.success);
  assert.equal(named.data.handlerIsOther, true, "a name matching no employee is kept as somebody outside the staff");
  const blank = await importSchema.safeParseAsync(row);
  assert.equal(blank.success, false, "Handled By is still asked for");
});

test("an imported expense may leave Paid To and Handled By empty; money received still names who took it", async () => {
  const spent = { entryType: "Spent", entryDate: "08/10/2026", category: "Travel", amount: "500", paymentMode: "Cash", clientName: "Office" };
  assert.ok((await importSchema.safeParseAsync(spent)).success);
  assert.ok((await importSchema.safeParseAsync({ ...spent, paymentMode: "Other" })).success);
  const received = { entryType: "Received", entryDate: "08/10/2026", category: "Advance", amount: "500", paymentMode: "Cash", clientName: "X" };
  assert.equal((await importSchema.safeParseAsync(received)).success, false);
});

test("an entry naming no handler stores none, rather than whichever employee is first", async () => {
  const { handlerFields } = require("../src/modules/accounts/cash-entries/controller");
  assert.deepEqual(await handlerFields({ entryType: "Spent" }), {});
  assert.deepEqual(await handlerFields({ entryType: "Received" }), {});
});
