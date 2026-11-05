import test from "node:test";
import assert from "node:assert/strict";

import { crmOptionsFrom, crmNamesFromRows } from "../src/lib/crmOptions.js";

/*
 * Who the CRM offers as a CRM.
 *
 * It used to be three names written into the application. A roster in the code is wrong the day
 * somebody joins or leaves, and wrong silently: leads stay assigned to a name nobody can pick any
 * more, and the person who replaced them cannot be picked at all. It is the Sales department's
 * active employees now, plus whatever names are already on the leads - or filtering for the work of
 * somebody who has left would find nothing.
 */

test("the roster comes from the employees", () => {
  const options = crmOptionsFrom([{ employeeName: "Priya S" }, { employeeName: "Arun K" }], []);
  assert.deepEqual(options, [{ value: "Arun K", label: "Arun K" }, { value: "Priya S", label: "Priya S" }]);
});

test("names already on the leads are offered too", () => {
  // Somebody who has left still has leads against them, and those have to stay findable.
  const options = crmOptionsFrom([{ employeeName: "Arun K" }], ["Thara"]);
  assert.deepEqual(options.map((option) => option.value), ["Arun K", "Thara"]);
});

test("one person is one choice, whatever the spelling on the row", () => {
  // The roster writes "Diya" and a sheet wrote "diya"; two choices would make the filter look broken.
  const options = crmOptionsFrom([{ employeeName: "Diya" }], ["diya", "DIYA"]);
  assert.deepEqual(options, [{ value: "Diya", label: "Diya" }], "and the roster's spelling is the one kept");
});

test("blanks are not people", () => {
  assert.deepEqual(crmOptionsFrom([{ employeeName: "" }, { employeeName: "   " }], ["", null, undefined]), []);
  assert.deepEqual(crmOptionsFrom(), []);
});

test("plain names and rows are both accepted", () => {
  // The endpoint answers with employee rows; a caller holding bare names should not have to wrap them.
  assert.deepEqual(crmOptionsFrom(["Ram"], []), [{ value: "Ram", label: "Ram" }]);
  assert.deepEqual(crmOptionsFrom([{ name: "Ram" }], []), [{ value: "Ram", label: "Ram" }]);
});

test("the names in use are read off the rows", () => {
  const names = crmNamesFromRows([{ crm: "Priya S" }, { crm: "" }, { crm: "Priya S" }, { crm: "Arun K" }, {}]);
  assert.deepEqual(names.sort(), ["Arun K", "Priya S"]);
});
