import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Whether a thing is given rather than charged for.
 *
 * Asked of a service and of a deliverable, independently: a complimentary service does not make its
 * deliverables complimentary, and a deliverable a service brings in keeps its own answer. A
 * quotation copies the master's answer onto a line as the line is added, and the line's answer is
 * its own from then on - changed for that quotation alone, never written back to Settings, and
 * never moved by a Settings change afterwards.
 *
 * Only TRUE is complimentary, so everything saved before this was asked reads No.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const SERVICE_DIALOG = src("components", "project-management", "ServiceDefinitionDialog.js");
const DELIVERABLE_DIALOG = src("components", "project-management", "DeliverableDefinitionDialog.js");
const PANEL = src("components", "project-management", "ProjectSettingsPanel.js");
const SECTION = src("components", "project-management", "ProjectServiceCreationSection.js");
const GENERATOR = src("components", "sales", "QuotationGeneratorPanel.js");
const SCHEMA = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "prisma", "schema.prisma"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "sales", "projects", "controller.js"), "utf8");

test("both masters carry the answer, and both default to No", () => {
  // Nullable, and only TRUE counts - so every row already here reads No without being touched.
  assert.equal([...SCHEMA.matchAll(/^\s+complimentary\s+Boolean\?/gm)].length, 2);
  assert.equal([...CONTROLLER.matchAll(/complimentary: z\.boolean\(\)\.optional\(\),/g)].length, 2);
});

test("both dialogs ask it, and open on No where it was never answered", () => {
  assert.match(SERVICE_DIALOG, /<Dropdown\s*\n\s*label="Complimentary"/);
  assert.match(DELIVERABLE_DIALOG, /<Dropdown\s*\n\s*label="Complimentary"/);
  assert.match(SERVICE_DIALOG, /complimentary: String\(source\?\.complimentary === true\)/);
  assert.match(DELIVERABLE_DIALOG, /complimentary: String\(source\?\.complimentary === true\)/);
  // And both send it as the boolean the column is.
  assert.match(SERVICE_DIALOG, /complimentary: form\.complimentary === "true",/);
  assert.match(DELIVERABLE_DIALOG, /complimentary: form\.complimentary === "true",/);
});

test("both Settings tables list it", () => {
  assert.equal([...PANEL.matchAll(/\{ id: "complimentary", header: "Complimentary"/g)].length, 2);
  assert.equal([...PANEL.matchAll(/complimentary: row\.complimentary === true \? "Yes" : "No",/g)].length, 2);
});

test("a brand and a variant answer none of it", () => {
  // The head row above has answered once; repeating it down every line reads as an answer about
  // the line. Two sub-row builders - a service has no pricing rows under it any more - and each
  // leaves the cell blank.
  assert.equal([...PANEL.matchAll(/^\s+complimentary: "",$/gm)].length, 2);
});

/*
 * Complimentary is two things wearing one word, and the whole point is that they are not the same.
 *
 *   the master's answer  = a PERMISSION: whether this may be given away at all
 *   the line's answer    = the CHOICE made on this one quotation
 *
 * So the master decides whether the question is asked, and the answer always starts at No. A
 * service the studio allows to be complimentary is not thereby complimentary.
 */
test("the master's answer is a permission, never the line's answer", () => {
  // The two are set from different places: the permission from the master, the answer from the row.
  assert.equal([...GENERATOR.matchAll(/complimentaryAllowed: definition\?\.complimentary === true,/g)].length, 2);
  assert.equal([...GENERATOR.matchAll(/complimentary: row\.complimentary === true,/g)].length, 2);
  // And the master's answer is never copied into the line's - the mistake this replaced.
  assert.doesNotMatch(GENERATOR, /complimentary: definition\?\.complimentary/);
  assert.doesNotMatch(GENERATOR, /complimentary: service\?\.complimentary/);
});

test("a line permitted to be complimentary still starts at No", () => {
  const normalize = (row, definition) => ({ ...row, complimentaryAllowed: definition?.complimentary === true, complimentary: row.complimentary === true });
  assert.equal(normalize({}, { complimentary: true }).complimentary, false, "permitted, but not thereby complimentary");
  assert.equal(normalize({}, { complimentary: true }).complimentaryAllowed, true);
  assert.equal(normalize({}, { complimentary: false }).complimentaryAllowed, false);
  // A line already answered keeps its answer through a normalise - editing must not reset it.
  assert.equal(normalize({ complimentary: true }, { complimentary: true }).complimentary, true);
});

test("a line the master does not permit is not asked the question", () => {
  assert.match(SECTION, /const complimentaryAllowed = \(row\) => row\?\.complimentaryAllowed === true \|\| row\?\.complimentary === true;/);
  // Both cells fall back to the read-only display rather than a dropdown.
  assert.equal([...SECTION.matchAll(/\|\| !complimentaryAllowed\(row\.original\) \? displayComplimentary\(row\.original\)/g)].length, 2);
  assert.match(SECTION, /const displayComplimentary = \(row\) => \(!complimentaryAllowed\(row\) \? "-"/);
});

test("a saved Yes keeps its control even if the permission is later withdrawn", () => {
  // It is a fact about a quotation somebody raised; hiding the control would leave an answer on the
  // line with no way to change it.
  const allowed = (row) => row?.complimentaryAllowed === true || row?.complimentary === true;
  assert.equal(allowed({ complimentaryAllowed: false, complimentary: true }), true);
  assert.equal(allowed({ complimentaryAllowed: false, complimentary: false }), false);
});

test("the line's answer is editable, and is the line's own", () => {
  // Committed onto the row, so it is stored in the payload with the rest of the line and never
  // written back to the master.
  assert.match(SECTION, /updateServiceCell\(row\.original, \{ complimentary: value === "true" \}\)/);
  assert.match(SECTION, /updateDeliverableCell\(row\.original, \{ complimentary: value === "true" \}\)/);
  assert.match(SECTION, /const complimentaryValue = \(row\) => String\(row\?\.complimentary === true\);/);
});

test("only the Quotation Generator asks the question", () => {
  // A project records work done and prices nothing, so its screens keep the columns they have.
  assert.match(SECTION, /complimentaryColumn = false,/);
  assert.equal([...SECTION.matchAll(/\.\.\.\(complimentaryColumn \? \[\{ id: "complimentary"/g)].length, 2);
  assert.match(GENERATOR, /\n\s*complimentaryColumn\n/);
  for (const file of ["StartProjectFormPanel.js", "useProjectPlan.js"]) {
    assert.doesNotMatch(src("components", "project-management", file), /complimentaryColumn/);
  }
  assert.doesNotMatch(src("components", "sales", "CreateProjectFormPanel.js"), /complimentaryColumn/);
});

test("both tables fit the pane they are drawn in, Complimentary included", () => {
  /*
   * `minWidth` is a hard floor, so a set of columns whose floors outrun the pane pushes the last of
   * them out of sight - which is exactly what adding Complimentary did: the services floors came to
   * 933px and the deliverables' to 923px in a pane of about 900, so the new column was cut off and
   * the deliverables' never appeared at all. Both sets are rebalanced to fit with it.
   */
  const totals = (name) => {
    const start = SECTION.indexOf(`const ${name} = useMemo`);
    const block = SECTION.slice(start, SECTION.indexOf("], [busy,", start));
    return {
      width: [...block.matchAll(/width: "(\d+)%"/g)].reduce((sum, m) => sum + Number(m[1]), 0),
      min: [...block.matchAll(/minWidth: (\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0),
    };
  };
  for (const name of ["serviceColumns", "deliverableColumns"]) {
    const { width, min } = totals(name);
    assert.ok(width <= 100, `${name} widths come to ${width}%, which overflows the table`);
    assert.ok(min <= 850, `${name} floors come to ${min}px, which pushes a column out of the pane`);
  }
});

test("a cell's dropdown is no wider than the answers it holds", () => {
  /*
   * The control is `w-full`, so a cell holding "Full Session" or a plain "No" drew a box the whole
   * width of its column - several times longer than anything it can contain, which reads as a field
   * waiting for a sentence. The cap is on the control, not the column, so the heading keeps its
   * room; a cell whose answers really are long, like a size list, passes none and is unchanged.
   */
  assert.match(SECTION, /function SpreadsheetSelectCell\(\{ value: initialValue, options, disabled = false, onCommit, maxWidth \}\)/);
  assert.match(SECTION, /return maxWidth \? <div style=\{\{ maxWidth \}\}>\{control\}<\/div> : control;/);
  // Session Timing, and Complimentary on both tables.
  assert.equal([...SECTION.matchAll(/maxWidth=\{110\}/g)].length, 2);
  assert.equal([...SECTION.matchAll(/maxWidth=\{180\}/g)].length, 1);
  // The size cell is left to fill its column, because a size can be long.
  const sizeCell = SECTION.slice(SECTION.indexOf("sizeOptionValueId: value || null"));
  assert.doesNotMatch(SECTION.slice(SECTION.indexOf('id: "size"'), SECTION.indexOf('id: "size"') + 700), /maxWidth=/);
  assert.ok(sizeCell.length > 0);
});

test("the column rebuilds when the flag does", () => {
  // Otherwise turning it on would leave the memoised columns as they were.
  assert.match(SECTION, /\], \[busy, complimentaryColumn, onReorderServices, renderTimingCell, serviceLineNote, servicesByShoot, servicesEditable, sessionTimingColumn, shootsById, updateServiceCell\]\);/);
  assert.match(SECTION, /\], \[busy, complimentaryColumn, deliverableLineNote, deliverablesByShoot, deliverablesEditable, onReorderDeliverables, shootsById, updateDeliverableCell\]\);/);
});
