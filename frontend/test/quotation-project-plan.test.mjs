import test from "node:test";
import assert from "node:assert/strict";

import { planFromQuotation, readyToBringPlan, shootSignature, unplannedPart } from "../src/components/sales/quotationProjectPlan.js";

/*
 * Carrying what was quoted into the project that sells it.
 *
 * The risk is not copying the rows; it is the ids. A quoted service points at its shoot by the
 * generator's own key, and a project shoot never has that key - so a copy that forgets to
 * re-point the rows produces the right shoots with nothing underneath them, which looks like the
 * quotation had no services rather than like a bug.
 */

let counter = 0;
const keys = () => `key-${++counter}`;

function quotation() {
  counter = 0;
  return {
    shoots: [
      { id: "quote-shoot-1", shootId: "Q-SID-0001", shoot: "Wedding", dateCreated: "2026-11-02", shootPlace: "Grand Hall", district: "Erode", state: "Tamil Nadu", isMainEvent: true },
      { id: "quote-shoot-2", shootId: "Q-SID-0002", shoot: "Reception", dateCreated: "2026-11-03", shootPlace: "Grand Hall", district: "Erode", state: "Tamil Nadu", isMainEvent: false },
    ],
    services: [
      { id: "s1", shootId: "quote-shoot-1", serviceDefinitionId: "svc-photo", serviceName: "Photography", quantity: 2 },
      { id: "s2", shootId: "quote-shoot-2", serviceDefinitionId: "svc-video", serviceName: "Videography", quantity: 1 },
    ],
    deliverables: [
      { id: "d1", shootId: "quote-shoot-1", deliverableDefinitionId: "del-album", deliverableName: "Album", quantity: 1, numberOfPhotos: 200 },
    ],
  };
}

test("every quoted shoot comes across, with a fresh key and none of the generator's ids", () => {
  const plan = planFromQuotation(quotation(), keys);
  assert.equal(plan.shoots.length, 2);
  assert.deepEqual(plan.shoots.map((shoot) => shoot.shoot), ["Wedding", "Reception"]);
  for (const shoot of plan.shoots) {
    assert.ok(shoot.id.startsWith("key-"), "the generator's shoot id must not survive");
    assert.equal(shoot.clientKey, shoot.id);
    // "Q-SID-0004" is the quotation's own display id and means nothing on a project, whose shoot
    // ids are issued by the server.
    assert.equal(shoot.shootId, undefined);
  }
});

test("services and deliverables are re-pointed at the shoot they belong to", () => {
  const plan = planFromQuotation(quotation(), keys);
  const [wedding, reception] = plan.shoots;
  const forWedding = plan.services.filter((row) => row.shootId === wedding.id);
  const forReception = plan.services.filter((row) => row.shootId === reception.id);
  assert.deepEqual(forWedding.map((row) => row.serviceName), ["Photography"]);
  assert.deepEqual(forReception.map((row) => row.serviceName), ["Videography"]);
  assert.equal(forWedding[0].quantity, 2);
  assert.deepEqual(plan.deliverables.map((row) => row.shootId), [wedding.id]);
  assert.equal(plan.deliverables[0].numberOfPhotos, 200);
  // Nothing may still be pointing at a generator key.
  for (const row of [...plan.services, ...plan.deliverables]) {
    assert.ok(!String(row.shootId).startsWith("quote-shoot-"), `${row.id} still points at the quotation`);
  }
});

test("a quotation with no shoots, or none at all, plans nothing rather than throwing", () => {
  for (const payload of [null, undefined, {}, { shoots: [] }, { shoots: null }]) {
    assert.deepEqual(planFromQuotation(payload, keys), { shoots: [], services: [], deliverables: [] });
  }
});

test("a service pointing at a shoot the quotation does not have is dropped, not orphaned", () => {
  const payload = quotation();
  payload.services.push({ id: "s3", shootId: "quote-shoot-missing", serviceDefinitionId: "svc-x", serviceName: "Ghost" });
  const plan = planFromQuotation(payload, keys);
  assert.equal(plan.services.length, 2);
  assert.ok(!plan.services.some((row) => row.serviceName === "Ghost"));
});

test("a shoot the project already has is not added a second time", () => {
  const plan = planFromQuotation(quotation(), keys);
  // The same wedding, already planned - its timing adjusted since the quotation, which does not
  // make it a different shoot.
  const existing = [{ shoot: "Wedding", dateCreated: "2026-11-02T00:00:00.000Z", shootPlace: "Grand Hall", sessionTimings: ["Full Session"] }];
  const missing = unplannedPart(plan, existing);
  assert.deepEqual(missing.shoots.map((shoot) => shoot.shoot), ["Reception"]);
  // and its services come with it, while the wedding's stay behind with the shoot already there
  assert.deepEqual(missing.services.map((row) => row.serviceName), ["Videography"]);
  assert.equal(missing.deliverables.length, 0);
});

test("with no existing shoots the whole quoted plan is new", () => {
  const plan = planFromQuotation(quotation(), keys);
  const missing = unplannedPart(plan, []);
  assert.equal(missing.shoots.length, 2);
  assert.equal(missing.services.length, 2);
  assert.equal(missing.deliverables.length, 1);
});

test("the same shoot is recognised through spacing, case and a timestamped date", () => {
  assert.equal(
    shootSignature({ shoot: "Wedding", dateCreated: "2026-11-02", shootPlace: "Grand Hall" }),
    shootSignature({ shoot: "  wedding ", dateCreated: "2026-11-02T18:30:00.000Z", shootPlace: "grand  hall" }),
  );
  // A different day is a different shoot, however alike the rest of it reads.
  assert.notEqual(
    shootSignature({ shoot: "Wedding", dateCreated: "2026-11-02", shootPlace: "Grand Hall" }),
    shootSignature({ shoot: "Wedding", dateCreated: "2026-11-03", shootPlace: "Grand Hall" }),
  );
});

/*
 * When the quoted plan is fetched at all.
 *
 * This guard shipped wrong once and nothing said so: it consulted the loading flag of a hook that
 * never loads on Create Project, so the flag stayed true for ever and no quotation reached a new
 * project. There was no error to see - the feature simply looked unbuilt. Hence its own tests.
 */

const ready = { quotationId: "QUT039-02", quotationRowId: "cuid-1", appliedQuotationId: "", masterDataLoading: false };

test("a freshly picked quotation is brought in once the form's master data is ready", () => {
  assert.equal(readyToBringPlan(ready), true);
});

test("nothing is fetched while the master data is still loading", () => {
  assert.equal(readyToBringPlan({ ...ready, masterDataLoading: true }), false);
});

test("the same quotation is never brought in twice", () => {
  assert.equal(readyToBringPlan({ ...ready, appliedQuotationId: "QUT039-02" }), false);
  // A different version of the same chain is a different quotation and does apply.
  assert.equal(readyToBringPlan({ ...ready, appliedQuotationId: "QUT039-01" }), true);
});

test("a reopened project, which states its quotation but carries no row id, fetches nothing", () => {
  assert.equal(readyToBringPlan({ ...ready, quotationRowId: "" }), false);
  assert.equal(readyToBringPlan({ ...ready, quotationRowId: "   " }), false);
});

test("no quotation chosen means nothing to bring in", () => {
  assert.equal(readyToBringPlan({ ...ready, quotationId: "" }), false);
  assert.equal(readyToBringPlan({ ...ready, quotationId: "  " }), false);
});
