import test from "node:test";
import assert from "node:assert/strict";

import {
  MINIMUM_EMPLOYEE_AGE,
  ageInYears,
  childrenErrors,
  dateOfBirthError,
  filledChildren,
  latestDateOfBirth,
  pastDateError,
} from "../src/constants/fieldValidation.js";
import { detailListErrors, filledDetailRows } from "../src/constants/employeeDetailFields.js";

/*
 * The two rules the public onboarding form and the HR employee form now share.
 *
 * They are one module because both screens have to agree: a candidate who passes the apply page
 * and then fails the employee form is a submission HR cannot save, and a submission HR *can* save
 * that the apply page would have refused is the rule not existing at all.
 */

/** A date of birth exactly `years` and `days` old today, as the key a date field holds. */
function birthdayAgo(years, days = 0) {
  const today = new Date();
  const date = new Date(today.getFullYear() - years, today.getMonth(), today.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("an empty date of birth passes: whether it is required is a separate question", () => {
  assert.equal(dateOfBirthError(""), "");
  assert.equal(dateOfBirthError(null), "");
  assert.equal(dateOfBirthError(undefined), "");
});

test("somebody comfortably over eighteen is accepted", () => {
  assert.equal(dateOfBirthError(birthdayAgo(30)), "");
  assert.equal(dateOfBirthError(birthdayAgo(MINIMUM_EMPLOYEE_AGE, 1)), "");
});

test("the eighteenth birthday itself is old enough — the day before it is not", () => {
  assert.equal(dateOfBirthError(birthdayAgo(MINIMUM_EMPLOYEE_AGE)), "");
  const tooYoung = dateOfBirthError(birthdayAgo(MINIMUM_EMPLOYEE_AGE, -1));
  assert.match(tooYoung, /at least 18 years old/);
});

test("a seventeen-year-old is refused, and told how old the date makes them", () => {
  const message = dateOfBirthError(birthdayAgo(17));
  assert.match(message, /at least 18 years old/);
  assert.match(message, /17/);
});

test("a date of birth in the future is refused as a future date, not as an age", () => {
  const tomorrow = birthdayAgo(0, -1);
  assert.match(dateOfBirthError(tomorrow), /cannot be in the future/);
});

test("the calendar's last selectable day is exactly the eighteenth-birthday boundary", () => {
  assert.equal(latestDateOfBirth(), birthdayAgo(MINIMUM_EMPLOYEE_AGE));
  // Anything the calendar still offers passes the check behind it, or the two disagree on screen.
  assert.equal(dateOfBirthError(latestDateOfBirth()), "");
});

test("ages are counted in whole years, and a birthday still to come this year does not count", () => {
  assert.equal(ageInYears(birthdayAgo(25)), 25);
  assert.equal(ageInYears(birthdayAgo(25, -1)), 24);
  assert.equal(ageInYears(""), null);
});

test("a child's date of birth may not be in the future", () => {
  assert.equal(pastDateError(birthdayAgo(3), "Date of Birth"), "");
  assert.match(pastDateError(birthdayAgo(0, -1), "Date of Birth"), /cannot be in the future/);
});

test("an entirely blank child row is not a complaint — it is a row nobody filled in", () => {
  assert.deepEqual(childrenErrors([{ name: "", dateOfBirth: "" }]), {});
  assert.deepEqual(childrenErrors([]), {});
  assert.deepEqual(childrenErrors(undefined), {});
});

test("a half-filled child row is named on the half that is missing", () => {
  assert.deepEqual(childrenErrors([{ name: "Meera", dateOfBirth: "" }]), { 0: { dateOfBirth: "Required" } });
  assert.deepEqual(childrenErrors([{ name: "", dateOfBirth: birthdayAgo(4) }]), { 0: { name: "Required" } });
});

test("problems are keyed by the row they belong to, so each is shown on its own child", () => {
  const problems = childrenErrors([
    { name: "Meera", dateOfBirth: birthdayAgo(6) },
    { name: "", dateOfBirth: "" },
    { name: "Arun", dateOfBirth: birthdayAgo(0, -1) },
  ]);
  assert.deepEqual(Object.keys(problems), ["2"]);
  assert.match(problems[2].dateOfBirth, /cannot be in the future/);
});

test("the blank rows an Add Child click leaves behind are dropped rather than saved", () => {
  const saved = filledChildren([
    { key: "child-1", name: " Meera ", dateOfBirth: "2019-04-02" },
    { key: "child-2", name: "", dateOfBirth: "" },
  ]);
  // Trimmed, and without the key the field uses to tell one row from another.
  assert.deepEqual(saved, [{ name: "Meera", dateOfBirth: "2019-04-02" }]);
});

/*
 * ── The qualification and experience lists ────────────────────────────────────────────────────
 *
 * Both are the same machinery the children list uses, configured differently, so what is worth
 * testing is the configuration: which cell makes a row worth keeping, and what each list refuses.
 */

test("a qualification row is anchored on the degree — the rest is context for it", () => {
  assert.deepEqual(detailListErrors("qualifications", [{ degree: "B.Sc", branch: "Visual Communication" }]), {});
  // A college with no qualification against it records nothing, so the degree is asked for.
  assert.deepEqual(detailListErrors("qualifications", [{ college: "PSG", degree: "" }]), { 0: { degree: "Required" } });
});

test("a qualification row nobody touched is dropped rather than complained about", () => {
  assert.deepEqual(detailListErrors("qualifications", [{ degree: "", branch: "", college: "", passedOutYear: "" }]), {});
  assert.deepEqual(filledDetailRows("qualifications", [{ degree: "", branch: "", college: "", passedOutYear: "" }]), []);
});

test("a passing-out year must be four digits inside a sensible range", () => {
  assert.deepEqual(detailListErrors("qualifications", [{ degree: "B.Sc", passedOutYear: "2019" }]), {});
  assert.match(detailListErrors("qualifications", [{ degree: "B.Sc", passedOutYear: "19" }])[0].passedOutYear, /four digits/);
  assert.match(detailListErrors("qualifications", [{ degree: "B.Sc", passedOutYear: "1830" }])[0].passedOutYear, /between 1950/);
  // Somebody part way through a course can still name the year they will finish.
  const nextYear = String(new Date().getFullYear() + 1);
  assert.deepEqual(detailListErrors("qualifications", [{ degree: "B.Sc", passedOutYear: nextYear }]), {});
});

test("an experience row is anchored on the company, and everything else is optional", () => {
  assert.deepEqual(detailListErrors("experiences", [{ companyName: "Studio 9" }]), {});
  assert.deepEqual(detailListErrors("experiences", [{ companyName: "", role: "Editor" }]), { 0: { companyName: "Required" } });
});

test("years of experience must be a number the studio could believe", () => {
  assert.deepEqual(detailListErrors("experiences", [{ companyName: "Studio 9", years: "2.5" }]), {});
  assert.match(detailListErrors("experiences", [{ companyName: "Studio 9", years: "90" }])[0].years, /between 0 and 60/);
});

test("an attachment alone counts as a started row, so the company is still asked for", () => {
  const problems = detailListErrors("experiences", [{ companyName: "", attachment: [{ name: "letter.pdf", data: "data:application/pdf;base64,AA==" }] }]);
  assert.deepEqual(problems, { 0: { companyName: "Required" } });
});

test("rows are stored without the keys the field tells them apart by, and blanks are dropped", () => {
  const saved = filledDetailRows("experiences", [
    { key: "row-1", companyName: " Studio 9 ", companyLocation: "Erode", role: "Editor", years: "3", attachment: [] },
    { key: "row-2", companyName: "", companyLocation: "", role: "", years: "", attachment: [] },
  ]);
  assert.deepEqual(saved, [{ companyName: "Studio 9", companyLocation: "Erode", role: "Editor", years: "3", attachment: [] }]);
});
