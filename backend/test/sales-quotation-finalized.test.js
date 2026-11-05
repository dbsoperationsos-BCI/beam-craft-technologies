const test = require("node:test");
const assert = require("node:assert/strict");
const { finalizedFields } = require("../src/modules/sales/projects/controller");

/*
 * Which version of a quotation chain a project actually converted at.
 *
 * The register lists one row per chain - its current version - with the earlier versions behind
 * it, and the marker belongs to the version that was sold rather than to the chain. A negotiation
 * usually ends before its last version is raised, so marking the chain would state a price the
 * studio never sold at.
 */

test("the version a project converted at is marked, and names the project", () => {
  const finalizedBy = new Map([["QUT039-01", "EV0042"]]);
  assert.deepEqual(
    finalizedFields({ quotationId: "QUT039-01" }, finalizedBy),
    { finalized: true, finalizedByEventId: "EV0042" },
  );
});

test("every other version of the same chain is left unmarked", () => {
  const finalizedBy = new Map([["QUT039-01", "EV0042"]]);
  // The chain's current version. The sale closed on 01, so 02 and 03 were raised after it or
  // were never chosen - either way they are not what the studio sold.
  for (const quotationId of ["QUT039-02", "QUT039-03"]) {
    assert.deepEqual(
      finalizedFields({ quotationId }, finalizedBy),
      { finalized: false, finalizedByEventId: null },
    );
  }
});

test("a version no project converted at carries no marker at all", () => {
  assert.deepEqual(
    finalizedFields({ quotationId: "QUT040-01" }, new Map()),
    { finalized: false, finalizedByEventId: null },
  );
});

test("a quotation with no id is unmarked rather than matching an empty key", () => {
  // A row written before quotation ids existed. Reading it as a match would mark it against
  // whichever project happened to hold a blank, which is every project created without one.
  const finalizedBy = new Map([["", "EV0042"], [undefined, "EV0043"]]);
  assert.deepEqual(
    finalizedFields({ quotationId: null }, finalizedBy),
    { finalized: false, finalizedByEventId: null },
  );
  assert.deepEqual(
    finalizedFields({}, finalizedBy),
    { finalized: false, finalizedByEventId: null },
  );
});
