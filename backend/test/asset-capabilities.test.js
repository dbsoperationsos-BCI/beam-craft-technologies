const test = require("node:test");
const assert = require("node:assert/strict");

const { capabilitiesOf, ALLOWED_STATUS_TRANSITIONS, FLAG_FAULTY } = require("../src/modules/assets/assets.read.service");

/**
 * Asset Management — what a person may do to one asset.
 *
 * Whether somebody sees a row at all is `dataScope`'s question and is tested with the resolver.
 * This is the second question, and the one the screen draws its ⋮ menu from: an asset is yours to
 * manage if you are the employee named as its manager, or the login that added it. Anything else
 * you can see, you may look at and report faulty.
 *
 * `capabilitiesOf` is deliberately pure — the caller is resolved once per request elsewhere — so
 * every rule below is exercised without a database.
 */

// Two numbers for one person, which is the whole point: a login is `User.id` and an employee is
// `Employee.id`, two tables with two sequences. Picked to overlap on purpose, so a test would fail
// if the code ever compared an employee id against `createdBy` or a user id against `managerId`.
const RASHMI = { userId: 7, employeeId: 41, isSuperAdmin: false, canWrite: true };
const DEVA = { userId: 41, employeeId: 7, isSuperAdmin: false, canWrite: true };
const SUPER_ADMIN = { userId: 1, employeeId: null, isSuperAdmin: true, canWrite: true };
// A login with no employee behind it, which `User.linkedEmployeeId` being nullable allows.
const UNLINKED = { userId: 9, employeeId: null, isSuperAdmin: false, canWrite: true };

const asset = (overrides = {}) => ({ id: 100, status: "ACTIVE", managerId: null, assignedPersonId: null, createdBy: null, ...overrides });

test("the asset's manager may manage it, but never delete it", () => {
  const can = capabilitiesOf(asset({ managerId: RASHMI.employeeId }), RASHMI);
  assert.equal(can.canManage, true);
  assert.equal(can.canEdit, true);
  assert.equal(can.canInspect, true);
  assert.equal(can.canDelete, false);
  assert.deepEqual(can.allowedTransitions, ALLOWED_STATUS_TRANSITIONS.ACTIVE);
});

test("whoever added the asset may manage it, so a record can be finished later", () => {
  // This is the approver's case: approving a request creates the asset and records the approver as
  // its `createdBy`, so somebody who approved one and forgot to name a manager can go back and set
  // one rather than needing a Super Admin.
  const can = capabilitiesOf(asset({ createdBy: RASHMI.userId }), RASHMI);
  assert.equal(can.canEdit, true);
  assert.equal(can.canInspect, true);
  assert.equal(can.canDelete, false);
});

test("an employee id is never matched against createdBy, nor a user id against managerId", () => {
  // Deva is employee 7 and login 41; the asset is managed by employee 41 and was added by login 7.
  // Every number on the asset is a number Deva carries — on the wrong side. Compare them the wrong
  // way round and he gets the run of an asset that is nothing to do with him.
  const somebodyElses = asset({ managerId: 41, createdBy: 7 });
  const can = capabilitiesOf(somebodyElses, DEVA);
  assert.equal(can.canManage, false);
  assert.equal(can.canEdit, false);
});

test("an asset you neither manage nor added: look at it, and report it faulty", () => {
  const can = capabilitiesOf(asset({ managerId: 999, createdBy: 998 }), RASHMI);
  assert.equal(can.canEdit, false);
  assert.equal(can.canInspect, false);
  assert.equal(can.canDelete, false);
  assert.deepEqual(can.allowedTransitions, [FLAG_FAULTY]);
});

test("reporting a fault is still only offered where the status machine allows it", () => {
  // An asset already away at a service centre cannot be marked under repair by anybody, so the
  // holder's one action is absent rather than offered and then refused.
  assert.equal(ALLOWED_STATUS_TRANSITIONS.IN_SERVICE.includes(FLAG_FAULTY), false);
  const can = capabilitiesOf(asset({ status: "IN_SERVICE", managerId: 999 }), RASHMI);
  assert.deepEqual(can.allowedTransitions, []);
});

test("clearing a fault is the manager's, not the holder's", () => {
  const underRepair = asset({ status: "UNDER_REPAIR", managerId: 999 });
  assert.deepEqual(capabilitiesOf(underRepair, RASHMI).allowedTransitions, []);
  assert.deepEqual(
    capabilitiesOf(asset({ status: "UNDER_REPAIR", managerId: RASHMI.employeeId }), RASHMI).allowedTransitions,
    ALLOWED_STATUS_TRANSITIONS.UNDER_REPAIR,
  );
});

test("a login with no employee does not become manager of every unmanaged asset", () => {
  // `null === null` is true, and an unmanaged asset carries a null manager. Without the guard, the
  // Super Admin's own login — the account that has no employee — would match every one of them,
  // and so would any other unlinked login.
  const can = capabilitiesOf(asset({ managerId: null, createdBy: null }), UNLINKED);
  assert.equal(can.canManage, false);
  assert.deepEqual(can.allowedTransitions, [FLAG_FAULTY]);
});

test("a Super Admin manages every asset and is the only one who deletes", () => {
  const can = capabilitiesOf(asset({ managerId: 999, createdBy: 998 }), SUPER_ADMIN);
  assert.equal(can.canManage, true);
  assert.equal(can.canDelete, true);
  assert.deepEqual(can.allowedTransitions, ALLOWED_STATUS_TRANSITIONS.ACTIVE);
});

test("READ alone offers nothing, even on an asset you manage", () => {
  // Otherwise the list hands a viewer an action the PATCH behind it refuses — a control that is
  // present and then says no, which is what Rule 4 calls an unfinished change.
  const reader = { ...RASHMI, canWrite: false };
  const can = capabilitiesOf(asset({ managerId: reader.employeeId }), reader);
  assert.deepEqual(can, { canManage: false, canEdit: false, canInspect: false, canDelete: false, allowedTransitions: [] });
});

test("a status the machine has no exit from offers nothing to anybody", () => {
  for (const status of ["LOST", "SOLD", "DISPOSED"]) {
    assert.equal(ALLOWED_STATUS_TRANSITIONS[status], undefined);
    assert.deepEqual(capabilitiesOf(asset({ status, managerId: RASHMI.employeeId }), RASHMI).allowedTransitions, []);
  }
});
