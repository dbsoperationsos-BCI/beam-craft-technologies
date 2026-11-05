import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { VERTICAL_CODES, verticalCode, buildGroupName } from "../src/components/sales/whatsappGroupNameUtils.js";

/*
 * "WED" belongs to the WhatsApp group name, and nowhere else a person reads.
 *
 * Dum Dum is stored on a project as the code `WED`, which the studio types into WhatsApp and has to
 * go on reading. But the Projects register printed that code straight into its **Vertical** column
 * and onto the info panel beside it - so a column describing what kind of project this is answered
 * with an internal spelling of it. Anywhere the vertical is a fact *about* the project it reads
 * **DD**, which is what the studio calls it.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("a stored vertical reads as the studio's own short code", () => {
  assert.equal(verticalCode("WED"), "DD");
  assert.equal(verticalCode("QQ"), "QQ");
  assert.equal(verticalCode("CORP"), "Corp");
  // Case-insensitive, because the code arrives from the database as often as from a form.
  assert.equal(verticalCode("wed"), "DD");
  // A vertical the map has no name for is passed through rather than blanked: a wrong word on
  // screen is recoverable, a disappeared one is not.
  assert.equal(verticalCode("NEW"), "NEW");
  assert.equal(verticalCode(""), "", "a project with no vertical must not read as one");
  assert.equal(verticalCode(null), "");
});

test("the group name still says WED, which is the one place it belongs", () => {
  const name = buildGroupName({
    enquiryId: "DBS-EID-DD-ERD-000001", groupType: "Dum Dum", tier: "Premium", branch: "Erode", offerName: "",
    groomName: "Arun", brideName: "Meena", mainEventDateKnown: false, place: "Erode",
    gou: false, houseType: "Own", socialMediaPosting: "Yes",
  });
  assert.ok(name.startsWith("WED "), `the group name no longer opens with WED: ${name}`);
});

test("the Projects register reads the vertical through that code, cell, filter and CSV alike", () => {
  /*
   * One line in `displayValue`, which feeds the cell, the column's accessor - so the filter and the
   * sort - and `exportValue`. Formatted in three places instead, a CSV would say WED while the
   * column beside it said DD.
   */
  const TABLE = read("components", "data-table", "ProjectDataTable.js");
  assert.match(TABLE, /if \(columnId === "vertical"\) return verticalCode\(project\.vertical\) \|\| "—";/);
  assert.match(TABLE, /accessorFn: \(project\) => displayValue\(project, column\.id\)/);
  assert.match(TABLE, /exportValue: \(project\) => displayValue\(project, column\.id\)/);
});

test("the info panel and the record read it the same way", () => {
  // Otherwise the column says DD and the panel that opens from it says WED.
  const FORMATTERS = read("components", "project-management", "projectInfoFormatters.js");
  assert.match(FORMATTERS, /vertical: \(value\) => verticalCode\(value\) \|\| "—",/);
  const CONFIG = read("constants", "infoPanelConfig.js");
  const projectConfigs = CONFIG.slice(CONFIG.indexOf("export const commonProjectInfoSections"), CONFIG.indexOf("export const quotationInfoSections"));
  assert.doesNotMatch(projectConfigs, /\["vertical", "Vertical"\]/, "a project section still prints the raw stored code");
  assert.ok(projectConfigs.includes('["vertical", "Vertical", "vertical"]'));
});

test("the short code is held in one place, not written out per screen", () => {
  // The CRD document tab title used its own copy of the same three pairs.
  assert.deepEqual(VERTICAL_CODES, { WED: "DD", QQ: "QQ", CORP: "Corp" });
  const SHARED = read("components", "sales", "crdDocumentShared.js");
  assert.match(SHARED, /export \{ VERTICAL_CODES as TITLE_PREFIX_BY_VERTICAL \}/, "the CRD title keeps a second copy of the mapping");
});
