const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { createDocument, ensureLink, ensureProjectCrdDocument, listDocuments } = require("../src/modules/sales/crd-documents/service");

/*
 * Every CRD document is called something, including one raised by hand.
 *
 * The register's first column is the CRD ID, and it was blank for every document raised from
 * **Create CRD Document**: `createDocument` never took an identifier, and only two paths ever wrote
 * one - issuing a project's own link, and a project adopting a hand-raised document when it is
 * later started as "Applicable". A hand-raised document reaches neither, because that button exists
 * precisely for a project answered "Not Applicable" and such a project never adopts. So the code
 * stayed null for good.
 *
 * Most visible on Qua Qua, where the projects are the ones answered "Not Applicable" and then given
 * a document by hand - which is how it was found.
 *
 * Two separate faults made the same blank cell, and both are covered here: the row not being given
 * a code, and the register not reading the code off a standalone row even when it had one.
 *
 * Real rows, removed at the end - including the identifier counter, which a mint advances.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCC-${STAMP}-${name}`;
// Everything is readable: `access` is a Prisma `where` fragment and an empty one narrows nothing.
// `undefined` is the opposite - `accessOrNothing` turns it into a rule matching no rows at all.
const ALL = {};
const F = {};

before(async () => {
  F.sequence = await prisma.appSequence.findUnique({ where: { key: "CRD_DOCUMENT:QQ" } });
  F.ddSequence = await prisma.appSequence.findUnique({ where: { key: "CRD_DOCUMENT:DD" } });
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq"), eventId: tag("evt"), whatsappGroupName: `QQ ${STAMP}`, clientMainNumber: "+919876543210",
    sourceBranch: "Coimbatore TN", vertical: "QQ", deliverables: "[]", initialConvertedValue: 0, crmName: "Test",
    // The case the Create CRD Document button exists for, and the one that never gets a code.
    crdDocumentStatus: "Not Applicable",
  } });
});

after(async () => {
  /*
   * Both kinds of document this suite raises, and the projects before them.
   *
   * A document raised by hand carries the Enquiry ID; one raised by a project answering "Applicable"
   * carries none - it has a `projectId` instead. Sweeping on the Enquiry ID alone left every
   * document of the second kind behind, its project deleted out from under it, and the identifiers
   * they held then collided with the ones the next run minted after this restored the counter. So
   * the projects are read first and their documents go with them.
   */
  const projects = await prisma.salesProject.findMany({ where: { eventId: { startsWith: `TCC-${STAMP}-` } }, select: { id: true } });
  await prisma.salesProjectCrdDocument.deleteMany({
    where: { OR: [{ enquiryId: { startsWith: `TCC-${STAMP}-` } }, { projectId: { in: projects.map((project) => project.id) } }] },
  });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCC-${STAMP}-` } } });
  /*
   * The mint below advanced the studio's Qua Qua run. Put it back, or every test run leaves a gap
   * in a sequence somebody reads as a count.
   *
   * Wound back rather than deleted, even where this run created the row: `app_sequence` holds the
   * studio's real counters, not fixtures, so it is not a table the sweep may ever clear - and a
   * counter at 0 hands out 000001 next, which is exactly what an absent row does.
   */
  for (const [key, saved] of [["CRD_DOCUMENT:QQ", F.sequence], ["CRD_DOCUMENT:DD", F.ddSequence]]) {
    await prisma.appSequence.upsert({ where: { key }, update: { currentValue: saved?.currentValue ?? 0 }, create: { key, currentValue: 0 } });
  }
});

test("a document raised by hand is given its identifier", async () => {
  F.document = await createDocument({
    vertical: "QQ", enquiryId: tag("enq"), clientName: "Test baby", contactNumber: "+91 9876543210",
  }, null, { access: ALL });
  assert.match(F.document.documentCode, /^DBS-CRD-QQ-\d{6}$/, "the code the studio quotes this document by");

  // And it is on the row, not only in the reply: the reply is read once, the row is read forever.
  const stored = await prisma.salesProjectCrdDocument.findUnique({ where: { id: F.document.id }, select: { documentCode: true, projectId: true } });
  assert.equal(stored.documentCode, F.document.documentCode);
  assert.equal(stored.projectId, null, "raised by hand, so it answers to no project yet");
});

test("the register shows that identifier in its CRD ID column", async () => {
  /*
   * The column reads the row's own `documentCode`. A project row had said this all along and a
   * standalone one had not, so even after the mint above the cell would still have been empty -
   * which is the half of this that a test of `createDocument` alone would have missed.
   */
  const rows = await listDocuments({ access: ALL });
  const row = rows.find((entry) => entry.enquiryId === tag("enq"));
  assert.ok(row, "the hand-raised document is listed");
  assert.equal(row.type, "Manual");
  assert.equal(row.documentCode, F.document.documentCode);
  // The nested document is what the row's actions use, and it agrees.
  assert.equal(row.crdDocument.documentCode, F.document.documentCode);
});

test("the number counts within the vertical it names", async () => {
  // Qua Qua and Dum Dum run their own sequences, so a QQ document can never be handed a DD number.
  assert.ok(F.document.documentCode.includes("-QQ-"), F.document.documentCode);
});

/*
 * ── Answering "Applicable" is what raises the document ────────────────────────────────────────
 *
 * It used to be Send Link, so a project that had committed to collecting a CRD document sat on the
 * register with the CRD ID column reading "-" until somebody pressed a button. It was read as a
 * fault in whichever vertical happened to be the one nobody had sent yet - Dum Dum, as it turned
 * out, because the Qua Qua project's link had been sent and the Dum Dum one's had not.
 *
 * Nothing here is per-vertical, which is the point: the identifier counts *within* the vertical it
 * names, and the vertical has never decided whether a project gets one.
 */

test("a project answering Applicable raises its document, unsent", async () => {
  const project = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq-applicable"), eventId: tag("evt-applicable"), whatsappGroupName: `WED ${STAMP}`,
    clientMainNumber: "+919876543210", sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]",
    initialConvertedValue: 0, crmName: "Test", crdDocumentStatus: "Applicable",
  } });
  const document = await ensureProjectCrdDocument(prisma, project.id, { userId: null });
  assert.match(document.documentCode, /^DBS-CRD-DD-\d{6}$/, "the identifier exists before the link is sent");
  assert.ok(document.publicToken, "and so does the link it will be sent as");

  const row = (await listDocuments({ access: ALL })).find((entry) => entry.eventId === tag("evt-applicable"));
  assert.equal(row.documentCode, document.documentCode, "which is what the register's CRD ID column shows");
  // The state that used to be carried by there being no row at all.
  assert.equal(row.status, "Link Not sent");
});

test("saving the project again raises one document and spends one number", async () => {
  // Both save paths call this on every save, not only the one that answered Applicable - so a
  // project edited five times must not hold five identifiers, or spend four of the studio's run.
  const project = await prisma.salesProject.findFirst({ where: { eventId: tag("evt-applicable") }, select: { id: true } });
  const before = await prisma.appSequence.findUnique({ where: { key: "CRD_DOCUMENT:DD" } });
  const again = await ensureProjectCrdDocument(prisma, project.id, { userId: null });
  const after = await prisma.appSequence.findUnique({ where: { key: "CRD_DOCUMENT:DD" } });
  assert.equal(after.currentValue, before.currentValue, "a second call must not spend an identifier");
  assert.equal(await prisma.salesProjectCrdDocument.count({ where: { projectId: project.id } }), 1);
  assert.ok(again.documentCode);
});

test("Send Link records the sending rather than handing the row back untouched", async () => {
  const project = await prisma.salesProject.findFirst({ where: { eventId: tag("evt-applicable") }, select: { id: true } });
  const sent = await ensureLink(project.id, null, { access: ALL });
  assert.equal(sent.status, "Sent");
  const row = (await listDocuments({ access: ALL })).find((entry) => entry.eventId === tag("evt-applicable"));
  assert.equal(row.status, "Yet To Receive", "it is no longer a link nobody has sent");
  assert.equal(row.documentCode, sent.documentCode, "and it is the same document, not a second one");

  // Pressed again to re-copy the URL: the client may already be filling this one in.
  const secondPress = await ensureLink(project.id, null, { access: ALL });
  assert.equal(secondPress.publicToken, sent.publicToken);
  assert.equal(secondPress.documentCode, sent.documentCode);
});

test("a project that answered Not Applicable raises nothing", async () => {
  // It is the one case Create CRD Document exists for, and raising a document here would both spend
  // an identifier the studio said it did not want and take the project out of that dialog.
  const before = await prisma.appSequence.findUnique({ where: { key: "CRD_DOCUMENT:DD" } });
  assert.equal(await ensureProjectCrdDocument(prisma, F.project.id, { userId: null }), null);
  const after = await prisma.appSequence.findUnique({ where: { key: "CRD_DOCUMENT:DD" } });
  assert.equal(after.currentValue, before.currentValue);
});

test("both editors raise it, because both ask the question", () => {
  /*
   * The fault that survived the first attempt at this: the call was added to the Start Project save
   * only, and CRD Document is answered on Edit Sale Details as well - which is where a project
   * saved as "Not Applicable" gets put right. Marking that project Applicable there raised nothing,
   * so the register still read "-" and it looked as though the fix had not worked at all.
   */
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  assert.equal((source.match(/await ensureProjectCrdDocument\(transaction, project\.id/g) || []).length, 2,
    "both the Start Project save and Edit Sale Details must raise the document");
});
