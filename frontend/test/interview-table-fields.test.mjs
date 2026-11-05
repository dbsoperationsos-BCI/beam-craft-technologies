import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  candidateTableFields,
  candidateDefaultHiddenColumns,
  candidateInfoSections,
} from "../src/constants/interviewConfig.js";

/*
 * Every field the studio asks a candidate for has a column, and the register opens on the ones it
 * is actually read for.
 *
 * Written as the studio's own list rather than as the keys, because that is how the gap was found:
 * WhatsApp Number and Address were on the record and on the info panel and had simply never been
 * offered as columns, which no test keyed on the config could notice.
 */

const COLUMN_FOR = {
  "Candidate Name": "name",
  Phone: "phone",
  Email: "email",
  "WhatsApp Number": "whatsappNumber",
  "Position Applied For": "position",
  Department: "department",
  "Employment Type": "employmentType",
  Experience: "experience",
  "Current Company": "currentCompany",
  "Current Designation": "currentDesignation",
  "Current CTC": "currentCtc",
  "How They Know Us": "howYouKnowUs",
  "What They Know About Us": "aboutUs",
  "Least Expected CTC": "minExpectedCtc",
  "Expected CTC": "expectedCtc",
  "Notice Period": "noticePeriod",
  "Available From": "availableFrom",
  "Highest Qualification": "highestQualification",
  Skills: "skills",
  "Languages Known": "languagesKnown",
  Gender: "gender",
  "Date of Birth": "dateOfBirth",
  City: "city",
  "Native Place": "nativePlace",
  "Current Location": "currentLocation",
  State: "state",
  Address: "address",
  Branch: "branch",
  Source: "source",
  "Campaign Name": "campaignName",
  "Adset Name": "adsetName",
  "Ad Name": "adName",
  "Referred By": "referredBy",
  Status: "status",
  Interviewer: "interviewer",
  "Interview Scheduled On": "interviewDate",
  "Interview Time": "interviewTime",
  "Interview Mode": "interviewMode",
  "Meet Link": "meetLink",
  "Applied On": "appliedDate",
  "Next Follow-up Date": "nextFollowUpDate",
  "Portfolio Link": "portfolioUrl",
  "Resume Link": "resumeUrl",
  Remarks: "remarks",
};

const keys = new Set(candidateTableFields.map(([key]) => key));
const typeOf = new Map(candidateTableFields.map(([key, , type]) => [key, type]));
const hidden = new Set(candidateDefaultHiddenColumns);

test("every field the studio asks for has a column", () => {
  const missing = Object.entries(COLUMN_FOR).filter(([, key]) => !keys.has(key)).map(([label]) => label);
  assert.deepEqual(missing, [], `no column for: ${missing.join(", ")}`);
});

test("Remarks opens with the table rather than hiding behind Manage Columns", () => {
  // HR's running note on the person, which is the one thing somebody scans this register for.
  assert.ok(keys.has("remarks"), "the Remarks column is gone");
  assert.ok(!hidden.has("remarks"), "Remarks is hidden by default again");
});

test("Remarks is on the record a double-click opens", () => {
  const onRecord = candidateInfoSections.flatMap((section) => section.fields.map(([key]) => key));
  assert.ok(onRecord.includes("remarks"), "the full record no longer shows Remarks");
});

test("a day is never offered as a dropdown to pick from", () => {
  /*
   * These columns carried no type at all, so a page holding fewer than forty distinct dates was
   * offered a **menu of days to tick** - where what anybody wants is to type one. `day` is the type
   * that says so; it also leaves the value exactly as the register wrote it, which `date` would
   * not: reformatting through `new Date()` is how a day west of Greenwich becomes the day before.
   */
  for (const key of ["appliedDate", "availableFrom", "interviewDate", "dateOfBirth", "lastFollowUpDate", "nextFollowUpDate"]) {
    assert.equal(typeOf.get(key), "day", `${key} is not a day, so its filter is a dropdown`);
  }
});

test("the résumé column reads as Resume", () => {
  const [, header] = candidateTableFields.find(([key]) => key === "resumeUrl");
  assert.equal(header, "Resume");
  const background = candidateInfoSections.find((section) => section.title === "Background");
  assert.equal(background.fields.find(([key]) => key === "resumeUrl")[1], "Resume");
});

test("Remarks reads above Application on the record", () => {
  /*
   * What follows Remarks is provenance - which ad brought the candidate in, when they applied, when
   * the row was created - read when somebody is checking where a candidate came from. The remarks
   * are read every time the record is opened, so they sit with the sections about the person rather
   * than below the ones about the paperwork.
   *
   * The same list draws the info panel beside the table and the record a double-click opens, so
   * they cannot disagree about the order.
   */
  const order = candidateInfoSections.map((section) => section.title);
  assert.ok(order.indexOf("Remarks") < order.indexOf("Application"), `Remarks is below Application: ${order.join(" → ")}`);
  // And still its own heading, apart from the candidate's own words about the studio: reading HR's
  // note and the candidate's answer under one heading loses which is which.
  assert.ok(order.includes("In Their Words"));
  assert.notEqual(order.indexOf("Remarks"), order.indexOf("In Their Words"));
});

test("a candidate waiting on their form can be moved to Form Submitted by hand", () => {
  /*
   * The screening form is one way answers arrive, not the only one: a candidate replies on
   * WhatsApp, emails a CV, or reads the questions out over the phone. Until now that row stayed at
   * Form Submission Pending until the link itself was used, so somebody the studio had already
   * heard from sat on a tab meaning "waiting on them".
   *
   * No Why dialog - that is for Selected, On Hold and Rejected, which are decisions somebody has to
   * answer for. This is a stage moving forward, so it goes straight through, as sending an
   * onboarding invite does.
   */
  const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "InterviewPage.js"), "utf8");
  assert.match(PAGE, /const markFormSubmitted = useCallback\(/, "there is no way to end the wait by hand");
  assert.match(PAGE, /setCandidateStatus\(candidate\.id, FORM_SUBMITTED_STATUS\)/, "the move does not set the stage, or asks for a reason it should not");
  assert.doesNotMatch(PAGE, /setDecision\(\{ candidate, status: FORM_SUBMITTED_STATUS \}\)/, "a stage moving forward is being put behind the Why dialog");

  // On the waiting row, and only there: every other stage is already past it or before it.
  const WAITING_START = "] : waiting ? [";
  const PLAIN_START = "// Every other stage: the plain menu";
  const waiting = PAGE.slice(PAGE.indexOf(WAITING_START), PAGE.indexOf(PLAIN_START));
  assert.ok(waiting.includes('label: "Mark Form Submitted"'), "the entry is not on the row that is waiting");
  assert.equal(PAGE.split('label: "Mark Form Submitted"').length - 1, 1, "the entry is repeated on stages it does not belong to");

  /*
   * The form is left exactly as it is. A live link still works and the candidate can still use it;
   * Cancel Form is the entry for calling it off, and doing that silently here would take the
   * decision away from whoever is looking at the row.
   */
  const handler = PAGE.slice(PAGE.indexOf("const markFormSubmitted = useCallback("), PAGE.indexOf("const copyInviteLink = useCallback("));
  assert.doesNotMatch(handler, /cancelInvite|setPendingCancelInvite/, "moving the stage quietly cancels the form as well");
});
