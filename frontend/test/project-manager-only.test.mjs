import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Who may edit and delete a project, on the screens that offer it.
 *
 * The server decides; this is the other half of Rule 4, which is that a control somebody may not use
 * is **absent** rather than shown and refused. Both halves have to move together: tightening the
 * endpoint and leaving the menu alone would give the CRM an Edit that answers 403, which is a worse
 * screen than the one before the change.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const TABLE = read("components", "data-table", "ProjectDataTable.js");
const PROJECTS = read("components", "project-management", "ProjectsPage.js");
const SALES = read("components", "sales", "SalesManagerPage.js");

test("Edit and Delete answer to who works on the project, not to who sold it", () => {
  /*
   * `mayEditSale` is "may you sell". Booking a project is `SALES / Sales Manager` `READ_WRITE` and it
   * used to be the whole of the guard on both entries, so the CRM who typed a booking could rewrite
   * it long after the studio had begun working to it, and could delete it outright.
   */
  assert.match(TABLE, /const answers = \(may\) => !readOnly && Boolean\(canEditSale \|\| canPlan\) && typeof may === "function" && may\(project\);/);
  assert.match(TABLE, /const mayEditRecord = answers\(canEditProject\);/);
  assert.match(TABLE, /const mayDeleteRecord = answers\(canDeleteProject\);/);
  assert.match(TABLE, /: mayEditRecord && onEditSaleDetails \? \[\{ label: "Edit"/);
  // Neither entry is still gated on the sale alone.
  assert.doesNotMatch(TABLE, /mayEditSale && onDelete \? \[\{ label: "Delete"/);
  assert.doesNotMatch(TABLE, /mayEditSale && onEditSaleDetails \? \[\{ label: "Edit"/);
});

test("a coordinator gets the Edit and not the Delete", () => {
  /*
   * The whole reason there are two predicates rather than one. Each of the three coordinators is
   * working to the project and has reason to correct what it says; none of them should be able to
   * take it away from the others - so Delete reads `mayDeleteRecord`, which is the manager's seat
   * alone, and must never be wired to the wider answer.
   */
  assert.match(TABLE, /\.\.\.\(mayDeleteRecord && onDelete \? \[\{ label: "Delete"/);
  assert.doesNotMatch(TABLE, /mayEditRecord && onDelete/);
  // And the two lists differ by exactly the manager leading one of them.
  const STAFF = read("constants", "projectStaff.js");
  assert.match(STAFF, /"projectManagerEmployeeId",\s*\n\s*"preProductionCoordinatorEmployeeId",\s*\n\s*"creativeManagerEmployeeId",\s*\n\s*"postProductionCoordinatorEmployeeId",/);
  for (const source of [PROJECTS, SALES]) {
    assert.match(source, /staffedOn\(project, PROJECT_STAFF_FIELDS\)/, "edit should read every staffed seat");
    assert.match(source, /staffedOn\(project, PROJECT_STAFF_FIELDS\.slice\(0, 1\)\)/, "delete should read the manager's seat alone");
  }
});

test("an owner who may plan can still reach the booking, before the project starts and after", () => {
  /*
   * The hole this closes. The plan form shows the sale **read-only** on purpose, so a viewer who may
   * plan only ever saw the plan entry - fine while the booking belonged to the CRM, who reached it
   * from Sales Manager, and not fine at all once the Project Manager and the branch administrator
   * became the only people who may change a booking. Without this entry the answer to "who edits the
   * sale on a started project" would have been nobody.
   *
   * It is also what rule 4 asks for: before a project starts, the details that can be corrected are
   * the ones the CRM filled in, and this is the form that holds them.
   */
  assert.match(TABLE, /\.\.\.\(mayPlan && mayEditRecord && onEditSaleDetails\s*\n\s*\? \[\{ label: "Edit Sale Details", onSelect: \(\) => onEditSaleDetails\(project\) \}\]\s*\n\s*: \[\]\),/);
  /*
   * Named in full rather than as a second "Edit": the one person who can open both forms would
   * otherwise get two entries reading the same word, which is a menu that cannot be aimed at.
   */
  assert.equal((TABLE.match(/label: "Edit Sale Details"/g) || []).length, 1);
  // And it is an owner's entry, not a seller's - `mayEditSale` must not be what opens it.
  assert.doesNotMatch(TABLE, /mayPlan && mayEditSale && onEditSaleDetails/);
});

test("Duplicate stays with whoever sells, because it books a second project", () => {
  // Not an act on the project in front of them: it is a create, and creating is still the sale's
  // own permission. Moving it with the other two would have taken booking away from the CRM.
  assert.match(TABLE, /const mayDuplicate = mayEditSale && Boolean\(onDuplicate\) && canDuplicateProject\(project\);/);
});

test("a missing permission answer reads as no", () => {
  /*
   * `mayEditSale` was `canEditSale ?? true`, so a caller that simply forgot the prop was handed the
   * sale's actions. No screen was bitten by it, which is luck rather than design - a permission
   * default has to point at "no", or the next screen to render this table inherits a hole.
   */
  assert.match(TABLE, /const mayEditSale = !readOnly && Boolean\(onEditSaleDetails \|\| onDelete\) && Boolean\(canEditSale\);/);
  // The expression itself, not the comment above it that quotes what it used to be.
  assert.doesNotMatch(TABLE, /&& \(canEditSale \?\? true\)/);
  // The new prop is a function or it is nothing: `canManageProject(project)` on a missing prop would
  // throw rather than refuse, and a thrown render is not a refusal.
  assert.match(TABLE, /typeof may === "function"/);
});

test("a viewer who owns nothing still gets a menu rather than a broken one", () => {
  // The view-only branch has to know about the new answer too, or a Project Manager who does not
  // hold the sale's permission would fall into it and lose the Edit that is theirs.
  assert.match(TABLE, /: !mayEditSale && !mayPlan && !mayEditRecord && !mayDeleteRecord \? \[\{ label: "View Project Details"/);
});

test("both screens that offer the actions ask the same question, from one predicate", () => {
  /*
   * One project has one owner, so the rule is written once per screen and used for both questions it
   * answers - the plan of a running project (`canEditStarted`) and the record itself
   * (`canManageProject`). Writing it twice is how the two would have drifted into different people.
   */
  for (const [name, source] of [["Projects", PROJECTS], ["Sales Manager", SALES]]) {
    assert.match(source, /const canEditProject = useCallback\(/, `${name} does not answer who may change it`);
    assert.match(source, /const canDeleteProject = useCallback\(/, `${name} does not answer who may delete it`);
    assert.match(source, /canEditProject=\{canEditProject\} canDeleteProject=\{canDeleteProject\}/, `${name} does not pass both answers to the table`);
    assert.match(source, /useModuleAccess\("ADMIN", "Branch Administration"\)/, `${name} does not read the branch permission`);
    // The seats come from the one shared list rather than being spelled out per screen.
    assert.match(source, /import \{ PROJECT_STAFF_FIELDS \} from "@\/constants\/projectStaff"/, `${name} spells the staffed seats out itself`);
  }
  /*
   * The plan of a project already running stays the Project Manager's: a coordinator works a stage
   * of it and does not re-plan it, so this is fed by the *narrow* predicate and not the wide one.
   */
  assert.match(PROJECTS, /const canEditStarted = canDeleteProject;/);
});

test("the Sales Manager screen is gated too, because one endpoint feeds both", () => {
  /*
   * `PATCH /api/sales/projects/:id` is what Edit opens on either screen. Tightening it for Project
   * Management and leaving this one alone would have left the CRM an Edit the server then refuses -
   * and it is this screen, not the other, where the CRM actually works.
   *
   * What it costs is real and deliberate: the CRM who books a sale can no longer correct it
   * afterwards. Booking a new one is untouched.
   */
  assert.match(SALES, /canEditSale=\{canWrite\} canEditProject=\{canEditProject\} canDeleteProject=\{canDeleteProject\}/);
});
