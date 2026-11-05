const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChain, availableCover } = require("../src/services/alternativeChain");

/*
 * Who covers for somebody who is away.
 *
 * Every employee may name two alternatives, which together make a directed graph. The CRM walks it
 * to decide who a lead goes to when the person a Google Sheet rule names is on leave.
 *
 * **No shape is refused.** A chain, a ring of three, or two people who cover only each other are
 * all things a studio may arrange. There used to be a rule rejecting that last one on save; it is
 * gone, so resolution must not assume the walk ends on its own - and that guarantee, which was
 * load-bearing even when rings alone were legal, is what these tests now protect.
 */

// Vijay -> Abi, Kishore;  Abi -> Kishore;  Kishore names nobody. The studio's own example.
const VIJAY = 1;
const ABI = 2;
const KISHORE = 3;
const ROSTER = [
  { id: VIJAY, alternative1EmployeeId: ABI, alternative2EmployeeId: KISHORE },
  { id: ABI, alternative1EmployeeId: KISHORE, alternative2EmployeeId: null },
  { id: KISHORE, alternative1EmployeeId: null, alternative2EmployeeId: null },
];
const chain = () => buildChain(ROSTER);
const awayNobody = () => false;
const away = (...ids) => (id) => ids.includes(id);

/* ------------------------------------------------------------------ any shape is allowed */

test("two people may cover only each other", () => {
  /*
   * The pairing the old rule refused. It is what a studio with two people in a role actually wants,
   * and the day both are away is answered below rather than forbidden here.
   */
  const pair = buildChain([{ id: VIJAY, alternative1EmployeeId: ABI }, { id: ABI, alternative1EmployeeId: VIJAY }]);
  assert.deepEqual(availableCover(pair, VIJAY, away(VIJAY)), [ABI], "Vijay away, so Abi takes it");
  assert.deepEqual(availableCover(pair, ABI, away(ABI)), [VIJAY], "and the other way round");
  assert.deepEqual(availableCover(pair, VIJAY, away(VIJAY, ABI)), [], "both away is nobody, not a hang");
});

test("an employee still never covers themselves", () => {
  // Not a graph rule - a single row that says nothing. `alternativesProblem` refuses it on save,
  // and the chain drops it either way, so it can never reach the walk.
  const self = buildChain([{ id: VIJAY, alternative1EmployeeId: VIJAY, alternative2EmployeeId: ABI }]);
  assert.deepEqual(availableCover(self, VIJAY, away(VIJAY)), [ABI]);
});

/* ------------------------------------------------------------------ who gets the work */

test("somebody who is here keeps their own leads", () => {
  assert.deepEqual(availableCover(chain(), VIJAY, awayNobody), [VIJAY]);
});

test("one away: the work is shared between both alternatives, not piled on the first", () => {
  // A hundred leads landing on one person is what the studio was doing by hand and asked to stop.
  assert.deepEqual(availableCover(chain(), VIJAY, away(VIJAY)), [ABI, KISHORE]);
});

test("two away: the chain carries on to whoever is left", () => {
  assert.deepEqual(availableCover(chain(), VIJAY, away(VIJAY, ABI)), [KISHORE]);
});

test("the ring is taken whole, and the search stops as soon as somebody in it is free", () => {
  /*
   * Vijay's own two people are asked first, and the search only moves outward if **both** are away.
   * Otherwise some of Vijay's leads would go to Abi's alternative - somebody Vijay never nominated
   * - while Kishore, whom he did nominate, sits free.
   */
  const wide = buildChain([
    { id: VIJAY, alternative1EmployeeId: ABI, alternative2EmployeeId: KISHORE },
    { id: ABI, alternative1EmployeeId: 4 },
    { id: KISHORE, alternative1EmployeeId: 4 },
    { id: 4 },
  ]);
  assert.deepEqual(availableCover(wide, VIJAY, away(VIJAY)), [ABI, KISHORE]);
  assert.deepEqual(availableCover(wide, VIJAY, away(VIJAY, ABI)), [KISHORE]);
  assert.deepEqual(availableCover(wide, VIJAY, away(VIJAY, ABI, KISHORE)), [4]);
});

test("one person reached twice takes one share, not two", () => {
  // Abi and Kishore both name Priya and both are away: Priya covers once.
  const shared = buildChain([
    { id: VIJAY, alternative1EmployeeId: ABI, alternative2EmployeeId: KISHORE },
    { id: ABI, alternative1EmployeeId: 4 },
    { id: KISHORE, alternative1EmployeeId: 4 },
    { id: 4 },
  ]);
  assert.deepEqual(availableCover(shared, VIJAY, away(VIJAY, ABI, KISHORE)), [4]);
});

test("the whole chain away means nobody, and nobody is a real answer", () => {
  /*
   * The lead arrives unassigned. Visible, and somebody can act on it - where handing it to a person
   * the studio never nominated is neither. This is also what the end of the line is *for*.
   */
  assert.deepEqual(availableCover(chain(), VIJAY, away(VIJAY, ABI, KISHORE)), []);
  assert.deepEqual(availableCover(chain(), KISHORE, away(KISHORE)), [], "the end of the line has no cover by definition");
});

test("a walk round a ring still ends", () => {
  /*
   * Rings and pairs are both legal, so resolution genuinely can come back to where it started.
   * Termination rests on visiting each employee once, not on the graph being loop-free - which is
   * why this is a test rather than a comment.
   */
  const ring = buildChain([
    { id: 1, alternative1EmployeeId: 2 },
    { id: 2, alternative1EmployeeId: 3 },
    { id: 3, alternative1EmployeeId: 1 },
  ]);
  assert.deepEqual(availableCover(ring, 1, () => true), [], "everybody away answers nobody, and answers it");
  assert.deepEqual(availableCover(ring, 1, (id) => id !== 3), [3]);
  // Every one of them is covered on a day they alone are away.
  assert.deepEqual(availableCover(ring, 1, (id) => id === 1), [2]);
  assert.deepEqual(availableCover(ring, 2, (id) => id === 2), [3]);
  assert.deepEqual(availableCover(ring, 3, (id) => id === 3), [1]);
});

/* ------------------------------------------------------------------ where cover is resolved */

const fs = require("node:fs");
const path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");

test("no save path judges the shape of the alternatives graph", () => {
  // The pair rule is gone from both the create and the edit path. `alternativesProblem` stays -
  // naming yourself and filling both slots with one person are faults in a single row, not shapes.
  const controller = read("modules/hrm/employees/controller.js");
  assert.doesNotMatch(controller, /alternativeCycleProblem|cycleThrough|forbiddenAlternatives|chainWithProposed/);
  assert.match(controller, /alternativesProblem\(/, "the two single-row checks went with it");
});

test("the sheet import routes a rule's leads through the cover chain", () => {
  const service = read("modules/sales/crm-leads/googleSheetsService.js");
  assert.match(service, /buildCoverResolver\(await loadCoverContext\(\)\)/, "the sync no longer resolves cover");
  // Loaded once for the pass. "Who is away today" is one answer for the whole sheet, and asking it
  // per row would cost more than the import.
  const prepare = service.slice(
    service.indexOf("async function prepareGoogleSheetCrmImport("),
    service.indexOf("async function runGoogleSheetLinkSync("),
  );
  assert.match(prepare, /buildCoverResolver/, "cover is resolved outside the one-pass setup");
});
