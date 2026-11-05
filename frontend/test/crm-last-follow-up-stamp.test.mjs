import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Last Follow-up Date is stamped by the Update buttons, and by nothing else.
 *
 * The column means "the day somebody last worked this lead". The honest moment to write it is the
 * moment somebody says they have finished with it - **CNA and Proceed Next**, **Update and Close**,
 * **Update and Proceed Next** - because pressing one of those is a person saying they dealt with
 * this lead today.
 *
 * The half that is easy to lose is the other one: **a posted remark must not stamp it.** A remark
 * saves itself the instant it is written, and it is very often written while reading a lead nobody
 * is working - skimming a thread, noting something off a call that came in elsewhere, fixing a typo
 * in yesterday's note. If that stamped the date, the Last Followup Date column and the Pending
 * Followups tabs would fill up with days nobody rang anybody, which is worse than an empty column
 * because it reads as true.
 *
 * Both are checked here against the source, because the two live in different places: the stamp is
 * one shared helper, and the "no stamp" is the *absence* of a call in three other save paths - and
 * an absence is exactly the kind of thing a later edit restores without anyone noticing.
 */

const PAGE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
  "utf8",
);

/** One top-level declaration, from its opening line to the line that closes it. */
function declaration(opening, closing) {
  const start = PAGE.indexOf(opening);
  assert.notEqual(start, -1, `${opening} was not found in CRMPage.js`);
  const end = PAGE.indexOf(closing, start);
  assert.notEqual(end, -1, `the end of ${opening} was not found`);
  return PAGE.slice(start, end + closing.length);
}

const source = [
  declaration("function getLocalDateKey(", "\n}"),
  declaration("const leadWorkedTodayPatch =", ";"),
].join("\n\n");

const { leadWorkedTodayPatch, getLocalDateKey } = new Function(
  `${source}\nreturn { leadWorkedTodayPatch, getLocalDateKey };`,
)();

test("the stamp is today, as the studio's own day key", () => {
  const patch = leadWorkedTodayPatch();
  assert.deepEqual(Object.keys(patch), ["lastFollowUpDate"], "it writes one field and no others");
  assert.equal(patch.lastFollowUpDate, getLocalDateKey());
  // The shape every other date in this module is stored in, so the column, its filter and the
  // generated day columns behind the board all read it.
  assert.match(patch.lastFollowUpDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("it is the local day, not a UTC one", () => {
  /*
   * `toISOString().slice(0,10)` would be a different day for most of an Indian evening - a lead
   * worked at 9pm IST would be stamped tomorrow. `getLocalDateKey` reads the local parts instead.
   */
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  assert.equal(leadWorkedTodayPatch().lastFollowUpDate, expected);
});

/** The body of a named function in the page, so a save path can be read on its own. */
function functionBody(opening) {
  const start = PAGE.indexOf(opening);
  assert.notEqual(start, -1, `${opening} was not found`);
  const end = PAGE.indexOf("\n  }\n", start);
  assert.notEqual(end, -1, `the end of ${opening} was not found`);
  return PAGE.slice(start, end);
}

/*
 * Both hosts of the lead popup. The popup itself is one component, but it is rendered twice - from
 * the board and from the Contacts panel - and each host brings its own save, which is how a rule
 * applied to one of them and not the other gets shipped.
 */
test("both of the popup's save paths stamp it", () => {
  for (const opening of ["async function save(closeAfter = false", "async function savePopupLead(closeAfter = false"]) {
    assert.match(
      functionBody(opening),
      /\.\.\.leadWorkedTodayPatch\(\),/,
      `${opening} no longer stamps Last Follow-up Date`,
    );
  }
  // Exactly the two - a third caller would mean somewhere else is claiming a lead was worked.
  assert.equal(PAGE.match(/\.\.\.leadWorkedTodayPatch\(\),/g)?.length, 2);
});

test("the stamp is written after the spread it has to beat", () => {
  /*
   * A lead arrives carrying whatever Last Follow-up Date it was last saved with, and both payloads
   * begin by spreading that in. Stamped before the spread, today's date would be overwritten by the
   * lead's own older one and the press would appear to do nothing.
   */
  for (const opening of ["async function save(closeAfter = false", "async function savePopupLead(closeAfter = false"]) {
    const body = functionBody(opening);
    const spread = body.search(/remarks: remarkSummary\(/);
    const stamp = body.search(/\.\.\.leadWorkedTodayPatch\(\)/);
    assert.ok(spread !== -1 && stamp !== -1, opening);
    assert.ok(stamp > spread, `${opening} stamps the date before the payload it must override`);
  }
});

/*
 * ── The absence that matters ──────────────────────────────────────────────────────────────────
 *
 * A remark posts its own save the moment it is written. These are the paths that do it, and none of
 * them may stamp the date - see the note at the top of this file for why.
 */
test("a posted remark does not stamp it", () => {
  for (const opening of ["function updateRemarks(nextEntries, {", "function updateRemarksEntries(id, nextEntries, {"]) {
    assert.doesNotMatch(
      functionBody(opening),
      /leadWorkedTodayPatch|lastFollowUpDate/,
      `${opening} is stamping Last Follow-up Date - a note written is not a lead worked`,
    );
  }
});

test("the info panel's own Update does not stamp it either", () => {
  /*
   * Deliberately out of scope: the request named the popup's three buttons. The info panel beside
   * the table has its own Update and Next, and it is left alone rather than quietly given the same
   * behaviour - if the studio wants it too, that is a decision to make on purpose.
   */
  assert.doesNotMatch(
    functionBody("async function updateSelectedLeadAndAdvance()"),
    /leadWorkedTodayPatch|lastFollowUpDate/,
    "the info panel's Update now stamps the date - was that intended?",
  );
});
