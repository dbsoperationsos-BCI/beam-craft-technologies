import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Add Shoot's selected-shoot list keeps its own layout and scrolls sideways when it is wider than
 * the dialog; only the actions column is special - a ⋯ pinned to the right edge of that one scroll
 * area, opening Duplicate and Remove, so no shoot has to be scrolled to before it can be acted on.
 */

const DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", "AddShootDialog.js"), "utf8");

test("the table keeps its layout: one-line cells, its own width and type, in one scroll area", () => {
  assert.match(DIALOG, /classNames=\{\{ wrapper: "mt-6 !rounded-md max-h-\[min\(24rem,50dvh\)\] overflow-y-auto", table: "min-w-full text-sm", head: "!text-sm !tracking-normal", th: "whitespace-nowrap !py-2\.5", row: "text-slate-700", td: "whitespace-nowrap !py-2\.5", empty: "!py-8" \}\}/);
  /*
   * Every data column is drawn as it was - nothing wrapped or pinned of its own - except Shoot,
   * which is capped: several shoots ticked become one shoot named for all of them, and one long
   * name would otherwise widen the list for every row. It ends in "..." and says itself in full
   * through the cell's `title`.
   */
  for (const label of ["Shoot Type", "Date", "Shoot Place", "District", "State", "Session Timing", "Duration", "Food Taken Care by", "Accommodation", "Travel", "Preference", "Main Event"]) {
    assert.match(DIALOG, new RegExp(`\\{ key: "[a-zA-Z]+", label: "${label}", render: `), label);
  }
  assert.match(DIALOG, /\{ key: "shoot", label: "Shoot", maxWidth: NAME_COLUMN_MAX_WIDTH, title: \(shoot\) => shootDisplayName\(shoot\), render: /);
});

test("only the actions column is pinned to the right, on a solid ground with an edge", () => {
  assert.match(DIALOG, /\{ key: "actions", label: "Actions", srOnly: true, headerClassName: "sticky right-0 z-\[1\] w-10 bg-slate-50 shadow-\[inset_1px_0_0_#e2e8f0,-6px_0_8px_-6px_rgba\(15,23,42,0\.12\)\]"/);
  assert.match(DIALOG, /cellClassName: "sticky right-0 z-\[1\] w-10 bg-white text-center shadow-\[inset_1px_0_0_#e2e8f0,-6px_0_8px_-6px_rgba\(15,23,42,0\.12\)\]"/);
  assert.equal((DIALOG.match(/sticky right-0/g) || []).length, 2, "nothing else is pinned");
});

test("each row's ⋯ opens the shared row menu: Duplicate, then Remove in the destructive tone", () => {
  assert.match(DIALOG, /import OptionsMenu from "@\/components\/ui\/OptionsMenu";/);
  assert.match(DIALOG, /triggerContent="⋯"/);
  // The app's own 32px row trigger, its margin and alignment keeping the row the height it had.
  assert.match(DIALOG, /triggerContent="⋯"\n\s*triggerClassName="-my-2 align-text-bottom"/);
  assert.doesNotMatch(DIALOG, /triggerSize=/);
  // Above the dialog it opens from, as the dialog's other menus are.
  assert.match(DIALOG, /menuZIndexClassName="z-\[170\]"/);
  assert.match(DIALOG, /\{ label: "Duplicate", onSelect: \(\) => duplicateRow\(index\) \},\n\s*\{ label: "Remove", tone: "danger", onSelect: \(\) => removeRow\(index\) \},/);
  // Each says what it did on the status line, and each row's menu is told apart by its number.
  assert.match(DIALOG, /setNotice\(`\$\{rowName\(index\)\} duplicated - the copy is row \$\{index \+ 2\}\.`\);/);
  assert.match(DIALOG, /setNotice\(`\$\{rowName\(index\)\} removed from the list\.`\);/);
  assert.match(DIALOG, /ariaLabel=\{`Actions for row \$\{index \+ 1\}, \$\{shootDisplayName\(shoot\) \|\| "shoot"\}`\}/);
  assert.doesNotMatch(DIALOG, />Remove<\/button>|<CloseIcon/, "no direct remove control is left on the row");
});

/*
 * The two actions, run as they are written in the dialog: the source of each is lifted out and
 * driven by a stand-in for `setShoots`, so this is the real code and not a copy of it.
 */
function listActions() {
  const take = (name) => DIALOG.match(new RegExp(`const ${name} = \\(index\\) => setShoots\\([\\s\\S]*?\\);\\n`))[0];
  let list = [];
  const setShoots = (next) => { list = typeof next === "function" ? next(list) : next; };
  const { removeShoot, duplicateShoot } = new Function("setShoots", `${take("removeShoot")}${take("duplicateShoot")}return { removeShoot, duplicateShoot };`)(setShoots);
  return { set: (rows) => { list = rows; }, get: () => list, removeShoot, duplicateShoot };
}

const row = (shoot, extra = {}) => ({ shoot, shootTypes: ["Outdoor"], dateCreated: "2026-11-01", shootPlace: "Erode", district: "Erode", state: "Tamil Nadu", sessionTimings: ["Full Session"], foodTakenCareBy: "Studio", accommodation: "Client", travel: "Studio", preference: "Both", isMainEvent: false, ...extra });

test("Duplicate puts a copy of that row straight after it, its own object, every value kept", () => {
  const actions = listActions();
  const rows = [row("Bride Haldi"), row("Wedding", { isMainEvent: true }), row("Reception")];
  actions.set(rows);
  actions.duplicateShoot(0);
  const after = actions.get();
  assert.deepEqual(after.map((shoot) => shoot.shoot), ["Bride Haldi", "Bride Haldi", "Wedding", "Reception"]);
  assert.deepEqual(after[1], rows[0]);
  assert.notEqual(after[1], after[0], "two rows, not one shown twice");
  assert.notEqual(after[1].shootTypes, after[0].shootTypes, "nothing shared between them");
  // The rows already there are the same rows, untouched.
  assert.equal(after[0], rows[0]);
  assert.equal(after[2], rows[1]);
  assert.equal(after[3], rows[2]);
});

test("a copy of the Main Event is not the Main Event: the mark stays where it was, on one shoot", () => {
  const actions = listActions();
  actions.set([row("Wedding", { isMainEvent: true }), row("Reception")]);
  actions.duplicateShoot(0);
  assert.deepEqual(actions.get().map((shoot) => [shoot.shoot, shoot.isMainEvent]), [["Wedding", true], ["Wedding", false], ["Reception", false]]);
  // A copy of a shoot that was not the Main Event never becomes it either.
  actions.duplicateShoot(2);
  assert.equal(actions.get().filter((shoot) => shoot.isMainEvent).length, 1);
});

test("Remove takes out that one row - the copy or the original - and nothing else", () => {
  const actions = listActions();
  const rows = [row("Bride Haldi"), row("Wedding", { isMainEvent: true }), row("Reception")];
  actions.set(rows);
  actions.duplicateShoot(1);
  actions.removeShoot(2);
  assert.deepEqual(actions.get(), rows, "the copy removed leaves the list as it was");
  actions.removeShoot(0);
  assert.deepEqual(actions.get().map((shoot) => shoot.shoot), ["Wedding", "Reception"]);
  assert.equal(actions.get()[0].isMainEvent, true, "removing another shoot leaves the Main Event alone");
  // A row that is not there changes nothing.
  const before = actions.get();
  actions.duplicateShoot(9);
  assert.equal(actions.get(), before);
});

test("neither action reaches the server: the list is saved only by Save, as before", () => {
  const block = DIALOG.slice(DIALOG.indexOf("const removeShoot ="), DIALOG.indexOf("function addCurrentShoot()"));
  assert.doesNotMatch(block, /apiRequest|fetch\(|await |onSave|service/);
  assert.match(DIALOG, /await onSave\(rows\);/);
});

test("every entry point opens the one Add Shoot dialog, so the ⋯ behaves the same from each", () => {
  const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", ...parts), "utf8");
  // Booking and Converted (Create Project, create and edit), the Quotation Generator, Start Project.
  const hosts = [["sales", "CreateProjectFormPanel.js"], ["sales", "QuotationGeneratorPanel.js"], ["project-management", "StartProjectFormPanel.js"]];
  for (const file of hosts) {
    const source = read(...file);
    assert.match(source, /import AddShootDialog(, \{[^}]*\})? from "(@\/components\/project-management|\.)\/AddShootDialog";/, file.join("/"));
    assert.match(source, /<AddShootDialog\b/, file.join("/"));
    assert.doesNotMatch(source, /current\.filter\(\(_, rowIndex\) => rowIndex !== index\)/, `${file.join("/")} keeps no list of its own`);
  }
  // Booking reaches it through Create Project.
  assert.match(read("sales", "ProjectBookingPanel.js"), /return <CreateProjectFormPanel/);
  // The dialog still hands its rows to its host exactly as it did.
  assert.match(DIALOG, /await onSave\(rows\);/);
  assert.equal((DIALOG.match(/setShoots\(/g) || []).length, 3, "Add Shoot List, Duplicate and Remove are the only writers of the list");
});
