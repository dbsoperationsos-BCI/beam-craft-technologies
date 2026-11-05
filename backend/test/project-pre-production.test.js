const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureProjectPreProduction } = require("../src/modules/project-management/pre-production/service");
const { preProductionUpdateSchema, followupCreateSchema, followupSummary, conceptList } = require("../src/modules/project-management/pre-production/controller");

/*
 * A stand-in for the Prisma client, holding one project, its shoots and whatever pre production
 * rows already exist. These are unit tests about when a row is raised, so they must not need MySQL
 * to answer — the same reason the Image Selection tests stub their repository.
 */
function fakeClient({ project, shoots = [], existing = [] } = {}) {
  const state = { created: [], existing: existing.map((row) => ({ ...row })) };
  return {
    state,
    salesProject: { findFirst: async ({ where }) => (project && project.id === where.id && !project.deletedAt ? project : null) },
    projectShoot: { findMany: async () => shoots.filter((shoot) => !shoot.deletedAt).map((shoot) => ({ id: shoot.id })) },
    projectPreProduction: {
      findMany: async ({ where }) => state.existing.filter((row) => where.shootId.in.includes(row.shootId)).map((row) => ({ shootId: row.shootId })),
      createMany: async ({ data }) => { state.created.push(...data); state.existing.push(...data); return { count: data.length }; },
    },
  };
}

const started = (overrides = {}) => ({
  id: "project-1",
  projectStatus: "Work in Progress - Pre & Production",
  preProductionCoordinator: "Asha",
  preProductionCoordinatorEmployeeId: 7,
  ...overrides,
});
const shoots = [{ id: "shoot-1" }, { id: "shoot-2" }, { id: "shoot-3" }];

test("a started project with a coordinator gets one row per shoot", async () => {
  const client = fakeClient({ project: started(), shoots });
  assert.equal(await ensureProjectPreProduction(client, "project-1", { userId: 4 }), 3);
  assert.deepEqual(client.state.created.map((row) => row.shootId), ["shoot-1", "shoot-2", "shoot-3"]);
  // The project is carried on the row as well as the shoot, so the board can filter by coordinator
  // without joining through the shoot on every read.
  assert.ok(client.state.created.every((row) => row.projectId === "project-1"));
  assert.ok(client.state.created.every((row) => row.updatedByUserId === 4));
});

test("a project still Yet to Start raises nothing", async () => {
  // The coordinator can still change while it is a draft, and a draft save must not leave a board
  // full of shoots for a project that never starts.
  const client = fakeClient({ project: started({ projectStatus: "Yet to Start" }), shoots });
  assert.equal(await ensureProjectPreProduction(client, "project-1"), 0);
  assert.deepEqual(client.state.created, []);
});

test("a started project with no coordinator raises nothing", async () => {
  const project = started({ preProductionCoordinator: null, preProductionCoordinatorEmployeeId: null });
  const client = fakeClient({ project, shoots });
  assert.equal(await ensureProjectPreProduction(client, "project-1"), 0);
});

test("a coordinator recorded only by name still raises rows", async () => {
  // Rows saved before the employee selector existed carry a name with no id. They are still an
  // assignment, and the board is the only place the work would otherwise be lost.
  const project = started({ preProductionCoordinatorEmployeeId: null });
  const client = fakeClient({ project, shoots });
  assert.equal(await ensureProjectPreProduction(client, "project-1"), 3);
});

test("a blank coordinator name is not an assignment", async () => {
  const project = started({ preProductionCoordinator: "   ", preProductionCoordinatorEmployeeId: null });
  const client = fakeClient({ project, shoots });
  assert.equal(await ensureProjectPreProduction(client, "project-1"), 0);
});

test("only the missing rows are created, so filled-in work is never touched", async () => {
  // This is what makes it safe to call on every save: reassigning the coordinator, or adding a
  // shoot months later, must not reset what the last coordinator entered.
  const client = fakeClient({ project: started(), shoots, existing: [{ shootId: "shoot-1" }, { shootId: "shoot-2" }] });
  assert.equal(await ensureProjectPreProduction(client, "project-1"), 1);
  assert.deepEqual(client.state.created.map((row) => row.shootId), ["shoot-3"]);
});

test("calling it twice is a no-op the second time", async () => {
  const client = fakeClient({ project: started(), shoots });
  await ensureProjectPreProduction(client, "project-1");
  assert.equal(await ensureProjectPreProduction(client, "project-1"), 0);
});

test("a deleted shoot gets no row", async () => {
  const client = fakeClient({ project: started(), shoots: [{ id: "shoot-1" }, { id: "shoot-2", deletedAt: new Date() }] });
  assert.equal(await ensureProjectPreProduction(client, "project-1"), 1);
  assert.deepEqual(client.state.created.map((row) => row.shootId), ["shoot-1"]);
});

test("a project with no shoots, and a project that does not exist, raise nothing", async () => {
  assert.equal(await ensureProjectPreProduction(fakeClient({ project: started(), shoots: [] }), "project-1"), 0);
  assert.equal(await ensureProjectPreProduction(fakeClient({ project: null }), "project-1"), 0);
});

test("a deleted project raises nothing", async () => {
  const client = fakeClient({ project: started({ deletedAt: new Date() }), shoots });
  assert.equal(await ensureProjectPreProduction(client, "project-1"), 0);
});

// ---------------------------------------------------------------------------
// What the form is allowed to send
// ---------------------------------------------------------------------------

test("times are accepted only as HH:MM on a 24 hour clock", () => {
  assert.ok(preProductionUpdateSchema.safeParse({ eventStartTime: "09:30", reportingTime: "23:59" }).success);
  for (const bad of ["9:30", "24:00", "09:60", "9.30am", "0930"]) {
    assert.equal(preProductionUpdateSchema.safeParse({ reportingTime: bad }).success, false, bad);
  }
});

test("an end before the start is a shoot running past midnight, and saves", () => {
  // 9:00 PM to 2:00 AM ends the next day - as Production's crew check already reads it.
  assert.ok(preProductionUpdateSchema.safeParse({ eventStartTime: "21:00", eventEndTime: "02:00" }).success);
  assert.ok(preProductionUpdateSchema.safeParse({ eventStartTime: "09:00", eventEndTime: "18:00" }).success);
});

test("a shoot's concepts are a list, each with its own reference and remarks", () => {
  const parsed = preProductionUpdateSchema.safeParse({
    concepts: [{ reference: "https://example.com/a", remarks: "Sunset walk" }, { reference: null, remarks: "Family portrait" }],
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data.concepts.length, 2);
  // A reference is a link, as it always was.
  assert.equal(preProductionUpdateSchema.safeParse({ concepts: [{ reference: "x".repeat(2049) }] }).success, false);
  // Left out, the list is not part of the save at all.
  assert.equal("concepts" in preProductionUpdateSchema.parse({ locationAddress: "Chennai" }), false);

  assert.equal(conceptList([]), null);
  assert.equal(conceptList([{ reference: "https://example.com/a", remarks: "Sunset walk" }, { reference: null, remarks: "Family portrait" }]),
    "1. https://example.com/a — Sunset walk\n2. Family portrait");
});

test("a follow-up needs a date, and not one already gone", () => {
  // Only the next date is asked for; the last one is when a follow-up is marked done.
  for (const followupDate of [undefined, null, ""]) {
    assert.equal(followupCreateSchema.safeParse({ followupDate: followupDate === "" ? null : followupDate }).success, false);
  }
  assert.equal(followupCreateSchema.safeParse({ followupDate: "2020-01-01" }).success, false);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(followupCreateSchema.safeParse({ followupDate: today, remarks: "Confirm the venue" }).success);
});

test("the follow-up list decides the project's next and last dates", () => {
  const entries = [
    { id: "a", followupDate: "2026-10-05", remarks: "Later call", doneAt: null, createdAt: "2026-09-20" },
    { id: "b", followupDate: "2026-10-01", remarks: "Venue", doneAt: null, createdAt: "2026-09-21", createdByUser: { name: "Asha" } },
    { id: "c", followupDate: "2026-09-10", remarks: "Intro", doneAt: new Date("2026-09-12"), createdAt: "2026-09-01" },
    { id: "d", followupDate: "2026-09-15", remarks: "Dresses", doneAt: new Date("2026-09-18"), createdAt: "2026-09-02" },
  ];
  const summary = followupSummary(entries);
  assert.equal(summary.nextFollowupDate, "2026-10-01");
  assert.equal(summary.lastFollowupDate.toISOString().slice(0, 10), "2026-09-18");
  assert.equal(summary.followupRemarks, "Venue");
  assert.deepEqual(summary.pendingFollowups.map((entry) => entry.id), ["b", "a"]);
  assert.equal(summary.pendingFollowups[0].createdBy, "Asha");
  // Completed ones come back too, most recent first.
  assert.deepEqual(summary.doneFollowups.map((entry) => entry.id), ["d", "c"]);

  // Nothing pending: no next date, and the remarks are the last one's.
  const allDone = followupSummary(entries.filter((entry) => entry.doneAt));
  assert.equal(allDone.nextFollowupDate, null);
  assert.equal(allDone.followupRemarks, "Dresses");
  assert.deepEqual(allDone.pendingFollowups, []);
  assert.deepEqual(followupSummary(), { lastFollowupDate: null, nextFollowupDate: null, followupRemarks: null, pendingFollowups: [], doneFollowups: [] });
});

test("a shoot save cannot smuggle in the project's follow-up", () => {
  const parsed = preProductionUpdateSchema.safeParse({ lastFollowupDate: "2026-09-10", nextFollowupDate: "2026-09-01" });
  // Accepted as a parse — unknown keys are simply dropped — but neither reaches the row.
  assert.ok(parsed.success);
  assert.equal("lastFollowupDate" in parsed.data, false);
  assert.equal("nextFollowupDate" in parsed.data, false);
});

test("reporting time is not held to the event start, because the crew arrives before it", () => {
  assert.ok(preProductionUpdateSchema.safeParse({ eventStartTime: "18:00", reportingTime: "15:00" }).success);
});

test("a completion status sent by hand is not kept, because the screen works it out from the details", () => {
  const parsed = preProductionUpdateSchema.safeParse({ completionStatus: "Completed", reportingTime: "15:00" });
  assert.ok(parsed.success);
  assert.equal("completionStatus" in parsed.data, false);
});

test("every field is optional, so one answer can be saved on its own", () => {
  assert.ok(preProductionUpdateSchema.safeParse({}).success);
  assert.ok(preProductionUpdateSchema.safeParse({ siteVisit: true }).success);
});

test("a cleared field arrives as null and is kept, rather than being read as untouched", () => {
  const parsed = preProductionUpdateSchema.safeParse({ locationAddress: null, reportingTime: null });
  assert.ok(parsed.success);
  assert.equal("locationAddress" in parsed.data, true);
  assert.equal(parsed.data.locationAddress, null);
  assert.equal(parsed.data.reportingTime, null);
});

test("toggles take real booleans only, never the string \"false\"", () => {
  // Coerced, "false" is a non-empty string and reads as true — which is how a toggle ends up stuck
  // on and nobody can turn it off.
  assert.equal(preProductionUpdateSchema.safeParse({ siteVisit: "false" }).success, false);
  assert.equal(preProductionUpdateSchema.safeParse({ travelAccommodationNeeded: "yes" }).success, false);
  assert.ok(preProductionUpdateSchema.safeParse({ siteVisit: false }).success);
});

test("a cleared date stays null instead of becoming 1970", () => {
  const shoot = preProductionUpdateSchema.safeParse({ shootDate: null, meetingDate: null });
  assert.ok(shoot.success);
  assert.equal(shoot.data.shootDate, null);
  assert.equal(shoot.data.meetingDate, null);
});

test("the studio start is Production's now, and pre production's form no longer writes it", () => {
  // Moved to the Production Manager's plan (production/plan.js): sent here, it is dropped, not saved.
  const parsed = preProductionUpdateSchema.safeParse({ studioStartDate: "2026-11-01", studioStartTime: "07:00" });
  assert.ok(parsed.success);
  assert.equal("studioStartDate" in parsed.data, false);
  assert.equal("studioStartTime" in parsed.data, false);
});

// ---------------------------------------------------------------------------
// The vertical checklists
// ---------------------------------------------------------------------------

const { progressStatuses } = require("../src/modules/project-management/pre-production/controller");

test("a checklist question takes Pending or Completed, and null for not taken up", () => {
  for (const field of ["introCall", "introCallGroom", "introCallBride"]) {
    for (const status of progressStatuses) assert.ok(preProductionUpdateSchema.safeParse({ [field]: status }).success, `${field}: ${status}`);
    assert.ok(preProductionUpdateSchema.safeParse({ [field]: null }).success, `${field}: null`);
    assert.equal(preProductionUpdateSchema.safeParse({ [field]: "Done" }).success, false, `${field}: Done refused`);
  }
});

test("the vertical toggles are strict booleans like the base ones", () => {
  // Getting Dresses Images, Getting Decor Images and Post Wedding Gift moved from a
  // Pending/Completed progress column to a plain yes/no here, drawn as the same radio pair.
  for (const field of ["eventScheduleMeeting", "invitationSoftCopy", "siteVisit", "teamReachedMessage", "shootCompletionMessage", "googleReview", "gettingDressesImages", "gettingDecorImages", "postWeddingGift"]) {
    assert.ok(preProductionUpdateSchema.safeParse({ [field]: true }).success, field);
    assert.equal(preProductionUpdateSchema.safeParse({ [field]: "true" }).success, false, `${field}: string refused`);
  }
});

test("meeting time is held to HH:MM and meeting date survives being cleared", () => {
  assert.ok(preProductionUpdateSchema.safeParse({ meetingDate: "2026-09-15", meetingTime: "14:30" }).success);
  assert.equal(preProductionUpdateSchema.safeParse({ meetingTime: "2:30pm" }).success, false);
  const cleared = preProductionUpdateSchema.safeParse({ meetingDate: null });
  assert.ok(cleared.success);
  assert.equal(cleared.data.meetingDate, null);
});

test("a Dum Dum save and a Qua Qua save carry different fields without conflict", () => {
  // The server validates the superset; the vertical only decides which questions the form asks.
  const dumdum = preProductionUpdateSchema.safeParse({ introCallGroom: "Completed", introCallBride: "Pending", groomAddress: "12 Temple St", siteVisit: true, postWeddingGift: false });
  assert.ok(dumdum.success);
  const quaqua = preProductionUpdateSchema.safeParse({ introCall: "Completed", googleReview: true, gettingDressesImages: false });
  assert.ok(quaqua.success);
  // Absent keys stay absent, so one vertical's save can never blank the other's columns.
  assert.equal("introCall" in dumdum.data, false);
  assert.equal("introCallGroom" in quaqua.data, false);
});

test("pre production no longer takes or returns travel mode - it lives on the production plan", () => {
  const parsed = preProductionUpdateSchema.safeParse({ travelMode: "Office Vehicle", travelModeOther: "x", travelVehicleAssetId: 7, reportingTime: "09:00" });
  assert.ok(parsed.success);
  for (const key of ["travelMode", "travelModeOther", "travelVehicleAssetId"]) assert.equal(key in parsed.data, false, key);
  // Nor is it read back, nor offered: the row, the write path and /options name none of it.
  const source = require("node:fs").readFileSync(require.resolve("../src/modules/project-management/pre-production/controller"), "utf8");
  assert.doesNotMatch(source, /travelMode|travelVehicle|vehicleCategoryNames|vehicles/);
});

// ---------------------------------------------------------------------------
// The CRD document, read from the document rather than the note beside it
// ---------------------------------------------------------------------------

const { crdSummary, NO_CRD_DOCUMENT } = require("../src/modules/sales/crd-documents/summary");

const crdSide = {
  firstName: "A", lastName: "B", nameToBeUsedInProject: "A B", instaId: "@ab", dateOfBirth: "1995-01-01",
  photo: "x", contactNumber: "9999999999", streetAddress: "12 Temple St", city: "Erode", state: "TN",
  postalCode: "638001", eventStartAt: "2026-09-10T10:00", eventEndAt: "2026-09-10T22:00", eventAddressLink: "https://maps.example/x",
};
const crdCommon = { whatsappGroupName: "G", eventType: "Wedding", pointOfContactName: "P", pointOfContactPhone: "8888888888", termsAccepted: true };

test("a project with no CRD document reads as Not Issued, not as blank", () => {
  assert.equal(NO_CRD_DOCUMENT.crdDocumentState, "Not Issued");
  assert.equal(NO_CRD_DOCUMENT.crdCompletion, 0);
});

test("which side is received is worked out from the answers, not remembered", () => {
  const groomOnly = crdSummary({ status: "In Progress", submission: { common: crdCommon, groom: crdSide } });
  assert.equal(groomOnly.crdGroomReceived, true);
  assert.equal(groomOnly.crdBrideReceived, false);
  assert.equal(groomOnly.crdSidesReceived, "Groom Side Received");

  const both = crdSummary({ status: "In Progress", submission: { common: crdCommon, groom: crdSide, bride: crdSide } });
  assert.equal(both.crdSidesReceived, "Both Sides Received");
  assert.equal(both.crdCompletion, 100);
});

test("a side missing even one required answer has not been received", () => {
  const { photo, ...withoutPhoto } = crdSide;
  const partial = crdSummary({ status: "In Progress", submission: { common: crdCommon, groom: withoutPhoto } });
  assert.equal(partial.crdGroomReceived, false);
  assert.equal(partial.crdSidesReceived, "Neither Side Received");
});

test("a submitted document says Submitted whatever its stored status column holds", () => {
  // `submittedAt` is the fact; the status column is a label that could lag behind it.
  const stale = crdSummary({ status: "In Progress", submittedAt: new Date("2026-08-20"), submission: { common: crdCommon, groom: crdSide, bride: crdSide } });
  assert.equal(stale.crdDocumentState, "Submitted");
});

test("a Qua Qua document is scored on its own questions, not the wedding's", () => {
  // Every question Qua Qua asks of a maternity shoot - and nothing about a groom or a bride.
  const answered = {
    firstName: "Aadhya", phoneNumber: "9999999999", shootType: "Maternity Shoot", branch: "Erode, TN", termsAccepted: true,
    motherName: "Meera", motherDateOfBirth: "1995-01-01", fatherName: "Arun", fatherBirthday: "1993-05-05", expectedDeliveryDate: "2026-12-01",
  };
  const submitted = crdSummary({ status: "Submitted", vertical: "QQ", submittedAt: new Date("2026-09-20"), submission: answered });
  assert.equal(submitted.crdDocumentState, "Submitted");
  assert.equal(submitted.crdCompletion, 100);
  assert.equal(submitted.crdSidesReceived, null);

  // The project's vertical answers when the row has none of its own.
  const viaProject = crdSummary({ status: "Sent", submission: answered, project: { vertical: "QQ" } });
  assert.equal(viaProject.crdCompletion, 100);
});

test("an unstarted document reads as Sent with nothing received", () => {
  const fresh = crdSummary({ status: "Sent", submission: {} });
  assert.equal(fresh.crdDocumentState, "Sent");
  assert.equal(fresh.crdCompletion, 0);
  assert.equal(fresh.crdSidesReceived, "Neither Side Received");
});

test("switching a gift, the hard disk or CRD on or off is recorded with its reason", () => {
  const { applicabilityChanges } = require("../src/modules/sales/projects/controller");
  const before = { welcomeGift: "Applicable", shootCompletedGift: "Not Applicable", storageNeeded: "Yes", crdDocumentStatus: "Applicable" };
  const changes = applicabilityChanges(before, {
    welcomeGift: "Not Applicable",
    shootCompletedGift: "Applicable",
    storageNeeded: "Yes",
    // Still applicable — which sides arrived is not a switch.
    crdDocumentStatus: "Groom Side Received",
  }, { welcomeGift: "Client declined the kit", shootCompletedGift: "Added in the upgrade" });
  assert.deepEqual(changes, [
    { item: "welcomeGift", fromValue: "Applicable", toValue: "Not Applicable", remarks: "Client declined the kit" },
    { item: "shootCompletedGift", fromValue: "Not Applicable", toValue: "Applicable", remarks: "Added in the upgrade" },
  ]);
  // A field the save did not send is not a change.
  assert.deepEqual(applicabilityChanges(before, {}), []);
  assert.deepEqual(applicabilityChanges(before, { crdDocumentStatus: "Not Applicable" }), [
    { item: "crdDocumentStatus", fromValue: "Applicable", toValue: "Not Applicable", remarks: null },
  ]);
});

test("Production Master and Production Team Allocation are no longer taken", () => {
  // Removed from both checklists; a save still sending them is not refused, but nothing is kept.
  const parsed = preProductionUpdateSchema.safeParse({ productionMaster: "Completed", productionTeamAllocation: "Pending", introCall: "Completed" });
  assert.ok(parsed.success);
  assert.equal("productionMaster" in parsed.data, false);
  assert.equal("productionTeamAllocation" in parsed.data, false);
});

test("pre production no longer takes a Production Coordinator - it lives on the production plan", () => {
  const parsed = preProductionUpdateSchema.safeParse({ productionCoordinatorEmployeeId: 9, reportingTime: "09:00" });
  assert.ok(parsed.success);
  assert.equal("productionCoordinatorEmployeeId" in parsed.data, false);
});

test("the pre production board shows every project to whoever may work every project, not only the named coordinator", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/modules/project-management/pre-production/controller.js"), "utf8");
  assert.match(source, /iamService\.hasPermission\(Number\(req\.user\.id\), "PROJECT", "Show All Projects", "READ_WRITE"\)/);
  assert.match(source, /\.\.\.\(!seesEveryProject \? \{ preProductionCoordinatorEmployeeId: account\.linkedEmployeeId \} : \{\}\)/);
});


test("the Pre Production form saves the shoot's own date on the shoot, and a cleared one as none", () => {
  const { preProductionUpdateSchema } = require("../src/modules/project-management/pre-production/controller");
  assert.equal(preProductionUpdateSchema.safeParse({ shootDate: "2026-11-20" }).data.shootDate.toISOString().slice(0, 10), "2026-11-20");
  assert.equal(preProductionUpdateSchema.safeParse({ shootDate: null }).data.shootDate, null, "cleared - Shoot Date Known: No");
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/modules/project-management/pre-production/controller.js"), "utf8");
  // Written to ProjectShoot.dateCreated - the date Edit Project shows - not kept a second time here.
  assert.match(source, /\.\.\.\("shootDate" in parsed\.data \? \{ dateCreated: shootDate \} : \{\}\),/);
});

test("Concepts Needed is a yes/no of its own, and No empties the list on save", () => {
  assert.equal(preProductionUpdateSchema.parse({ conceptsNeeded: false }).conceptsNeeded, false);
  assert.equal(preProductionUpdateSchema.parse({ conceptsNeeded: true, concepts: [] }).conceptsNeeded, true);
  const controller = require("node:fs").readFileSync(require.resolve("../src/modules/project-management/pre-production/controller"), "utf8");
  assert.match(controller, /if \(conceptsNeeded === false\) nextConcepts = \[\];/);
  assert.match(controller, /if \(conceptsNeeded !== undefined\) data\.conceptsNeeded = conceptsNeeded;\n\s+else if \(nextConcepts\) data\.conceptsNeeded = nextConcepts\.length > 0;/);
});

test("an indoor shoot's branch is an id the save checks against the studio's working branches", () => {
  assert.equal(preProductionUpdateSchema.parse({ shootBranchId: "4" }).shootBranchId, 4);
  assert.equal(preProductionUpdateSchema.parse({ shootBranchId: null }).shootBranchId, null);
  assert.equal(preProductionUpdateSchema.safeParse({ shootBranchId: 0 }).success, false);
  const controller = require("node:fs").readFileSync(require.resolve("../src/modules/project-management/pre-production/controller"), "utf8");
  assert.match(controller, /transaction\.branch\.findFirst\(\{ where: \{ id: data\.shootBranchId, isActive: true \}/);
  assert.match(controller, /shootBranchName: record\.shootBranch\?\.name \|\| null/);
});
