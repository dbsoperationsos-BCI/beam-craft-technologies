import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { canDuplicateProject, projectToDuplicatePrefill } from "../src/components/sales/projectBooking.js";
import { planFromProject } from "../src/components/sales/quotationProjectPlan.js";

/*
 * Selling the same package to somebody else.
 *
 * Duplicate opens Create Project already filled in: the plan and the money come across, and the two
 * answers naming who it was sold to do not. Three things here are easy to get wrong and invisible
 * when they are - the shoot ids, the group name, and which projects are even offered it - so each
 * has a test of its own rather than being left to the form to reveal.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const TABLE = read("components", "data-table", "ProjectDataTable.js");
const PAGE = read("components", "sales", "SalesManagerPage.js");
const PANEL = read("components", "sales", "CreateProjectFormPanel.js");

function project() {
  return {
    id: "prj-1",
    eventId: "DBS-EID-DD-ERD-000012",
    enquiryId: "ENQ-1",
    quotationId: null,
    clientMainNumber: "+91 9876543210",
    whatsappGroupNameId: "gen-row-7",
    whatsappGroupName: "Sharma Wedding",
    vertical: "WED",
    groupType: "Dum Dum",
    sourceBranch: "Erode TN",
    initialConvertedValue: 250000,
    mainEventDateKnown: true,
    mainEventDate: "2026-11-02",
    salesPreProductionRemarks: "Two cameras",
  };
}

test("only a project that converted at no quotation may be duplicated", () => {
  /*
   * A project sold on a quotation is copied by duplicating that quotation and booking from it, so
   * the copy is priced against a quotation of its own. Copying it here would leave the new project
   * naming a document raised for another client's enquiry - a different name and a different amount
   * on the record than the number beside it points at.
   */
  assert.equal(canDuplicateProject({ quotationId: null }), true);
  assert.equal(canDuplicateProject({}), true);
  assert.equal(canDuplicateProject({ quotationId: "   " }), true, "a blank string is not a quotation");
  assert.equal(canDuplicateProject({ quotationId: "QUT039-02" }), false);
});

test("the copy asks again for who it is being sold to, and for the group name it may not claim", () => {
  const prefill = projectToDuplicatePrefill(project());
  assert.equal(prefill.enquiryId, "", "the duplicate carried the source project's enquiry");
  assert.equal(prefill.clientMainNumber, "", "the duplicate carried the source project's client number");
  /*
   * The group name is the one blanked without being asked for, and it is a refusal rather than a
   * preference: `whatsappGroupNameId` is a generator row the save *claims*, the source project
   * claimed it already, and a create sending it comes back 409 "no longer available". Carrying only
   * the text would be worse - two projects would answer to one WhatsApp group.
   */
  assert.equal(prefill.whatsappGroupNameId, "");
  assert.equal(prefill.whatsappGroupName, "");
});

test("everything that describes the package comes across", () => {
  const prefill = projectToDuplicatePrefill(project());
  assert.equal(prefill.vertical, "WED");
  assert.equal(prefill.groupType, "Dum Dum");
  assert.equal(prefill.sourceBranch, "Erode TN");
  // Held as the string the form's number box edits, not as the number the record stores.
  assert.equal(prefill.initialConvertedValue, "250000");
  assert.equal(prefill.mainEventDate, "2026-11-02");
  assert.equal(prefill.mainEventDateKnown, true);
  assert.equal(prefill.salesPreProductionRemarks, "Two cameras");
  // Zero is an amount, not an absence: `|| ""` here would blank a project booked at nothing.
  assert.equal(projectToDuplicatePrefill({ initialConvertedValue: 0 }).initialConvertedValue, "0");
});

test("the money already taken is never part of the copy", () => {
  /*
   * Payment Received records a cash entry against the project being created. A duplicate repeating
   * it would credit the studio twice for one payment, so the section is not something this shape can
   * carry at all - the panel holds the advance in its own state and opens it empty.
   */
  const prefill = projectToDuplicatePrefill({ ...project(), advance: { amount: 50000 } });
  for (const field of Object.keys(prefill)) {
    assert.doesNotMatch(field, /advance|payment|receiv/i, `${field} carries money into a duplicate`);
  }
});

let counter = 0;
const keys = () => `key-${++counter}`;

function plan() {
  counter = 0;
  return {
    shoots: [
      { id: "shoot-a", shootId: "SID-0001", projectId: "prj-1", createdAt: "2026-01-01", updatedAt: "2026-01-02", deletedAt: null, shoot: "Muhurtham", dateCreated: "2026-11-02T00:00:00.000Z", shootPlace: "Grand Hall", district: "Erode", state: "Tamil Nadu", preference: "Both", isMainEvent: true },
      { id: "shoot-b", shootId: "SID-0002", projectId: "prj-1", shoot: "Reception", dateCreated: "2026-11-03T00:00:00.000Z", shootPlace: "Grand Hall", district: "Erode", state: "Tamil Nadu", preference: "Both", isMainEvent: false },
    ],
    services: [
      { id: "alloc-1", shootId: "shoot-a", serviceDefinitionId: "svc-photo", serviceName: "Photography", quantity: 2 },
      { id: "alloc-2", shootId: "shoot-b", serviceDefinitionId: "svc-video", serviceName: "Videography", quantity: 1 },
    ],
    deliverables: [
      { id: "del-1", shootId: "shoot-a", deliverableDefinitionId: "del-album", deliverableName: "Album", quantity: 1, numberOfPhotos: 200 },
    ],
  };
}

test("every shoot comes across on a key of its own, carrying none of the server's ids", () => {
  const copied = planFromProject(plan(), keys);
  assert.deepEqual(copied.shoots.map((shoot) => shoot.shoot), ["Muhurtham", "Reception"]);
  for (const shoot of copied.shoots) {
    assert.ok(shoot.id.startsWith("key-"), "the source project's shoot id survived the copy");
    assert.equal(shoot.clientKey, shoot.id);
    // "SID-0001" is the source project's own display id, and the new project's are issued by the
    // server when it is saved.
    assert.equal(shoot.shootId, undefined);
    // A database row's stamps describe the row, not the shoot being planned.
    for (const field of ["projectId", "createdAt", "updatedAt", "deletedAt"]) {
      assert.equal(shoot[field], undefined, `${field} was copied onto a shoot being planned`);
    }
  }
  // What the shoot actually is does come across.
  assert.equal(copied.shoots[0].shootPlace, "Grand Hall");
  assert.equal(copied.shoots[0].preference, "Both");
  assert.equal(copied.shoots[0].isMainEvent, true);
});

test("services and deliverables are re-pointed at the shoot they were copied with", () => {
  /*
   * The failure this guards is silent. An allocation points at its shoot by the *old* project's id;
   * copied unchanged, every shoot arrives empty - which reads as a project that was sold with no
   * services rather than as a copy that lost them on the way in.
   */
  const copied = planFromProject(plan(), keys);
  const [first, second] = copied.shoots;
  assert.deepEqual(copied.services.map((row) => row.shootId), [first.id, second.id]);
  assert.deepEqual(copied.deliverables.map((row) => row.shootId), [first.id]);
  assert.equal(copied.services[0].serviceDefinitionId, "svc-photo");
  assert.equal(copied.services[0].quantity, 2);
  assert.equal(copied.deliverables[0].numberOfPhotos, 200);
  // Every row needs a key of its own for the section to render and edit it one at a time.
  const ids = copied.services.concat(copied.deliverables).map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "two copied rows share one key");
});

test("a plan with nothing in it copies to nothing rather than throwing", () => {
  assert.deepEqual(planFromProject(null, keys), { shoots: [], services: [], deliverables: [] });
  assert.deepEqual(planFromProject({ shoots: [] }, keys), { shoots: [], services: [], deliverables: [] });
});

test("Duplicate is on the menu only where the screen offers it, and only for a copyable project", () => {
  // Asked as one rule, so the menu entry and the reason it is there cannot drift apart.
  assert.match(TABLE, /const mayDuplicate = mayEditSale && Boolean\(onDuplicate\) && canDuplicateProject\(project\)/);
  assert.match(TABLE, /mayDuplicate \? \[\{ label: "Duplicate"/, "the entry does not stand on its own rule");
  /*
   * Bookings & Converted passes the handler; Project Management's Projects does not, and so has no
   * Duplicate - it lists the same records to plan them, not to sell a second one. Absent rather than
   * refused, the way every other entry on this menu is.
   */
  assert.match(PAGE, /onDuplicate=\{canWrite \? \(project\) => void openDuplicate\(project\) : undefined\}/);
});

test("a duplicated plan stays editable, unlike a quoted one", () => {
  /*
   * `fromQuotation` closes every control in Service Creation, which is right for a plan the client
   * has agreed to pay for and wrong for this one: a duplicate is the same package sold to somebody
   * else, and the dates, the venue and the quantities are what the person is there to change.
   */
  const seeding = PANEL.slice(PANEL.indexOf("seededDuplicateRef.current = true"), PANEL.indexOf("}, [mode, prefillPlan, isLoadingMasterData]);"));
  assert.ok(seeding, "the duplicate is not seeded from its own effect any more");
  assert.doesNotMatch(seeding, /fromQuotation/, "a copied shoot is marked as quoted and so cannot be edited");
  // Retired definitions are dropped rather than carried: the create endpoint refuses the whole
  // project over one, so a copy holding it could not be saved and would not say why.
  assert.match(seeding, /serviceIds\.has\(row\.serviceDefinitionId\)/);
  assert.match(seeding, /deliverableIds\.has\(row\.deliverableDefinitionId\)/);
  // And what was dropped is said, above the shoots it was dropped from.
  assert.match(PANEL, /could not be copied because the service or deliverable is no longer active/);
});

test("the enquiry a duplicate is booked against is asked for, not locked", () => {
  /*
   * The two halves of one answer, tested together because each is harmless alone and the pair is
   * what broke: the prefill blanks the enquiry, and the panel locks the picker when there *is* one.
   *
   * `enquiryLocked` draws the picker as a settled value rather than a search box. Asked as
   * `Boolean(project)` it fired on any prefill at all - so a duplicate, whose enquiry is blank
   * precisely because the package is being sold to somebody else, opened with a locked and empty
   * Enquiry ID: the one field the person was there to answer was the one they could not reach.
   */
  assert.equal(projectToDuplicatePrefill(project()).enquiryId, "");
  const PANEL_SOURCE = read("components", "sales", "CreateProjectFormPanel.js");
  assert.match(PANEL_SOURCE, /const enquiryLocked = Boolean\(project\?\.enquiryId \|\| draft\?\.enquiryLocked\)/);
  // Which, on a prefill whose enquiry is "" (and no draft), is false - so the picker is a search box.
  assert.equal(Boolean(projectToDuplicatePrefill(project()).enquiryId), false);
});
