const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const transcripts = require("../src/modules/sales/call-transcripts/repository");

/*
 * A lead's children are keyed to the lead (20260924130000 and 20260924150000), and the CRD document
 * to its project.
 *
 * They used to name the lead by a plain string that nothing checked, so a deleted lead left its
 * meetings, quotations and projects pointing at nothing, and five screens wrote "" for "no lead".
 * Now the database holds the rules the application's own delete already followed: a booking, a
 * quotation or a CRD document stops a lead being deleted; a meeting, a group name and a transcript
 * go with it; a document goes with its project; and a record raised without a lead simply has none.
 * These tests hold each of those against the real database.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TLK-${STAMP}-${name}`;
const F = {};

const lead = (name) => prisma.salesCrmLead.create({ data: { enquiryId: tag(name), name: `Lead ${name}` } });
const project = (name, enquiryId) => prisma.salesProject.create({ data: {
  enquiryId, eventId: tag(name), whatsappGroupName: `WED ${STAMP} ${name}`, clientMainNumber: "+919876543210",
  deliverables: "[]", initialConvertedValue: 0, vertical: "WED", crmName: "Test", sourceBranch: "Erode TN",
} });
const quotation = (name, enquiryId) => prisma.salesQuotation.create({ data: {
  quotationNumber: tag(name), quotationId: `${tag(name)}-01`, publicToken: tag(name).slice(-16), payload: {}, enquiryId,
} });
const meeting = (name, enquiryId) => prisma.salesCrmMeeting.create({ data: { enquiryId, title: `Meeting ${name}`, startAt: new Date(), endAt: new Date(Date.now() + 3600000) } });
const groupName = (name, enquiryId) => prisma.salesWhatsappGroupName.create({ data: {
  groupType: "Dum Dum", vertical: "Dum Dum", generatedName: tag(name), branch: "Erode TN", place: "Erode", enquiryId,
} });
const crd = (name, { enquiryId = null, projectId = null } = {}) => prisma.salesProjectCrdDocument.create({ data: { publicToken: tag(name).slice(-16), enquiryId, projectId } });

before(async () => {
  F.booked = await lead("booked");
  F.quoted = await lead("quoted");
  F.documented = await lead("documented");
  F.talked = await lead("talked");
  F.project = await project("project", F.booked.enquiryId);
  F.projectDoc = await crd("project-doc", { projectId: F.project.id });
  F.quotation = await quotation("quote", F.quoted.enquiryId);
  F.handDoc = await crd("hand-doc", { enquiryId: F.documented.enquiryId });
  F.meeting = await meeting("meet", F.talked.enquiryId);
  F.groupName = await groupName("group", F.talked.enquiryId);
  F.transcript = await transcripts.ensureTranscript({ callLogId: tag("call-talked"), enquiryId: F.talked.enquiryId });
});

after(async () => {
  const startsWith = tag("");
  await prisma.salesCallTranscript.deleteMany({ where: { callLogId: { startsWith } } });
  await prisma.salesWhatsappGroupName.deleteMany({ where: { generatedName: { startsWith } } });
  await prisma.salesProjectCrdDocument.deleteMany({ where: { publicToken: { in: ["project-doc", "hand-doc", "free"].map((name) => tag(name).slice(-16)) } } });
  await prisma.salesCrmMeeting.deleteMany({ where: { enquiryId: { startsWith } } });
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith } } });
});

const refused = (error) => error?.code === "P2003" || /foreign key constraint/i.test(String(error?.message));

test("a lead with a booking, a quotation or a document behind it cannot be deleted", async () => {
  for (const enquiryId of [F.booked.enquiryId, F.quoted.enquiryId, F.documented.enquiryId]) {
    await assert.rejects(() => prisma.salesCrmLead.delete({ where: { enquiryId } }), refused, `${enquiryId} should be refused`);
  }
  assert.ok(await prisma.salesProject.findUnique({ where: { id: F.project.id } }), "the project is untouched by the refused delete");
});

test("a project or a quotation cannot name a lead that does not exist", async () => {
  await assert.rejects(() => project("ghost", tag("no-such-lead")), refused);
  await assert.rejects(() => quotation("ghost", tag("no-such-lead")), refused);
});

test("deleting a meeting deletes the meeting and nothing else", async () => {
  const extra = await meeting("extra", F.talked.enquiryId);
  await prisma.salesCrmMeeting.delete({ where: { id: extra.id } });
  assert.ok(await prisma.salesCrmLead.findUnique({ where: { enquiryId: F.talked.enquiryId } }), "the lead is still there");
  assert.ok(await prisma.salesCrmMeeting.findUnique({ where: { id: F.meeting.id } }), "and so is its other meeting");
});

test("deleting a lead takes its meeting, its group name and its transcript with it", async () => {
  await prisma.salesCrmLead.delete({ where: { enquiryId: F.talked.enquiryId } });
  assert.equal(await prisma.salesCrmMeeting.findUnique({ where: { id: F.meeting.id } }), null);
  assert.equal(await prisma.salesWhatsappGroupName.findUnique({ where: { id: F.groupName.id } }), null);
  assert.equal(await prisma.salesCallTranscript.findUnique({ where: { id: F.transcript.id } }), null);
});

test("deleting a project takes its CRD document with it", async () => {
  await prisma.salesProject.delete({ where: { id: F.project.id } });
  assert.equal(await prisma.salesProjectCrdDocument.findUnique({ where: { id: F.projectDoc.id } }), null);
  // And with the booking gone, the lead may be deleted.
  await prisma.salesCrmLead.delete({ where: { enquiryId: F.booked.enquiryId } });
});

test("a quotation, a document and a group name may exist with no lead at all - as nothing, never as an empty string", async () => {
  const free = await quotation("free", null);
  assert.equal(free.enquiryId, null);
  assert.equal((await crd("free")).enquiryId, null);
  assert.equal((await groupName("free", null)).enquiryId, null);
});

test("a call the studio never turned into an enquiry keeps its transcript, with no lead", async () => {
  const row = await transcripts.ensureTranscript({ callLogId: tag("call"), enquiryId: "", recordingUrl: null });
  assert.equal(row.enquiryId, null, '"" is written as nothing, which is what the key accepts');
  const linked = await transcripts.ensureTranscript({ callLogId: tag("call"), enquiryId: F.quoted.enquiryId });
  assert.equal(linked.enquiryId, F.quoted.enquiryId, "and the same call can be matched to a lead later");
});

test("the application's own lead delete lists the same tables the keys do", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "crmLeadService.js"), "utf8");
  assert.match(service, /const LEAD_OWNED_TABLES = \["sales_crm_lead_activity", "sales_crm_lead_occasion", "sales_crm_lead_watch", "sales_crm_meeting", "sales_whatsapp_group_name", "sales_call_transcript"\];/);
  assert.match(service, /const LEAD_UNLINKED_TABLES = \["sales_crm_call_log"\];/, "only the runtime call-log table, which has no key, is unlinked rather than removed");
  assert.match(service, /const LEAD_COMMERCIAL_TABLES = \{ sales_project: "a project", sales_quotation: "a quotation", sales_project_crd_document: "a CRD document" \};/);
});
