const test = require("node:test");
const assert = require("node:assert/strict");
const { toBoardRow, toDetail } = require("../src/modules/project-management/production/read");

const base = (overrides = {}) => ({
  id: "prod-1",
  shootId: "shoot-1",
  productionCoordinatorEmployeeId: 9,
  productionCoordinatorEmployee: { employeeName: "Ravi" },
  planSubmittedAt: new Date("2026-09-30T04:00:00Z"),
  currentStep: "PINEAPPLE_MEETING",
  shootStatus: null,
  travelMode: "Train",
  remarks: "Carry rain covers",
  updatedAt: new Date("2026-09-30T05:00:00Z"),
  shoot: { id: "shoot-1", shootId: "DBS-SID-1", shoot: "Reception", dateCreated: new Date("2026-10-02T00:00:00Z"), shootPlace: "Erode", district: "Erode", preProduction: { locationAddress: "Hall A", locationLink: null, reportingTime: "08:00" }, postProductionAllocations: [{ id: "alloc-live", serviceDefinitionId: "def-candid", serviceName: "Candid", serviceDetails: "2 photographers" }] },
  salesProject: { id: "project-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha weds Arun", whatsappGroupNameId: null, productionManager: "Old copy", productionManagerEmployeeId: 5, productionManagerEmployee: { employeeName: "Meena" }, whatsappGroupSubject: "Asha & Arun" },
  teamMembers: [{ employeeId: 12, employee: { employeeName: "Kavin" } }],
  serviceCrew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: 12, employee: { employeeName: "Kavin" }, vendorId: null, vendor: null, vendorStatus: null, cameras: [{ cameraAssetId: 3, cameraAsset: { assetName: "Sony A7", assetCode: "AST-3" } }, { cameraAssetId: 5, cameraAsset: { assetName: "Canon R5", assetCode: "AST-5" } }] }],
  files: [],
  // `error` is the raw send error - read.js must never surface it; `reason` is the short safe wording.
  messages: [{ step: "STARTED_FROM_STUDIO", status: "FAILED", error: "WhatsApp is not connected.", reason: "WhatsApp not connected", sentAt: null }],
  planSubmittedByUser: { name: "Meena" },
  footageBackupByEmployee: null,
  ...overrides,
});

test("a board row carries the pending pill and reads the manager's name through the link", () => {
  const row = toBoardRow(base(), new Map());
  assert.equal(row.pending, "Step 3/7 · Pineapple meeting");
  assert.equal(row.productionManager, "Meena");
  assert.equal(row.clientName, "Asha weds Arun");
});

test("a board row carries where and what kind of shoot it is, for the Schedule's optional columns", () => {
  const record = base();
  Object.assign(record.shoot, { district: "Erode", state: "Tamil Nadu", shootType: "Outdoor / On-Location" });
  const row = toBoardRow(record, new Map());
  assert.deepEqual([row.district, row.state, row.shootType], ["Erode", "Tamil Nadu", "Outdoor / On-Location"]);
  // An empty one reads as nothing, not as "".
  Object.assign(record.shoot, { district: "", state: "", shootType: "" });
  const empty = toBoardRow(record, new Map());
  assert.deepEqual([empty.district, empty.state, empty.shootType], [null, null, null]);
});

test("a board row carries its Assist as the Schedule's picker holds it, leaving out anybody kept by name only", () => {
  const record = base();
  record.teamMembers = [
    { employeeId: 12, employee: { employeeName: "Kavin" } },
    { vendorId: 22, vendor: { vendorName: "Drone Crew" } },
    { employeeName: "Left Long Ago" },
  ];
  const row = toBoardRow(record, new Map());
  // The id the picker holds, and the name beside it - a person the picker no longer offers (left,
  // or moved out of Technical) is still named on their chip rather than read back as "emp:12".
  assert.deepEqual(row.assistPeople, [
    { value: "emp:12", label: "Kavin" },
    { value: "ven:22", label: "EXT-Drone Crew" },
  ]);
  assert.equal(row.assist.length, 3, "the names still read every one of them");
});

test("the board row names each service's person and the shoot's Assist, in the studio's order, for the Services view", () => {
  const record = base();
  // Booked LED Wall before Drone, and carrying the studio's order the read selects beside each one:
  // the row lists them in that order (Candid 4, Drone 8, LED Wall 21), not in the booked one.
  record.shoot.postProductionAllocations = [
    { serviceDefinitionId: "def-candid", serviceName: "Candid", serviceDefinition: { sortOrder: 4 } },
    { serviceDefinitionId: "def-led", serviceName: "LED Wall", serviceDefinition: { sortOrder: 21 } },
    { serviceDefinitionId: "def-drone", serviceName: "Drone", serviceDefinition: { sortOrder: 8 } },
  ];
  record.serviceCrew = [...record.serviceCrew, { serviceDefinitionId: "def-led", role: "LEAD", employeeId: null, employee: null, vendorId: 4, vendor: { vendorName: "Venu Videos", sourceType: "EXT", businessRegistrationName: "Venu Videos LLP", city: "Erode" }, vendorStatus: null, cameras: [] }];
  record.teamMembers = [{ employeeId: 12, employee: { employeeName: "Kavin" } }, { employeeId: null, vendorId: 4, vendor: { vendorName: "Venu Videos", sourceType: "EXT", businessRegistrationName: "Venu Videos LLP", city: "Erode" } }, { employeeId: null, vendorId: null, employeeName: "Old copy" }];
  const row = toBoardRow(record, new Map());
  assert.deepEqual(row.services, [
    { definitionId: "def-candid", name: "Candid", employeeId: 12, vendorId: null, person: "Kavin", vendor: false, vendorStatus: null },
    // A service nobody is on says so with no person.
    { definitionId: "def-drone", name: "Drone", employeeId: null, vendorId: null, person: null, vendor: false, vendorStatus: null },
    // A vendor is Waiting until they confirm.
    { definitionId: "def-led", name: "LED Wall", employeeId: null, vendorId: 4, person: "EXT-Venu Videos (Venu Videos LLP, Erode)", vendor: true, vendorStatus: "WAITING" },
  ]);
  assert.deepEqual(row.assist, ["Kavin", "EXT-Venu Videos (Venu Videos LLP, Erode)", "Old copy"]);
});

test("a service Edit Project removed is dropped from the plan", () => {
  const detail = toDetail(base(), new Map(), { employeeId: 5, superAdmin: false });
  assert.deepEqual(detail.plan.services, [{
    id: "alloc-live", definitionId: "def-candid", name: "Candid", details: "2 photographers", // A service's own person only - assistants are the shoot's Assist.
    // Settings → Project → Services, "Deliverable added": File in asks a copy only where it is Yes,
    // and this fixture's definition does not answer it.
    deliverableAdded: false,
    roles: ["LEAD"],
    // An employee in the seat carries their cameras and no vendor status; a vendor is the other way round.
    crew: { LEAD: { employeeId: 12, employeeName: "Kavin", vendorId: null, vendorName: null, vendorStatus: null, cameras: [{ cameraAssetId: 3, cameraName: "Sony A7 (AST-3)" }, { cameraAssetId: 5, cameraName: "Canon R5 (AST-5)" }] } },
  }]);
});

test("the detail says who may do what", () => {
  const detail = toDetail(base(), new Map(), { employeeId: 9, superAdmin: false, runsExecution: true });
  assert.equal(detail.canEditPlan, false);
  assert.equal(detail.canRunSteps, true);
  // Named, but without PROJECT / Production Execution: the steps are read, not run.
  assert.equal(toDetail(base(), new Map(), { employeeId: 9, superAdmin: false }).canRunSteps, false);
  assert.equal(detail.location, "Hall A");
  assert.equal(detail.messages[0].status, "FAILED");
});

test("the shoot detail carries the safe reason, never the raw send error - any Production READ viewer can read it", () => {
  const detail = toDetail(base(), new Map(), { employeeId: 77, superAdmin: false });
  assert.equal(detail.messages[0].reason, "WhatsApp not connected");
  assert.equal(detail.messages[0].error, undefined);
});

test("a file is downloaded only for a shoot the viewer can see, and only from our own bucket or an inline data URI", async () => {
  const { fileDownload } = require("../src/modules/project-management/production/read");
  const { createProductionFake, productionRow } = require("./production-fake-client");
  const scope = { resolve: async () => ({ unlimited: true }) };
  const files = [
    { id: "f-inline", productionId: "prod-1", kind: "TICKET", url: "data:image/png;base64,iVBORw0KGgo=", fileName: "ticket.png", mimeType: "image/png" },
    { id: "f-foreign", productionId: "prod-1", kind: "TICKET", url: "https://evil.example/x.png", fileName: "x.png", mimeType: "image/png" },
    { id: "f-other", productionId: "prod-9", kind: "TICKET", url: "data:image/png;base64,AA==", fileName: "y.png", mimeType: "image/png" },
  ];
  const client = createProductionFake({ productions: [productionRow()], files });
  let fetched = false;
  const fetchUrl = async () => { fetched = true; return { ok: true }; };
  const inline = await fileDownload(1, "shoot-1", "f-inline", { client, scope, iam: { hasPermission: async () => false }, fetchUrl });
  assert.equal(inline.contentType, "image/png");
  assert.equal(inline.fileName, "ticket.png");
  await assert.rejects(fileDownload(1, "shoot-1", "f-foreign", { client, scope, iam: { hasPermission: async () => false }, fetchUrl }), (error) => error.status === 400);
  assert.equal(fetched, false, "a URL that is not our bucket is never fetched");
  await assert.rejects(fileDownload(1, "shoot-1", "f-other", { client, scope, iam: { hasPermission: async () => false }, fetchUrl }), (error) => error.status === 404);
});

test("the activity log is the Production Manager's and above, not the coordinator's", async () => {
  const { listActivity } = require("../src/modules/project-management/production/read");
  const production = { id: "prod-1", productionCoordinatorEmployeeId: 9, salesProject: { productionManagerEmployeeId: 5 } };
  const userOf = { 20: { id: 20, name: "Meena", linkedEmployeeId: 5 }, 21: { id: 21, name: "Ravi", linkedEmployeeId: 9 } };
  const client = {
    user: { findUnique: async ({ where }) => userOf[where.id] },
    projectProduction: { findFirst: async () => production },
    projectProductionActivity: { findMany: async () => [{ id: 1, action: "PLAN_SAVED" }] },
  };
  const scope = { resolve: async () => ({ unlimited: true }), bypassesHierarchy: async () => false };
  const iam = { hasPermission: async () => false };
  assert.equal((await listActivity(20, "shoot-1", { client, scope, iam })).length, 1);
  await assert.rejects(listActivity(21, "shoot-1", { client, scope, iam }), (error) => error.status === 403);
});

test("a coordinator, team member and backup kept by name (somebody who has left) are shown as written", () => {
  const left = base({
    productionCoordinatorEmployeeId: null, productionCoordinatorEmployee: null, productionCoordinatorName: "Sudeep",
    teamMembers: [{ employeeId: 12, employee: { employeeName: "Kavin" }, vendorId: null }, { employeeId: null, employee: null, employeeName: "Ajeesh", vendorId: null, vendor: null }],
    footage: [{ serviceDefinitionId: null, footageUrl: "https://drive.example/x", backedUpByEmployeeId: null, backedUpByEmployee: null, backedUpByName: "Ravi", fileCount: 3, size: "1 GB", firstFileName: "a", lastFileName: "c" }],
  });
  assert.equal(toBoardRow(left, new Map()).productionCoordinator, "Sudeep");
  const detail = toDetail(left, new Map(), {});
  assert.equal(detail.plan.productionCoordinator, "Sudeep");
  assert.equal(detail.plan.productionCoordinatorEmployeeId, null);
  assert.deepEqual(detail.plan.team.map((member) => member.name), ["Kavin", "Ajeesh"]);
  assert.equal(detail.execution.footage[0].backedUpBy, "Ravi");
  // A linked coordinator is still read from the employee, whatever text sits beside it.
  assert.equal(toBoardRow(base({ productionCoordinatorName: "Stale" }), new Map()).productionCoordinator, "Ravi");
});

test("the Activity tab reads newest first", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/modules/project-management/production/read.js"), "utf8");
  const activity = source.slice(source.indexOf("async function listActivity("));
  assert.match(activity, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
});

test("the plan's summary is the project and shoot as known, each person read through the link", () => {
  const record = base();
  record.salesProject = { ...record.salesProject, clientMainNumber: "9876543210", mainEventDateKnown: false, mainEventDate: new Date("2026-10-10T00:00:00Z"), crmName: "Old CRM", crmEmployee: { employeeName: "Priya" }, projectManager: "Only copy", projectManagerEmployee: null };
  record.shoot = { ...record.shoot, shootType: "Outdoor / On-Location", travel: "Client", accommodation: "Studio" };
  const { summary } = toDetail(record, new Map(), { employeeId: 5, superAdmin: false });
  assert.equal(summary.clientMainNumber, "9876543210");
  assert.equal(summary.mainEventDate, null, "a main event date not known is not shown");
  assert.equal(summary.crm, "Priya");
  assert.equal(summary.projectManager, "Only copy");
  assert.equal(summary.travelPaidBy, "Client");
});

test("a plan reads Planned once its mandatory parts are filled: coordinator, an outdoor shoot's travel mode and studio start, each service's person", () => {
  /*
   * The **mandatory** parts and nothing else. A camera on each service, the chosen mode's detail
   * (plate, vehicle, ticket, the line for Other), the assistants and the remarks are all part of the
   * plan and none of them is counted - a plan with a person on every service used to sit at three
   * quarters because a camera had not been picked.
   */
  const { planMissing, planProgress } = require("../src/modules/project-management/production/planCompleteness");
  const shoot = { shootType: "Outdoor / On-Location", postProductionAllocations: [{ serviceDefinitionId: "def-candid", serviceName: "Candid Photo" }] };
  // When the crew leaves the studio: an outdoor shoot's, beside its Travel Mode.
  const start = { studioStartDate: new Date("2026-10-02T00:00:00Z"), studioStartTime: "07:00" };
  assert.deepEqual(planMissing({ productionCoordinatorEmployeeId: 9, _count: {}, shoot, serviceCrew: [] }), ["Travel Mode", "Studio Start Date", "Studio Start Time", "Candid Photo - Person"], "no Production Team and no camera to fill");
  assert.deepEqual(planProgress({ productionCoordinatorEmployeeId: 9, _count: {}, shoot, serviceCrew: [] }), { filled: 1, total: 5, percent: 20 });
  const lead = { serviceDefinitionId: "def-candid", role: "LEAD", employeeId: 12, cameras: [] };
  // An employee and no camera completes it.
  assert.deepEqual(planMissing({ productionCoordinatorEmployeeId: 9, _count: { teamMembers: 2 }, travelMode: "Own", ...start, shoot, serviceCrew: [lead] }), []);
  // The studio start is counted on its own: a plan with everything else is still short of it.
  assert.deepEqual(planMissing({ productionCoordinatorEmployeeId: 9, _count: {}, travelMode: "Own", studioStartDate: start.studioStartDate, shoot, serviceCrew: [lead] }), ["Studio Start Time"]);
  /*
   * A **vendor** in that seat answers with where they stand instead of a camera, and the service is
   * not planned until they are Confirmed: a vendor Waiting has not held the day yet. One saved before
   * the status was asked has none, and reads as waiting.
   */
  const vendor = { ...lead, employeeId: null, vendorId: 4 };
  const withVendor = (vendorStatus) => ({ productionCoordinatorEmployeeId: 9, _count: {}, travelMode: "Own", ...start, shoot, serviceCrew: [{ ...vendor, vendorStatus }] });
  assert.deepEqual(planMissing(withVendor("CONFIRMED")), []);
  assert.deepEqual(planMissing(withVendor("WAITING")), ["Candid Photo - Vendor confirmed"]);
  assert.deepEqual(planMissing(withVendor(null)), ["Candid Photo - Vendor confirmed"]);
  assert.deepEqual(planProgress(withVendor("WAITING")), { filled: 5, total: 6, percent: 83 }, "its own part of the plan");
  // The mode itself is mandatory: without it an outdoor plan is short, whatever else is filled.
  assert.deepEqual(planMissing({ productionCoordinatorEmployeeId: 9, _count: {}, ...start, shoot, serviceCrew: [lead] }), ["Travel Mode"]);
  // A ticket mode's ticket no longer holds it: the status is recorded, not counted.
  assert.deepEqual(planMissing({ productionCoordinatorEmployeeId: 9, _count: { files: 0 }, travelMode: "Train", ticketStatus: "YET_TO_TAKE", ...start, shoot, serviceCrew: [lead] }), []);
  // An indoor shoot is never asked about travel; Remarks and assistants are never asked.
  assert.deepEqual(planMissing({ productionCoordinatorEmployeeId: 9, _count: { teamMembers: 1 }, shoot: { shootType: "Studio / In-House", postProductionAllocations: [] }, serviceCrew: [] }), []);
  assert.deepEqual(planMissing({ _count: {}, shoot: { shootType: "Studio / In-House", postProductionAllocations: [] }, serviceCrew: [] }), ["Production Coordinator"], "the coordinator is mandatory on every shoot");
});

test("Bus, Train and Flight carry a ticket status, recorded rather than counted", () => {
  /*
   * The status says where the tickets stand for whoever reads the plan. It used to hold the plan
   * short - Yet to Take, or Taken with nothing attached, read as an unfilled part - and now the only
   * parts counted are the coordinator, the travel mode and each service's person.
   */
  const T = require("../src/modules/project-management/production/travel");
  const { planMissing } = require("../src/modules/project-management/production/planCompleteness");
  assert.deepEqual(T.TICKET_STATUSES, ["YET_TO_TAKE", "TAKEN", "ON_THE_FLY"]);
  const shoot = { shootType: "Outdoor / On-Location", postProductionAllocations: [] };
  const plan = (ticketStatus, files) => ({ productionCoordinatorEmployeeId: 9, travelMode: "Flight", studioStartDate: new Date("2026-10-02T00:00:00Z"), studioStartTime: "07:00", ticketStatus, _count: { files }, shoot, serviceCrew: [] });
  for (const status of [...T.TICKET_STATUSES, null]) {
    assert.deepEqual(planMissing(plan(status, 0)), [], `${status} does not hold the plan short`);
  }
  // The mode's detail is not asked for at all: only the mode itself is mandatory.
  assert.equal(T.travelSubmitRefusal, undefined);
});

test("the ticket status is kept only on a ticket mode, and refused unless one of the three", () => {
  const { planSchema } = require("../src/modules/project-management/production/controller");
  assert.ok(planSchema.safeParse({ travelMode: "Train", ticketStatus: "ON_THE_FLY" }).success);
  assert.equal(planSchema.safeParse({ ticketStatus: "BOOKED" }).success, false);
  const plan = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/modules/project-management/production/plan.js"), "utf8");
  assert.match(plan, /ticketStatus: T\.takesTickets\(mode\) \? pick\("ticketStatus", production\.ticketStatus\) \|\| null : null,/);
});
