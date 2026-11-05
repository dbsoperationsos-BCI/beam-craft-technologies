const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { definitions } = require("../src/modules/hrm/master-data/definitions");
const { countUsage, describeUsage, refusalMessage } = require("../src/modules/hrm/master-data/usage");
const { FIELD_LISTS } = require("../../frontend/src/constants/moduleFieldLists.js");

/*
 * A value on one of the studio's lists cannot be deleted out from under the records using it.
 *
 * Field Settings deletes permanently and checked nothing, so removing "Accounts" from Departments
 * left every employee filed under it naming a department no list offered. Nothing failed and nothing
 * was reported - these lists are held on the employee as plain *text* rather than as a link to the
 * row, which is exactly what made the loss quiet.
 *
 * Renaming was the same fault wearing different clothes: the row changed and the records stayed on
 * the old word. That one is carried through instead of refused, because refusing it would mean a
 * typo in an in-use entry could never be corrected.
 */

test("every list Field Settings offers knows where its values are used", () => {
  /*
   * The guard is only as good as this map. A list that reaches Field Settings without one is
   * deletable exactly as before, and silently - so a new list is caught here rather than by somebody
   * losing a department.
   *
   * Every module's lists, not just HRM's: the same screen deletes them all, so a list added under
   * Quotation or Booking & Converts is as able to be deleted out from under its records.
   *
   * `storedInPayload` is the one way out, and it has to be said out loud. Some values are not held
   * in a column this can count: a payment schedule lives inside the project's own JSON payload and a
   * tier is minted into a WhatsApp group name and kept nowhere afterwards. There is nothing to
   * query, so the check cannot be written - and a list saying so in as many words is a decision on
   * the record rather than a `usedBy` somebody forgot.
   */
  for (const item of FIELD_LISTS) {
    {
      // A list drawn by an editor of its own is not a master-data resource at all - the Quotation
      // shoot types are the brands' own rows, added and removed through the brand's endpoints, and
      // that editor does its own in-use checking.
      if (item.editor) continue;
      const where = item.screens.join(", ");
      const definition = definitions[item.value];
      assert.ok(definition, `${where} → ${item.value} is offered in Field Settings but is not a master-data resource`);
      assert.ok(definition.usedBy?.length || definition.storedInPayload,
        `${where} → ${item.value} can be deleted without checking whether anything uses it`);
      for (const use of definition.usedBy || []) {
        assert.ok(use.model && use.field && use.label, `${item.value} declares a use with no model, field or label`);
        assert.ok(["exact", "csv"].includes(use.match), `${item.value} declares an unknown match kind`);
      }
    }
  }
});

test("a list exempted from the in-use check says why in words", () => {
  /*
   * `storedInPayload` is read out to whoever deletes the value, so it has to read as a place rather
   * than as a flag - "the project's payment schedule", not "true".
   */
  const exempted = Object.entries(definitions).filter(([, definition]) => definition.storedInPayload);
  assert.ok(exempted.length, "nothing is exempted, so this test is no longer checking anything");
  for (const [key, definition] of exempted) {
    assert.equal(typeof definition.storedInPayload, "string", `${key} exempts itself with something other than a reason`);
    assert.ok(definition.storedInPayload.trim().length > 8, `${key} exempts itself without saying where the value is kept`);
    assert.ok(!definition.usedBy, `${key} both declares its uses and exempts itself from the check`);
  }
});

test("both work-location fields are checked, not just one", () => {
  // The one list behind two columns. Checking only where somebody is based would let a location
  // still in use as somebody's *current* place be deleted.
  const fields = definitions["work-locations"].usedBy.map((use) => use.field).sort();
  assert.deepEqual(fields, ["currentWorkLocation", "workBaseLocation"]);
});

test("a designation is used by an invite as well as an employee", () => {
  // An invite carries the designation a candidate is being taken on for, and it is text there too.
  const models = definitions.designations.usedBy.map((use) => use.model).sort();
  assert.deepEqual(models, ["employee", "employeeOnboardingInvite"]);
});

test("a value nothing uses reads as unused", async () => {
  const usage = await countUsage(definitions.departments, "A Department No Studio Has Ever Had");
  assert.equal(usage.total, 0);
  assert.deepEqual(usage.places, []);
});

test("a blank or missing value is never reported as in use", async () => {
  // Employees with no department at all hold "" or null, and a blank must not be read as every one
  // of them using the entry being deleted.
  for (const value of ["", "   ", null, undefined]) {
    assert.equal((await countUsage(definitions.departments, value)).total, 0, `${JSON.stringify(value)} was counted as a use`);
  }
});

test("the refusal names the value, what uses it, and what to do instead", () => {
  const message = refusalMessage(definitions.departments, "Accounts", { total: 4, archived: 1, places: [{ label: "employee", count: 4 }] });
  assert.match(message, /"Accounts"/, "the refusal does not name the value");
  assert.match(message, /4 employees/, "the refusal does not say what is using it");
  assert.match(message, /1 of them archived/, "an archived record is what makes this look like a bug, so it has to be said");
  assert.match(message, /rename/i, "the refusal offers no way forward");
});

test("one use reads as one, not as a plural", () => {
  assert.equal(describeUsage({ places: [{ label: "employee", count: 1 }] }), "1 employee");
  assert.equal(describeUsage({ places: [{ label: "employee", count: 3 }] }), "3 employees");
  assert.equal(
    describeUsage({ places: [{ label: "employee", count: 3 }, { label: "onboarding invite", count: 1 }] }),
    "3 employees and 1 onboarding invite",
  );
});

/* ────────────────────────── the wiring, read off the source ────────────────────────── */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");

test("a permanent delete is refused before the row goes", () => {
  const controller = read("src", "modules", "hrm", "master-data", "controller.js");
  const remove = controller.slice(controller.indexOf("async remove(req, res)"));
  const guard = remove.indexOf("countUsage");
  const destroy = remove.indexOf("repository.delete(");
  assert.ok(guard !== -1, "the delete no longer checks whether anything uses the value");
  assert.ok(guard < destroy, "the row is deleted before anything checks whether it is in use");
});

test("a rename and the records it touches move together", () => {
  const controller = read("src", "modules", "hrm", "master-data", "controller.js");
  assert.match(controller, /\$transaction/, "the rename no longer runs in a transaction");
  assert.match(controller, /renameUsage\(tx,/, "the rename is not carried through to the records using it");
});

test("the editor no longer tells people the records hold an id", () => {
  /*
   * They hold the text. The comment claiming otherwise is why renaming was written as though it
   * looked after itself, and it read as settled fact to anyone who came after.
   */
  const editor = read("..", "frontend", "src", "components", "shared", "HrmOptionListEditor.js");
  assert.ok(!/hold its id, not its text/.test(editor), "the editor still claims the records hold an id");
});
