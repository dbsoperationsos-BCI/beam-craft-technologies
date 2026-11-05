const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parseIdentifier, formatIdentifier } = require("../src/services/identifiers");

/*
 * A booking's identifier and its lead's have to name the same vertical.
 *
 * They did not. `vertical` is optional on a project and Create Project does not always carry it, so
 * it arrived null - and `verticalCode` then falls back to `DD`, the default for a record that names
 * no vertical at all. A Qua Qua booking came out `DBS-BK-DD-CBE-000005` sitting beside its own
 * lead's `DBS-EID-QQ-CBE-000001`: the code said Dum Dum about a job the enquiry beside it said was
 * Qua Qua.
 *
 * It is the worst shape a fault can have. Nothing errors, the project saves, the row looks right,
 * and the only sign is a letter in the middle of a code - which is the half nobody reads, because
 * an identifier is quoted by the number on the end of it. The Vertical column read "—" on exactly
 * those rows and nothing connected the two.
 *
 * So: the enquiry id is the answer where the project names no vertical. It was minted for that lead
 * under that lead's vertical, and a booking is what a converted lead becomes - the two cannot
 * honestly differ.
 */

const CONTROLLER = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"),
  "utf8",
);

/** What the booking's code comes out as, for a project carrying these fields. */
function bookingId({ vertical = null, enquiryId = "", branch = "Erode" }) {
  const named = String(vertical || "").trim();
  const fromLead = parseIdentifier("CRM_LEAD", enquiryId)?.vertical || "";
  return formatIdentifier("SALES_PROJECT", { vertical: named || fromLead, branch }, 1);
}

test("a booking against a Qua Qua lead is a Qua Qua booking", () => {
  // The exact row from the report: the lead was Qua Qua and the booking said Dum Dum.
  assert.equal(
    bookingId({ vertical: null, enquiryId: "DBS-EID-QQ-CBE-000001", branch: "Coimbatore" }),
    "DBS-BK-QQ-CBE-000001",
  );
  assert.equal(
    bookingId({ vertical: null, enquiryId: "DBS-EID-QQ-VIZAG-000002", branch: "Vizag" }),
    "DBS-BK-QQ-VIZAG-000001",
  );
  // And a Corp lead is a Corp booking, by the same reading.
  assert.equal(
    bookingId({ vertical: null, enquiryId: "DBS-EID-CORP-ERD-000009", branch: "Erode" }),
    "DBS-BK-CORP-ERD-000001",
  );
});

test("a vertical somebody actually chose is never overruled by the lead's", () => {
  /*
   * Only a blank is filled. A booking can be sold across verticals - a wedding client booking a
   * corporate shoot - and second-guessing that from an id would be the same class of mistake in the
   * other direction, with the studio's own choice thrown away.
   */
  assert.equal(
    bookingId({ vertical: "WED", enquiryId: "DBS-EID-QQ-CBE-000001", branch: "Coimbatore" }),
    "DBS-BK-DD-CBE-000001",
  );
  assert.equal(
    bookingId({ vertical: "CORP", enquiryId: "DBS-EID-DD-ERD-000001", branch: "Erode" }),
    "DBS-BK-CORP-ERD-000001",
  );
});

test("a booking with nothing to go on is still saveable", () => {
  /*
   * No vertical and no enquiry to read one from - an imported row, a project typed in against
   * nothing. It takes the studio's own fallback rather than refusing: a wrongly-vertical'd code can
   * be read and corrected, and a project that cannot be saved cannot.
   */
  assert.equal(bookingId({ vertical: null, enquiryId: "", branch: "Erode" }), "DBS-BK-DD-ERD-000001");
  assert.equal(bookingId({ vertical: null, enquiryId: "not-an-id", branch: "Erode" }), "DBS-BK-DD-ERD-000001");
});

test("the shoot inside a booking reads its vertical the same way", () => {
  // Otherwise a shoot would sit on a different vertical from the project it belongs to, which is
  // the same fault one level down and just as quiet.
  const shoots = CONTROLLER.slice(CONTROLLER.indexOf("const nextShootId"), CONTROLLER.indexOf("async function listProjects"));
  assert.match(shoots, /vertical: verticalForProject\(project\)/);
  const bookings = CONTROLLER.slice(CONTROLLER.indexOf("const nextEventId"), CONTROLLER.indexOf("const nextShootId"));
  assert.match(bookings, /vertical: verticalForProject\(project\)/);
});

/* ─────────────────────────────────────────────── and the column that was empty ── */

test("the vertical is written onto the project, not only into its code", () => {
  /*
   * The fault at its source. Fixing only the identifier would leave the Vertical column reading "—"
   * on those rows - and every filter, report and group-name check that reads that column would go on
   * seeing a booking with no vertical at all.
   */
  assert.match(CONTROLLER, /function withInferredVertical\(projectData\) \{/);
  // Both create paths fill it before anything reads it, so the row and its code cannot disagree.
  assert.equal((CONTROLLER.match(/withInferredVertical\(raw\)/g) || []).length, 2, "one of the two create paths no longer fills the vertical");
  const fill = CONTROLLER.slice(CONTROLLER.indexOf("function withInferredVertical"), CONTROLLER.indexOf("function withInferredVertical") + 500);
  assert.match(fill, /if \(String\(projectData\?\.vertical \|\| ""\)\.trim\(\)\) return projectData;/, "a chosen vertical is being overwritten");
});

test("the two vocabularies are mapped rather than assumed to match", () => {
  /*
   * They agree on two of three and not on the first. An identifier writes Dum Dum as `DD`; a project
   * writes it as `WED`. Storing `DD` in a column whose enum is WED/QQ/CORP would be a value no
   * filter, report or group-name check could match - a quieter fault than the one being fixed.
   */
  assert.match(CONTROLLER, /const PROJECT_VERTICAL_BY_CODE = \{ DD: "WED", QQ: "QQ", CORP: "CORP" \};/);
  /*
   * And the enum it has to land in is still those three.
   *
   * Read from the shared constant rather than from a literal in this controller: the list was
   * extracted to `salesVertical.js` so the several places that name the studio's verticals cannot
   * drift apart, and a test pinning the old copy would fail on a refactor that changed nothing.
   * What matters is the *value* landing in the column, which is what this checks.
   */
  assert.match(CONTROLLER, /const verticals = VERTICAL_CODES;/);
  assert.deepEqual(require("../src/services/salesVertical").VERTICAL_CODES, ["WED", "QQ", "CORP"]);
});
