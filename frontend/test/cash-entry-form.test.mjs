import assert from "node:assert/strict";
import test from "node:test";
import {
  OTHER_HANDLER,
  cashEntryFormSections,
  cashEntryInitialValues,
  cashEntryPayload,
  cashEntryProblems,
  projectAdvanceFormSections,
  projectAdvanceInitialValues,
  validateCashEntry,
} from "../src/constants/accountsConfig.js";

const fieldNames = (sections) => sections.flatMap((section) => section.fields.map((field) => field.name));

/** Money in, filled in as far as the form will let it be saved. */
const received = {
  ...cashEntryInitialValues,
  entryType: "Received",
  projectId: "prj_1",
  category: "Advance",
  amount: "25000",
  entryDate: "2026-09-01",
  paymentMode: "Cash",
  handler: "7",
};

// The bug this exists for: the branch decided whose books an entry landed in, and was asked for as
// a free choice beside the project that already knew the answer — so an entry could be filed
// against a Chennai project and booked to Coimbatore. It is read off the project on the server now,
// and no form may ask for it.
test("no cash entry form asks for a branch", () => {
  assert.equal(fieldNames(cashEntryFormSections).includes("branch"), false);
  assert.equal(fieldNames(projectAdvanceFormSections).includes("branch"), false);
  assert.equal("branch" in cashEntryInitialValues, false);
});

test("the entry sent to the server carries no branch either", () => {
  assert.equal("branch" in cashEntryPayload(received), false);
});

// Which is what makes the link the one answer nothing can stand in for: with no project there is
// no branch to work out.
test("money in must name the project it was received for", () => {
  assert.equal(validateCashEntry({ ...received, projectId: "" }), "Select the project this was received for.");
  assert.equal(validateCashEntry(received), "");
});

test("money out must name the shoot it was spent on", () => {
  const spent = { ...received, entryType: "Spent", projectId: "prj_1", shootId: "", paidTo: "Blue Vans", category: "Travel" };
  assert.equal(validateCashEntry(spent), "Select the shoot this was spent on.");
  assert.equal(validateCashEntry({ ...spent, shootId: "sht_1" }), "");
});

// The advance on Create Project is the exception: the project it belongs to does not exist yet, so
// the link is filled in by the caller once it does rather than asked for.
test("the advance on Create Project is validated without a link", () => {
  const advance = { ...projectAdvanceInitialValues, category: "Advance", amount: "25000", entryDate: "2026-09-01", paymentMode: "Cash", handler: "7" };
  assert.equal(validateCashEntry(advance, { requireLink: false }), "");
  assert.equal(cashEntryPayload(advance, { projectId: "prj_9" }).projectId, "prj_9");
});

test("the advance asks for the cash entry's fields from the category down to the description", () => {
  const names = fieldNames(projectAdvanceFormSections);
  assert.equal(names[0], "category");
  assert.equal(names[names.length - 1], "description");
  // The pickers and the summary between them belong to a form that has to be told which project
  // this is; Create Project already knows.
  ["projectId", "shootId", "linkSummary"].forEach((name) => assert.equal(names.includes(name), false, name));
});

/*
 * The advance is required in full wherever Create Project shows it — it is no longer optional as a
 * whole — so an untouched section is what has to stop the project being created.
 */
test("an untouched advance names every answer it is still waiting for", () => {
  const problems = cashEntryProblems(projectAdvanceInitialValues, { requireLink: false, sections: projectAdvanceFormSections });
  assert.deepEqual(Object.keys(problems).sort(), ["amount", "category", "entryDate", "handler", "paymentMode"]);
  // A receipt is not one of them: plenty of cash changes hands without one.
  assert.equal(problems.paymentProof, undefined);
  // Nor is the project: Create Project supplies it once the project it is creating exists.
  assert.equal(problems.projectId, undefined);
});

test("a fully answered advance has nothing outstanding", () => {
  const advance = { ...projectAdvanceInitialValues, category: "Advance", amount: "25000", entryDate: "2026-09-01", paymentMode: "Cash", handler: "7" };
  assert.deepEqual(cashEntryProblems(advance, { requireLink: false, sections: projectAdvanceFormSections }), {});
});

test("only the fields the answers so far put on screen are required", () => {
  const base = { ...projectAdvanceInitialValues, category: "Advance", amount: "25000", entryDate: "2026-09-01", handler: "7" };
  // Cash asks for neither a reference nor an account, so neither may be demanded.
  const cash = cashEntryProblems({ ...base, paymentMode: "Cash" }, { requireLink: false, sections: projectAdvanceFormSections });
  assert.deepEqual(cash, {});
  // UPI arrives with a reference but does not move money through a studio account.
  const upi = cashEntryProblems({ ...base, paymentMode: "UPI" }, { requireLink: false, sections: projectAdvanceFormSections });
  assert.deepEqual(Object.keys(upi), ["transactionId"]);
  // A bank transfer asks for both: the reference is the proof it went through, and the account is
  // where it landed.
  const transfer = cashEntryProblems({ ...base, paymentMode: "Bank Transfer" }, { requireLink: false, sections: projectAdvanceFormSections });
  assert.deepEqual(Object.keys(transfer).sort(), ["receivedAccount", "transactionId"]);
  // "Other" as the mode asks for neither, the way cash does; what it was goes in the description.
  const otherMode = cashEntryProblems({ ...base, paymentMode: "Other" }, { requireLink: false, sections: projectAdvanceFormSections });
  assert.deepEqual(Object.keys(otherMode), ["paymentModeOther"]);
  // "Other" as the receiver asks who it actually was.
  const other = cashEntryProblems({ ...base, paymentMode: "Cash", handler: OTHER_HANDLER }, { requireLink: false, sections: projectAdvanceFormSections });
  assert.equal(other.handlerOtherName, "Required");
});

test("an amount that is not money is refused, not merely non-blank", () => {
  const base = { ...projectAdvanceInitialValues, category: "Advance", entryDate: "2026-09-01", paymentMode: "Cash", handler: "7" };
  for (const amount of ["0", "-50"]) {
    assert.equal(cashEntryProblems({ ...base, amount }, { requireLink: false, sections: projectAdvanceFormSections }).amount, "Enter an amount greater than zero.");
  }
  assert.equal(cashEntryProblems({ ...base, amount: "" }, { requireLink: false, sections: projectAdvanceFormSections }).amount, "Required");
});

test("the field-keyed rules agree with the sentence-at-a-time ones", () => {
  // `validateCashEntry` is what Accounts' own form says in one line; `cashEntryProblems` is what
  // Create Project marks on the boxes. They must never disagree about whether an entry is savable.
  const complete = { ...cashEntryInitialValues, entryType: "Received", projectId: "prj_1", category: "Advance", amount: "25000", entryDate: "2026-09-01", paymentMode: "Cash", handler: "7" };
  assert.equal(validateCashEntry(complete), "");
  assert.deepEqual(cashEntryProblems(complete), {});
  for (const missing of ["category", "amount", "entryDate", "paymentMode", "handler", "projectId"]) {
    const broken = { ...complete, [missing]: "" };
    assert.notEqual(validateCashEntry(broken), "", missing);
    assert.equal(Object.keys(cashEntryProblems(broken)).includes(missing), true, missing);
  }
});

// A mode that carries neither a reference nor an account must not keep the one a mode chosen a
// moment earlier asked for.
test("the fields the payment mode does not use are sent as null, not left behind", () => {
  const payload = cashEntryPayload({ ...received, transactionId: "UPI-123", receivedAccount: "HDFC Current" });
  assert.equal(payload.transactionId, null);
  assert.equal(payload.receivedAccount, null);
  assert.equal(payload.paidTo, null);
  assert.equal(payload.shootId, null);
});
