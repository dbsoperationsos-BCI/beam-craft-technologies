const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");

/*
 * A date the app cannot read must not be the reason a project cannot be booked.
 *
 * Converting a lead opens Create Project with the lead's event date already filled in, and a lead's
 * dates are **text** - from a CSV out of Excel, from a Google Sheet, from somebody typing. The
 * schema ran `z.coerce.date()` over whatever arrived, which hands `new Date()` the raw cell and
 * checks what comes back: anything unreadable became an Invalid Date and the whole request was
 * refused with
 *
 *     mainEventDate: Invalid input: expected date, received Date
 *
 * Three things wrong at once. It names a field **Create Project has no control for**, so there was
 * nowhere to go and correct it; it is written for whoever wrote the schema; and it stopped the
 * project being created at all. A lead whose date the CRM had stored as free text could not be
 * converted, full stop.
 *
 * A date that cannot be read is not a date, so it now reads as *not decided* - the same answer ""
 * and null already gave. The `mainEventDateKnown` check in `superRefine` is what still catches a
 * caller who insisted the date was known, and it says so in words somebody can act on.
 *
 * The declaration is lifted out of the controller rather than imported: requiring that file pulls
 * in Prisma and the whole module. It depends on nothing but `z`, which is what makes lifting it
 * honest - what runs here is the code that ships.
 */

const CONTROLLER = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"),
  "utf8",
);

const source = (() => {
  const start = CONTROLLER.indexOf("const optionalEventDate = z.preprocess(");
  assert.notEqual(start, -1, "optionalEventDate was not found in the projects controller");
  const end = CONTROLLER.indexOf("z.date().nullable()).optional();", start);
  assert.notEqual(end, -1, "the end of optionalEventDate was not found");
  return CONTROLLER.slice(start, end + "z.date().nullable()).optional();".length);
})();

const optionalEventDate = new Function("z", `${source}\nreturn optionalEventDate;`)(z);

const parsed = (value) => {
  const result = optionalEventDate.safeParse(value);
  assert.equal(result.success, true, `${JSON.stringify(value)} was refused: ${result.error?.issues?.[0]?.message}`);
  return result.data;
};

test("a date nobody can read is not a date, and does not refuse the project", () => {
  /*
   * The shapes that actually reached this field and stopped a conversion. Each one is something a
   * person or a spreadsheet genuinely put in a CRM date column.
   */
  for (const unreadable of ["Apr (3999)", "not sure yet", "--", "next month", "0000-00-00"]) {
    assert.equal(parsed(unreadable), null, unreadable);
  }
});

/*
 * What this deliberately does *not* do: tighten what `new Date()` is willing to read.
 *
 * `new Date("12-12")` is 12 December 2001, which is nobody's answer - but it parsed before this
 * change and a schema is not the place to start reinterpreting values that already resolved. Every
 * other caller of this field sends spreadsheet dates through the same door, and narrowing it here
 * would refuse imports that work today.
 *
 * The conversion no longer relies on that leniency either way: `toIsoDay` screens the lead's cell
 * first and sends "" for anything it cannot place, so a half-typed date reaches the project as
 * "not decided" rather than as a year nobody chose.
 */
test("a shape new Date reads loosely is still read loosely, on purpose", () => {
  assert.equal(parsed("12-12").getFullYear(), 2001, "narrowing this would refuse imports that work today");
});

test("an empty answer still means not decided, as it always did", () => {
  assert.equal(parsed(""), null);
  assert.equal(parsed(null), null);
  assert.equal(parsed(undefined), undefined, "a field never sent stays absent rather than becoming null");
});

test("a date that can be read is kept, and kept as the day it says", () => {
  // What the conversion now sends: the board's own ISO reading, which `new Date` takes as UTC
  // midnight - so the day stored is the day the lead showed, whatever zone the server is in.
  assert.equal(parsed("2026-12-12").toISOString().slice(0, 10), "2026-12-12");
  assert.equal(parsed("2026-01-02").toISOString().slice(0, 10), "2026-01-02");
  // A Date handed in directly is left alone.
  const already = new Date("2026-03-04T00:00:00.000Z");
  assert.equal(parsed(already).toISOString(), already.toISOString());
});

/*
 * The other half of the fix, in the conversion that supplies this field: the lead's date is folded
 * to `YYYY-MM-DD` before it is sent, so a readable-but-odd cell reaches the project as the day the
 * board shows rather than as whatever `new Date()` makes of it in the server's own zone.
 */
test("the conversion sends the board's reading of the date, not the raw cell", () => {
  const PAGE = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "SalesManagerPage.js"),
    "utf8",
  );
  assert.match(
    PAGE,
    /const eventDate = toIsoDay\(details\.eventPlannedDate \|\| lead\.eventPlannedDate \|\| lead\.date \|\| ""\);/,
    "the conversion is handing the project a raw CRM date cell again",
  );
  assert.match(PAGE, /import \{ toIsoDay \} from "@\/lib\/crmLeadDates";/);
});
