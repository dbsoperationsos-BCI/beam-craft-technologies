import test from "node:test";
import assert from "node:assert/strict";

import { identificationFromLead } from "../src/components/sales/quotationEnquiryPrefill.js";
import { toStoredPhoneNumber } from "../src/lib/phoneNumber.js";
import { verticalFieldRows } from "../src/components/sales/quotationVerticalConfig.js";

/*
 * Filling a quotation's Client Details from the enquiry it is raised against.
 *
 * The Quotation Generator asks the same questions Add Lead does, so a lead already holds the
 * answers. What is worth checking is the joins where the two are *not* the same word - the two
 * renamed keys - and the three rules that decide what may be written: only the chosen vertical's
 * fields, only answers the lead actually has, and numbers in the shape the field saves.
 */

const dumDumLead = {
  name: "Priya Raghavan",
  phone: "9876543210",
  whatsappNumber: "9000000000",
  assignedBranch: "Erode",
  vertical: "Dum Dum",
  relationship: "Bride",
  referredFrom: "Instagram",
  groomName: "Arun",
  groomContact: "+91 98765 43211",
  brideName: "Priya",
  companyName: "Should not be read onto a wedding",
};

test("a lead's answers land on the quotation's own field keys", () => {
  const applied = identificationFromLead(dumDumLead, "Dum Dum");
  assert.equal(applied.name, "Priya Raghavan");
  assert.equal(applied.assignedBranch, "Erode");
  assert.equal(applied.relationship, "Bride");
  assert.equal(applied.groomName, "Arun");
});

test("the client's main number comes from the CRM's `phone`, not its WhatsApp number", () => {
  // The quotation states the number the client enquired on. Reading `whatsappNumber` here would
  // quote a number the client never gave, on the record the studio bills against.
  const applied = identificationFromLead(dumDumLead, "Dum Dum");
  assert.equal(applied.contactNumber, "+91 9876543210");
  assert.notEqual(applied.contactNumber, toStoredPhoneNumber(dumDumLead.whatsappNumber));
});

test("a Qua Qua lead's own `contactNumber` fills the renamed baby contact, not the main one", () => {
  /*
   * The rename this whole map exists for. The CRM calls the baby's second number `contactNumber`,
   * which is the key the quotation spends on the client's main number - read straight across, a
   * Qua Qua quotation would be reachable on the wrong number of the two.
   */
  const applied = identificationFromLead({
    name: "Meera",
    phone: "9876543210",
    contactNumber: "9123456780",
    babyOrMotherName: "Meera",
    dateOfBirthOrEdod: "2026-04-12",
  }, "Qua Qua");
  assert.equal(applied.contactNumber, "+91 9876543210");
  assert.equal(applied.babyContactNumber, "+91 9123456780");
});

test("numbers are stored in the shape the phone field saves, whatever the CRM wrote", () => {
  // Four producers write these columns as free text, so the same number arrives four ways.
  for (const written of ["9876543210", "+91 98765 43210", "919876543210", "98765-43210"]) {
    const applied = identificationFromLead({ phone: written }, "Dum Dum");
    assert.equal(applied.contactNumber, "+91 9876543210", `read "${written}" back wrongly`);
  }
});

test("only the chosen vertical's fields are written", () => {
  const applied = identificationFromLead(dumDumLead, "Dum Dum");
  // `companyName` is a Corp field. A wedding quotation has nowhere to show it, and a filled key
  // counts as an answer the "switch vertical?" warning offers to throw away.
  assert.equal(applied.companyName, undefined);
  const corpKeys = new Set(verticalFieldRows.Corp.flat().map((field) => field.key));
  const dumDumKeys = new Set(verticalFieldRows["Dum Dum"].flat().map((field) => field.key));
  for (const key of Object.keys(applied)) {
    assert.ok(dumDumKeys.has(key), `${key} is not a Dum Dum field`);
    if (!dumDumKeys.has(key)) assert.ok(!corpKeys.has(key));
  }
});

test("a blank column is left out rather than clearing what somebody typed", () => {
  const applied = identificationFromLead({ name: "Priya", groomName: "", brideName: "   " }, "Dum Dum");
  assert.deepEqual(Object.keys(applied), ["name"]);
  assert.ok(!("groomName" in applied));
  assert.ok(!("brideName" in applied));
});

test("a missing lead or an unknown vertical applies nothing at all", () => {
  assert.deepEqual(identificationFromLead(null, "Dum Dum"), {});
  assert.deepEqual(identificationFromLead(undefined, "Dum Dum"), {});
  assert.deepEqual(identificationFromLead(dumDumLead, "Nonexistent Vertical"), {});
});

test("a lead with no number leaves the phone field blank rather than a bare country code", () => {
  const applied = identificationFromLead({ name: "Priya", phone: "" }, "Dum Dum");
  assert.ok(!("contactNumber" in applied));
});
