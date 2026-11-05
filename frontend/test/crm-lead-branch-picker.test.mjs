import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * What Assigned Branch shows on a lead whose branch text is not the register's own spelling.
 *
 * A branch is written into a lead by whatever wrote the lead: an import says what the file said,
 * and files say `Erode` where the register says `Erode TN`. The picker is built from the register
 * and `Dropdown` shows its placeholder for a value it cannot find among its options, so a lead filed
 * perfectly well under `branch_id` 1 read as a lead with no branch at all.
 *
 * The reference decides what is shown now, not the text — which is why the board's rows carry
 * `branchId` and the branches endpoint carries each option's `id`. This exercises that rule: the
 * function is lifted out of `CRMPage.js` and given a branch list, because the suite has no renderer
 * and the rule is worth testing rather than the markup around it.
 */

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");

function branchPicker(options) {
  const start = PAGE.indexOf("const branchOptionFor = useCallback(");
  assert.notEqual(start, -1, "branchOptionFor was not found in CRMPage.js");
  const end = PAGE.indexOf("}, [branchOptions]);", start);
  assert.notEqual(end, -1, "the end of branchOptionFor was not found");
  const source = PAGE.slice(start, end + "}, [branchOptions]);".length);
  // `useCallback` is React's and does nothing here but hand the function back; the list it closes
  // over is supplied by the caller, exactly as the hook supplies it in the popup.
  return new Function("branchOptions", "useCallback", `${source}\nreturn branchOptionFor;`)(options, (fn) => fn);
}

const REGISTER = [
  { value: "Bangalore KA", label: "Bangalore KA", id: 4 },
  { value: "Coimbatore TN", label: "Coimbatore TN", id: 3 },
  { value: "Erode TN", label: "Erode TN", id: 1 },
  { value: "Visakhapatnam AP", label: "Visakhapatnam AP", id: 6 },
];

const shown = branchPicker(REGISTER);

test("a lead filed under a branch shows that branch, however its text is spelled", () => {
  // The case the whole change is about: an imported lead saying `Erode`, filed under `Erode TN`.
  assert.equal(shown({ assignedBranch: "Erode", branchId: 1 }), "Erode TN");
  assert.equal(shown({ assignedBranch: "Visakhapatnam", branchId: 6 }), "Visakhapatnam AP");
  // And one whose text is already the register's own name, which never had a problem.
  assert.equal(shown({ assignedBranch: "Erode TN", branchId: 1 }), "Erode TN");
  assert.equal(shown({ assignedBranch: " erode tn ", branchId: 1 }), "Erode TN");
});

test("a lead filed under no branch shows nothing at all", () => {
  /*
   * Short spellings the branch rule refuses - `viza`, `erd` - and text that is not a branch in the
   * first place. The placeholder reads as the question it is: this lead is filed under no branch,
   * choose one. Showing the stored text instead would present it as though it were a branch.
   */
  for (const text of ["viza", "erd", "Tel", "Out of Branch Location", "Chennai", ""]) {
    assert.equal(shown({ assignedBranch: text, branchId: null }), "", JSON.stringify(text));
  }
  assert.equal(shown({}), "");
  assert.equal(shown(null), "");
});

test("a branch just chosen wins over the reference the lead arrived with", () => {
  /*
   * The server resolves `branch_id` when the lead is saved, so between the press and the save the
   * two disagree: the text is the new branch and the reference is still the old one. The choice has
   * to win, or the field would snap back under the hands of whoever made it.
   */
  assert.equal(shown({ assignedBranch: "Coimbatore TN", branchId: 1 }), "Coimbatore TN");
  // Including on a lead that had no branch at all before.
  assert.equal(shown({ assignedBranch: "Bangalore KA", branchId: null }), "Bangalore KA");
});

test("a reference pointing at a branch this reader cannot reach shows nothing", () => {
  /*
   * The options are already narrowed to the branches the signed-in person's roles reach. A lead
   * filed under one outside that list has no option to sit on, and inventing one would put a branch
   * on screen that the same person is not allowed to choose.
   */
  assert.equal(shown({ assignedBranch: "Hyderabad", branchId: 5 }), "");
});

test("the fallback list, which has no ids, matches on the name alone", () => {
  // `FALLBACK_BRANCH_OPTIONS` stands in while the first request is in flight or if it fails. Its
  // rows carry no id, because they stand for a database with no branches: an id would point at a
  // row that does not exist. Text that is exactly one of them still matches.
  const fallback = branchPicker([{ value: "Erode TN", label: "Erode TN" }]);
  assert.equal(fallback({ assignedBranch: "Erode TN", branchId: 1 }), "Erode TN");
  assert.equal(fallback({ assignedBranch: "Erode", branchId: 1 }), "");
});

test("the board and the picker both carry what this needs", () => {
  // The rule is only as good as the two payloads feeding it: the lead's own reference, and an id on
  // each option to match it against.
  const board = fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "sales", "crm-leads", "leadQueryService.js"),
    "utf8",
  );
  assert.match(board, /\["enquiryId", \.\.\.CRM_LEAD_SQL_COLUMNS, "createdAt", "branchId"\]/,
    "the board's rows must carry branchId, or every lead reads as having no branch");
  const controller = fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "sales", "crm-leads", "controller.js"),
    "utf8",
  );
  assert.match(controller, /rows\.map\(\(row\) => \(\{ value: row\.name, label: row\.name, id: row\.id \}\)\)/,
    "the branches endpoint must send each option's id");
});
