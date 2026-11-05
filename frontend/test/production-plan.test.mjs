import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { keptNamesLine, productionPlanForm, productionPlanPayload, productionPlanOptions, takesTickets, ticketSection } from "../src/lib/productionPlan.mjs";

const detail = {
  plan: {
    productionCoordinatorEmployeeId: 9, productionCoordinator: "Ravi",
    team: [{ employeeId: 12, vendorId: null, name: "Kavin" }, { employeeId: null, vendorId: 22, name: "Drone Crew" }], travelMode: "Train", studioStartDate: "2026-11-01",
    services: [
      { id: "alloc-1", definitionId: "def-candid", name: "Candid Photo", roles: ["LEAD", "ASSISTANT_1", "ASSISTANT_2"],
        crew: { LEAD: { employeeId: 13, employeeName: "Anu", cameras: [{ cameraAssetId: 3, cameraName: "Sony A7 (AST-3)" }, { cameraAssetId: 4, cameraName: "Canon R5 (AST-4)" }] }, ASSISTANT_1: { vendorId: 21, vendorName: "EXT-Lens Hire (Lens Hire LLP, Erode)" } } },
      { id: "alloc-2", definitionId: "def-booth", name: "360 Video Booth", roles: ["LEAD"], crew: {} },
      { id: "alloc-3", definitionId: null, name: "Old service", roles: ["LEAD"], crew: {} },
    ],
    remarks: "Rain covers",
  },
};

test("the form holds every id as a string, the way the pickers compare them", () => {
  assert.deepEqual(productionPlanForm(detail), {
    planStatusControl: { choice: "AUTO", remarks: "", followupDate: "" },
    // The shoot's Assist is its Production Team (`team`), plus an assistant a service was given before -
    // ven:21, the candid service's old Assistant 1 - listed once, so the next save keeps them on the shoot.
    productionCoordinatorEmployeeId: "9", travelMode: "Train", ticketStatus: "",
    travelModeOther: "", vehicleNumberPlate: "", travelVehicleAssetId: "",
    studioStartDate: "2026-11-01", studioStartTime: "",
    // The service's own person carries where a vendor stands (`vendorStatus`), or an employee's cameras.
    // A seat may carry several: a shooter working two bodies is one person on one service.
    crew: [
      { definitionId: "def-candid", role: "LEAD", person: "emp:13", cameraAssetIds: ["3", "4"], vendorStatus: "" },
      { definitionId: "def-booth", role: "LEAD", person: "", cameraAssetIds: [], vendorStatus: "" },
    ],
    assist: ["emp:12", "ven:22", "ven:21"],
    remarks: "Rain covers",
  });
  assert.equal(productionPlanForm(null).productionCoordinatorEmployeeId, "");
});

test("the payload turns them back into what the server validates", () => {
  const payload = productionPlanPayload(productionPlanForm(detail), true);
  assert.deepEqual(payload, {
    submit: true, productionCoordinatorEmployeeId: 9, travelMode: "Train", ticketStatus: null,
    travelModeOther: null, vehicleNumberPlate: null, travelVehicleAssetId: null,
    studioStartDate: "2026-11-01", studioStartTime: null,
    crew: [
      { serviceDefinitionId: "def-candid", role: "LEAD", employeeId: 13, vendorId: null, cameraAssetIds: [3, 4] },
      { serviceDefinitionId: "def-booth", role: "LEAD", employeeId: null, vendorId: null, cameraAssetIds: [] },
    ],
    // The shoot's Assist, whole - an assistant carries neither a camera nor a status.
    team: [{ employeeId: 12, vendorId: null }, { employeeId: null, vendorId: 22 }, { employeeId: null, vendorId: 21 }],
    remarks: "Rain covers",
  });
  assert.equal(productionPlanPayload({ ...productionPlanForm(null) }, false).productionCoordinatorEmployeeId, null);
});

test("a chosen value missing from today's list still shows its name", () => {
  const options = productionPlanOptions({ employees: [{ id: 12, employeeName: "Kavin", employeeId: "E12" }], cameras: [], vendors: [] }, detail);
  assert.deepEqual(options.employees.map((option) => option.value), ["12", "9"]);
  /*
   * A service's person: the employees, then **every** active vendor as "EXT-name (business, city)" - the studio hires
   * whoever is free, and the vendor's "Can be a production team member?" tick no longer narrows the
   * list. One already on a service (Lens Hire) still shows, however their record reads now.
   */
  const people = productionPlanOptions({ employees: [{ id: 12, employeeName: "Kavin" }], vendors: [{ id: 7, vendorName: "Lights Co", sourceType: "EXT", businessRegistrationName: "Lights Co Pvt Ltd", city: "Erode" }, { id: 8, vendorName: "Crew Co", city: "Coimbatore", canBeProductionTeamMember: true }] }, detail).people;
  assert.deepEqual(people.map((option) => [option.value, option.label]), [["emp:12", "Kavin"], ["ven:7", "EXT-Lights Co (Lights Co Pvt Ltd, Erode)"], ["ven:8", "EXT-Crew Co (Coimbatore)"], ["emp:13", "Anu"], ["ven:21", "EXT-Lens Hire (Lens Hire LLP, Erode)"]]);
  assert.deepEqual(options.cameras.map((option) => option.label), ["Sony A7 (AST-3)", "Canon R5 (AST-4)"]);
  assert.equal(options.team, undefined, "no Production Team list");
  assert.equal(options.employees[0].label, "Kavin (E12)");
});

test("each travel mode sends only its own detail; the rest go as null", () => {
  const form = { ...productionPlanForm(null), travelModeOther: "Tempo", vehicleNumberPlate: " tn01 ", travelVehicleAssetId: "21" };
  const pick = (travelMode) => {
    const payload = productionPlanPayload({ ...form, travelMode }, false);
    return [payload.travelModeOther, payload.vehicleNumberPlate, payload.travelVehicleAssetId];
  };
  assert.deepEqual(pick("Car"), [null, "TN01", null]);
  assert.deepEqual(pick("Own"), [null, "TN01", null]);
  assert.deepEqual(pick("Office Vehicle"), [null, null, 21]);
  assert.deepEqual(pick("Other"), ["Tempo", null, null]);
  assert.deepEqual(pick("Bus"), [null, null, null]);
});

test("the plan's travel detail comes back into the form, and its vehicle stays listed once retired", () => {
  const withVehicle = { plan: { ...detail.plan, travelMode: "Office Vehicle", travelVehicle: { id: 21, name: "Innova (AST-21)" }, vehicleNumberPlate: null, travelModeOther: null } };
  assert.equal(productionPlanForm(withVehicle).travelVehicleAssetId, "21");
  const options = productionPlanOptions({ vehicles: [{ id: 22, assetName: "Eeco", assetCode: "AST-22" }] }, withVehicle);
  assert.deepEqual(options.vehicles, [{ value: "22", label: "Eeco (AST-22)" }, { value: "21", label: "Innova (AST-21)" }]);
  assert.deepEqual(options.travelModes, []);
});

test("tickets belong to Bus, Train and Flight; earlier ones are kept under their own heading", () => {
  assert.deepEqual(["Bus", "Train", "Flight", "Own", "Car", "Office Vehicle", "Other", ""].map(takesTickets), [true, true, true, false, false, false, false, false]);
  const tickets = [{ id: "t-1" }];
  // A ticket mode: the upload is offered once its Ticket Status is Taken, saved or not - the upload
  // itself carries the mode to the server. A plan from before the status was asked keeps its tickets.
  assert.deepEqual(ticketSection({ mode: "Train", status: "TAKEN", tickets: [] }), { title: "Tickets", canAdd: true });
  assert.deepEqual(ticketSection({ mode: "Train", tickets }), { title: "Tickets", canAdd: true });
  // Yet to Take or On the Fly: nothing to attach.
  assert.equal(ticketSection({ mode: "Train", status: "YET_TO_TAKE", tickets: [] }), null);
  assert.equal(ticketSection({ mode: "Flight", status: "ON_THE_FLY", tickets: [] }), null);
  // Moved off a ticket mode: the tickets stay, under the earlier mode, and none can be added.
  assert.deepEqual(ticketSection({ mode: "Car", tickets }), { title: "From the earlier travel mode", canAdd: false });
  // No ticket mode and no tickets: nothing is drawn.
  assert.equal(ticketSection({ mode: "Other", tickets: [] }), null);
});

test("people kept by name (somebody who has left) are named in a line, and are not in the pickers", () => {
  const plan = { productionCoordinatorEmployeeId: null, productionCoordinator: "Sudeep", team: [{ employeeId: 12, vendorId: null, name: "Kavin" }, { employeeId: null, vendorId: null, name: "Ajeesh" }] };
  assert.equal(keptNamesLine(plan), "Production Coordinator: Sudeep · Production Team: Ajeesh");
  // A linked coordinator and a linked or vendor team are the pickers' business, not this line's.
  assert.equal(keptNamesLine(detail.plan), "");
  assert.equal(keptNamesLine({}), "");
  // There is no team picker, so a save never sends the team back at all.
  assert.equal(productionPlanForm({ plan }).team, undefined);
});

test("a vendor on a service is asked where they stand, in place of the camera an employee is asked for", () => {
  /*
   * A vendor holds the day and says so - Waiting until they confirm, Confirmed once they have - and
   * the studio's camera belongs to an employee in that seat. The service is not planned while its
   * vendor is Waiting (`planCompleteness`), so a vendor arrives on Waiting.
   */
  const detail = { plan: { services: [
    { definitionId: "a", name: "Candid Photo", roles: ["LEAD"], crew: { LEAD: { vendorId: 7, vendorName: "Lights Co", vendorStatus: "WAITING" } } },
    { definitionId: "b", name: "Video", roles: ["LEAD"], crew: { LEAD: { employeeId: 9, cameras: [{ cameraAssetId: 3, cameraName: "Sony A7" }] } } },
  ] } };
  const form = productionPlanForm(detail);
  assert.deepEqual(form.crew.map((row) => [row.person, row.cameraAssetIds, row.vendorStatus]), [["ven:7", [], "WAITING"], ["emp:9", ["3"], ""]]);
  // What each seat sends: a vendor its status and no camera, an employee its cameras and no status.
  const sent = productionPlanPayload({ ...form, crew: form.crew.map((row) => (row.definitionId === "a" ? { ...row, vendorStatus: "CONFIRMED" } : row)) }, false).crew;
  assert.deepEqual(sent[0], { serviceDefinitionId: "a", role: "LEAD", employeeId: null, vendorId: 7, vendorStatus: "CONFIRMED" });
  assert.deepEqual(sent[1], { serviceDefinitionId: "b", role: "LEAD", employeeId: 9, vendorId: null, cameraAssetIds: [3] });
  // A vendor chosen on the form, with nothing answered yet, is sent as waiting rather than as nothing.
  const fresh = productionPlanPayload({ ...form, crew: [{ definitionId: "a", role: "LEAD", person: "ven:21", vendorStatus: "" }] }, false).crew;
  assert.equal(fresh[0].vendorStatus, "WAITING");
  assert.equal("cameraAssetIds" in fresh[0], false);
});

test("the seat draws one control or the other, and the status says it is required", () => {
  const field = fs.readFileSync(new URL("../src/components/project-management/production/ProductionServiceCrew.js", import.meta.url), "utf8");
  assert.match(field, /role === "LEAD" && \(isVendorPerson\(row\.person\)/, "the person chosen decides which");
  assert.match(field, /label="Status"\n\s+required\n\s+(?:helperText="[^"]*"\n\s+)?value=\{row\.vendorStatus \|\| "WAITING"\}/);
  assert.match(field, /options=\{VENDOR_STATUS_OPTIONS\}/);
  assert.match(field, /label="Cameras"/, "and an employee picks the cameras the seat carries");
});

test("the counted answers carry the asterisk: the coordinator always, the mode and studio start outdoors only", async () => {
  /*
   * The mark follows the rule: the mode is mandatory beside the coordinator and each service's person
   * (`planCompleteness`), and an indoor shoot has no travel at all - an asterisk there would be asking
   * for something nothing wants. `required` is read as a function the way `label` already is, by the
   * panel that draws the field and by the check that refuses a save, so the two cannot disagree.
   */
  const { productionPlanSections } = await import("../src/constants/productionFormConfig.js");
  const requiredProblems = (await import("../src/components/schema-form/requiredProblems.js")).default;
  const mode = productionPlanSections.flatMap((section) => section.fields).find((field) => field.name === "travelMode");
  assert.equal(typeof mode.required, "function");
  assert.equal(mode.required({}, { indoor: false }), true);
  assert.equal(mode.required({}, { indoor: true }), false);
  // When the crew leaves the studio: marked and counted exactly as the mode is.
  for (const name of ["studioStartDate", "studioStartTime"]) {
    const field = productionPlanSections.flatMap((section) => section.fields).find((entry) => entry.name === name);
    assert.equal(field.required({}, { indoor: false }), true, name);
    assert.equal(field.required({}, { indoor: true }), false, name);
  }
  // The coordinator is mandatory on every shoot, indoor or out, so its mark is plain `true`.
  const coordinator = productionPlanSections.flatMap((section) => section.fields).find((field) => field.name === "productionCoordinatorEmployeeId");
  assert.equal(coordinator.required, true);
  // Unanswered on an outdoor shoot, the save is refused naming both, and it points at the first.
  const outdoor = requiredProblems(productionPlanSections, [], {}, { indoor: false });
  assert.deepEqual([outdoor.hasProblems, outdoor.labels, outdoor.firstSectionId], [true, ["Production Coordinator", "Travel Mode", "Studio Start Date", "Studio Start Time"], "people"]);
  assert.equal(outdoor.marks.travelMode, "Required");
  assert.equal(outdoor.marks.productionCoordinatorEmployeeId, "Required");
  const answered = { productionCoordinatorEmployeeId: "9", travelMode: "Own", studioStartDate: "2026-10-02", studioStartTime: "07:00" };
  assert.equal(requiredProblems(productionPlanSections, [], answered, { indoor: false }).hasProblems, false);
  /*
   * An indoor shoot is not asked for travel at all: the section is left off its form - there is no
   * journey to plan from the studio it is already in - so the only thing it is held for is the
   * coordinator, which every shoot needs.
   */
  const travel = productionPlanSections.find((section) => section.id === "travel");
  assert.equal(travel.when({}, { indoor: true }), false, "no Travel section on an indoor shoot");
  assert.equal(travel.when({}, { indoor: false }), true);
  const indoor = requiredProblems(productionPlanSections, [], {}, { indoor: true });
  assert.deepEqual(indoor.labels, ["Production Coordinator"]);
  assert.equal(requiredProblems(productionPlanSections, [], { productionCoordinatorEmployeeId: "9" }, { indoor: true }).hasProblems, false);
  // The panel tells the form which kind of shoot it is.
  const panel = fs.readFileSync(new URL("../src/components/project-management/production/ProductionShootPanel.js", import.meta.url), "utf8");
  assert.match(panel, /indoor: Boolean\(detail\?\.indoor\),/);
});

test("Mark as pending saves what is filled in and leaves the plan unsubmitted", () => {
  /*
   * A shoot with several services is rarely crewed in one sitting. Submit plan is held to a finished
   * plan, so before this the half-filled one could not be put down at all and the work was retyped.
   * Mark as pending sends the same payload with `submit: false`, which `production/plan.js` saves
   * without any completeness check, and the second button is gone once the plan is submitted - a
   * submitted plan is held to being complete whatever saves it.
   */
  const panel = fs.readFileSync(new URL("../src/components/project-management/production/ProductionShootPanel.js", import.meta.url), "utf8");
  assert.match(panel, /async function submit\(event, \{ pending = false \} = \{\}\)/);
  assert.match(panel, /const submitting = !pending && !detail\?\.plan\?\.planSubmittedAt;/);
  assert.match(panel, /bothActions && <Button[\s\S]{0,260}?void submit\(event, \{ pending: true \}\)[\s\S]{0,120}?>Mark as pending<\/Button>/);
  assert.match(panel, /pending \? "Saved\. The plan is still pending\." : "Plan saved\."/);
  // The payload says so plainly: nothing is asked for when the plan is not being submitted.
  assert.equal(productionPlanPayload(productionPlanForm(detail), false).submit, false);
  assert.equal(productionPlanPayload(productionPlanForm(null), false).productionCoordinatorEmployeeId, null);
});

test("a vendor on a service carries how to reach them, so the plan can show it without asking again", () => {
  const options = productionPlanOptions({ vendors: [
    { id: 4, vendorName: "Sathish Audios", contactPerson: "Sathish", mobileNumber: "98400 12345", whatsappNumber: "98400 99999" },
    { id: 5, vendorName: "No Number Lights" },
  ] });
  const [sathish, lights] = ["ven:4", "ven:5"].map((value) => options.people.find((option) => option.value === value));
  assert.equal(sathish.phone, "98400 12345", "the mobile is what somebody rings; WhatsApp's is only the fallback");
  assert.equal(sathish.contactPerson, "Sathish");
  assert.equal(lights.phone, "", "a vendor with no number on their record shows none");

  // Drawn only for a vendor, under the pair, and the number dials.
  const crew = fs.readFileSync(new URL("../src/components/project-management/production/ProductionServiceCrew.js", import.meta.url), "utf8");
  assert.match(crew, /const vendorOn = \(row\) => \(isVendorPerson\(row\?\.person\) \? people\.find\(\(option\) => option\.value === row\.person\) : null\);/);
  assert.match(crew, /if \(!option\?\.phone && !option\?\.contactPerson\) return null;/);
  assert.match(crew, /href=\{`tel:\$\{option\.phone\.replace\([^)]+\)\}`\}/, "the number dials");
  assert.match(crew, /<VendorContact option=\{vendorOn\(row\)\} \/>/);
  // The server has to send it, or the option is a name only.
  const read = fs.readFileSync(new URL("../../backend/src/modules/project-management/production/read.js", import.meta.url), "utf8");
  assert.match(read, /contactPerson: true, mobileNumber: true, whatsappNumber: true \}, orderBy: \{ vendorName: "asc" \}/);
});
