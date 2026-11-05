import test from "node:test";
import assert from "node:assert/strict";

import { candidateScheduleSections, candidateInfoSections, candidateTableFields, emptyCandidateValues } from "../src/constants/interviewConfig.js";

/*
 * Last Follow-up is shown, and no longer asked for.
 *
 * It was a date box on the Schedule Interview form - the same list all three of its modes draw,
 * Schedule, Schedule Next Round and Edit Schedule - which asked HR to tell the register something
 * the register already knew, and which had to be *remembered*: the column means "the day somebody
 * last worked this candidate", so one nobody updated said the opposite of the truth rather than
 * nothing at all. The server stamps it from the act of saving now.
 *
 * Shown is the other half. Taking the box away must not take the answer away - reading when somebody
 * was last worked is the whole use of the column.
 */

const asked = candidateScheduleSections.flatMap((section) => section.fields.map((field) => field.name));

test("the schedule and edit interview form no longer asks for a last follow-up", () => {
  assert.equal(asked.includes("lastFollowUpDate"), false, "the form still asks for a last follow-up");
});

test("the next follow-up is still asked, because only a person can decide it", () => {
  /*
   * The two point in opposite directions and that is the whole distinction: the last one is a fact
   * the application can observe by watching itself being used, and the next one is a decision
   * nothing but a person can make. Removing both would have been the easy mistake.
   */
  assert.ok(asked.includes("nextFollowUpDate"), "the form should still ask when to follow up next");
});

test("it is still shown on the register's table and on the info panel", () => {
  assert.ok(candidateTableFields.some(([key]) => key === "lastFollowUpDate"), "the table lost the column");
  const onPanel = candidateInfoSections.flatMap((section) => section.fields.map(([key]) => key));
  assert.ok(onPanel.includes("lastFollowUpDate"), "the info panel lost the field");
});

test("the record's own form still carries the key, so a save there cannot blank the column", () => {
  /*
   * `PUT /candidates/:id` is **not partial** - it writes every column it is given a key for - and the
   * record panel sends the whole record. So the key has to stay in the form's values even though no
   * box draws it: dropping it would post nothing for the column and blank what is on the record on
   * the very first save. The server writes its own value over whatever arrives.
   *
   * The schedule dialog no longer comes into this: it posts to `/candidates/:id/schedule`, which is
   * partial and writes only the round, the stage and the follow-up - so there is nothing there to
   * blank in the first place.
   */
  assert.ok("lastFollowUpDate" in emptyCandidateValues(), "the key would not be sent, and the column would be blanked");
});
