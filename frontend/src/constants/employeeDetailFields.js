/**
 * The three repeating lists an employee record carries — their children, what they studied, and
 * where they have worked — described once for `RepeatableDetailsField` to draw.
 *
 * One description each, shared by the public onboarding form and the HR employee form, for the
 * reason `employeeOptions` is shared: a candidate answers these on the apply page and HR edits the
 * same answers on the record afterwards, so the two screens have to ask for exactly the same things
 * or a submission becomes a record HR cannot save.
 *
 * Each list carries its own `rules` beside the fields they judge, so the rule and the form it
 * applies to cannot drift apart, and `detailListErrors` / `filledDetailRows` are the two calls a
 * form makes — validate the list, then keep the rows worth storing.
 */

// Extension included, the way `modulePermissions` and the `lib` helpers import their neighbours:
// this module is unit tested by `node --test`, which resolves ESM without the bundler's guessing.
import { detailRowErrors, filledRows, pastDateError, todayKey } from "./fieldValidation.js";

/** The earliest year worth accepting as a passing-out year, and how far ahead one may be claimed. */
const EARLIEST_PASSING_YEAR = 1950;
const YEARS_AHEAD = 6;

const digits = (max) => (value) => String(value ?? "").replace(/\D/g, "").slice(0, max);

/* ── Children ──────────────────────────────────────────────────────────────────────────────── */

const childFields = [
  { name: "name", label: "Name", required: true, props: { placeholder: "Full name" } },
  // A child cannot be born tomorrow, and the calendar says so by not offering it.
  { name: "dateOfBirth", label: "Date of Birth", type: "date", required: true, props: () => ({ restriction: "future", maxDate: todayKey() }) },
];

/* ── Qualifications ────────────────────────────────────────────────────────────────────────── */

/**
 * The degree leads because it is what somebody says first and what makes the row worth keeping — a
 * college with no qualification against it records nothing. The institution takes the full width
 * under the pair, a college name being the longest thing on the row by some way.
 */
const qualificationFields = [
  { name: "degree", label: "Degree", required: true, props: { placeholder: "B.Sc, B.E, Diploma, HSC…" } },
  { name: "branch", label: "Branch / Specialisation", props: { placeholder: "Visual Communication" } },
  { name: "college", label: "College / School", colSpan: 2, props: { placeholder: "Institution name" } },
  { name: "passedOutYear", label: "Passed Out Year", normalize: digits(4), props: { inputMode: "numeric", maxLength: 4, placeholder: "2019" } },
];

/* ── Experience ────────────────────────────────────────────────────────────────────────────── */

/**
 * The company leads for the reason the degree does: it is what makes the row a job. The attachment
 * takes the full width at the bottom because it is a control rather than a field, and it holds one
 * file — the letter for *this* company, not a pile of documents for the whole career.
 */
const experienceFields = [
  { name: "companyName", label: "Company Name", required: true, props: { placeholder: "Where you worked" } },
  { name: "companyLocation", label: "Company Location", props: { placeholder: "City and state" } },
  { name: "role", label: "Role", props: { placeholder: "The designation you held" } },
  { name: "years", label: "Years of Experience", normalize: (value) => String(value ?? "").replace(/[^\d.]/g, "").slice(0, 5), props: { inputMode: "decimal", placeholder: "2.5" } },
  {
    name: "attachment",
    label: "Attachment (experience or relieving letter)",
    type: "file",
    colSpan: 2,
    props: { maxFiles: 1, accept: ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" },
  },
];

/* ── The three lists ───────────────────────────────────────────────────────────────────────── */

export const employeeDetailLists = {
  children: {
    rules: {
      // Both halves are asked for once a row exists at all: a name with no date of birth is a
      // child somebody started adding and left.
      required: ["name", "dateOfBirth"],
      checks: { dateOfBirth: (value) => pastDateError(value, "Date of Birth") },
    },
    props: {
      fields: childFields,
      label: "Children Details",
      hint: "Add each child's name and date of birth. Leave this empty if it does not apply.",
      addLabel: "+ Add Child",
      emptyText: "No children added.",
      rowLabel: (index) => `Child ${index + 1}`,
    },
  },
  qualifications: {
    rules: {
      required: ["degree"],
      checks: {
        passedOutYear: (value) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "";
          if (!/^\d{4}$/.test(raw)) return "Enter the year as four digits, for example 2019.";
          const latest = new Date().getFullYear() + YEARS_AHEAD;
          return Number(raw) < EARLIEST_PASSING_YEAR || Number(raw) > latest ? `Enter a year between ${EARLIEST_PASSING_YEAR} and ${latest}.` : "";
        },
      },
    },
    props: {
      fields: qualificationFields,
      label: "Qualification Details",
      hint: "Add each qualification — school, diploma, degree — with the institution and the year it was completed.",
      addLabel: "+ Add Qualification",
      emptyText: "No qualifications added.",
      rowLabel: (index) => `Qualification ${index + 1}`,
    },
  },
  experiences: {
    rules: {
      required: ["companyName"],
      checks: {
        years: (value) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "";
          const years = Number(raw);
          if (!Number.isFinite(years)) return "Enter the years as a number, for example 2.5.";
          return years < 0 || years > 60 ? "Enter between 0 and 60 years." : "";
        },
      },
    },
    props: {
      fields: experienceFields,
      label: "Experience Details",
      hint: "Add each company you have worked at, with the role and how long. Attach the experience or relieving letter where you have one. Leave this empty if you are a fresher.",
      addLabel: "+ Add Experience",
      emptyText: "No experience added — leave this empty if you are a fresher.",
      rowLabel: (index) => `Experience ${index + 1}`,
    },
  },
};

/** Every list's field names, which is what decides whether a row is blank and what is kept of it. */
export const detailListFieldNames = Object.fromEntries(
  Object.entries(employeeDetailLists).map(([name, list]) => [name, list.props.fields.map((field) => field.name)]),
);

/** Every problem with one list, keyed by row — the shape `RepeatableDetailsField` draws from. */
export const detailListErrors = (name, rows) => detailRowErrors(rows, employeeDetailLists[name].rules, detailListFieldNames[name]);

/** The rows of one list worth storing, without the keys the field tells rows apart by. */
export const filledDetailRows = (name, rows) => filledRows(rows, detailListFieldNames[name]);
