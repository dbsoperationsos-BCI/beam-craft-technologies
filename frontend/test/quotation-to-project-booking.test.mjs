import test from "node:test";
import assert from "node:assert/strict";

import { createProjectPayload, quotationToProjectPrefill, sourceBranchForCrmBranch } from "../src/components/sales/projectBooking.js";

/*
 * Booking a project from the quotation the client agreed to.
 *
 * Two things here are worth a test and the rest is copying. The first is `quotationRowId`: it is
 * what tells the panel to go and read that version and bring its shoots across, and a prefill that
 * loses it opens a form naming a quotation and showing none of its plan - which reads as a
 * quotation with no shoots rather than as a bug. The second is the branch, because the two records
 * spell it differently and the server refuses the quotation's spelling.
 */

function quotation(overrides = {}) {
  return {
    id: "row-1",
    quotationId: "DBS-QO-DD-ERD-000005-01",
    enquiryId: "DBS-EID-DD-ERD-000001",
    clientMainNumber: "98875-37458",
    sourceBranch: "Erode",
    followedBy: "Harish",
    amount: 125000,
    payload: { vertical: "Dum Dum" },
    ...overrides,
  };
}

test("the quotation's own row travels, which is what brings its shoots with it", () => {
  const prefill = quotationToProjectPrefill(quotation());
  assert.equal(prefill.quotationRowId, "row-1");
  assert.equal(prefill.quotationId, "DBS-QO-DD-ERD-000005-01");
  assert.equal(prefill.enquiryId, "DBS-EID-DD-ERD-000001");
});

test("the branch is spelled the way a project spells it, not the way a quotation does", () => {
  assert.equal(quotationToProjectPrefill(quotation()).sourceBranch, "Erode TN");
  // The studio's own short forms, which older records still hold.
  assert.equal(sourceBranchForCrmBranch("cbe"), "Coimbatore TN");
  /*
   * And the register's own name, handed back as it came.
   *
   * This is the case that was broken. Repairing the branch text made every properly filed record
   * store the register's spelling, so a conversion arrived here already reading "Erode TN" - which
   * a list of *cities* does not contain, so it answered "" and Create Project opened with Source
   * Branch blank on a required field.
   */
  for (const name of ["Erode TN", "Visakhapatnam AP", "Coimbatore TN"]) {
    assert.equal(sourceBranchForCrmBranch(name), name);
  }
  // Nothing at all is still nothing - there is no branch to guess at.
  assert.equal(sourceBranchForCrmBranch(""), "");
  assert.equal(sourceBranchForCrmBranch(null), "");
  /*
   * Text that names no branch is passed on rather than blanked, and **the register is what judges
   * it**: Create Project loads the branches and clears anything not among them, so this cannot
   * invent a branch - it only stops mistranslating the ones it is handed. Holding a list of real
   * branch names here instead would be the same fault the backend matcher was rewritten to remove:
   * a new branch would work everywhere except this one function.
   */
  assert.equal(sourceBranchForCrmBranch("Nowhere"), "Nowhere");
});

test("the vertical fills both fields a project stores it in", () => {
  const prefill = quotationToProjectPrefill(quotation());
  assert.equal(prefill.groupType, "Dum Dum");
  assert.equal(prefill.vertical, "WED");
});

test("a vertical the CRM does not have leaves both empty rather than half-filled", () => {
  const prefill = quotationToProjectPrefill(quotation({ payload: { vertical: "Something Else" } }));
  assert.equal(prefill.groupType, "");
  assert.equal(prefill.vertical, "");
});

test("the quoted amount arrives as the signed value, and zero is an amount", () => {
  assert.equal(quotationToProjectPrefill(quotation()).initialConvertedValue, "125000");
  assert.equal(quotationToProjectPrefill(quotation({ amount: 0 })).initialConvertedValue, "0");
  // Nothing quoted is not "0" - the form asks rather than booking a project sold at nothing.
  assert.equal(quotationToProjectPrefill(quotation({ amount: null })).initialConvertedValue, "");
});

test("the payload carries the quotation, and the browser never claims the CRM", () => {
  const payload = createProjectPayload({
    ...quotationToProjectPrefill(quotation()),
    countryCode: "+91",
    whatsappGroupName: " WED 2t2 Erode TN ",
    shoots: [{ id: "local-1", clientKey: "k1", shootId: null, shootType: "Rituals" }],
  });
  assert.equal(payload.quotationId, "DBS-QO-DD-ERD-000005-01");
  assert.equal(payload.clientMainNumber, "+91 98875-37458");
  assert.equal(payload.whatsappGroupName, "WED 2t2 Erode TN");
  assert.equal(payload.initialConvertedValue, 125000);
  // The server sets the CRM from the signed-in account, so it is not sent from here.
  assert.equal("crmName" in payload, false);
  // The keys a shoot only has while it is on the form do not reach the server.
  assert.deepEqual(payload.shoots, [{ shootType: "Rituals" }]);
});
