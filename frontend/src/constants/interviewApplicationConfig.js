/**
 * The public application form a candidate fills in from their link, described as sections of fields
 * for the shared schema-form inputs to draw.
 *
 * The onboarding form's own shape (`onboardingFormConfig.js`), asked of somebody who has not been
 * taken on: what they are applying for, who they are, what they have done, and the two lists that
 * are the whole of a CV - what they studied and where they have worked. It deliberately does not
 * ask what the onboarding form asks, and the difference is the point: an applicant is not asked for
 * their Aadhaar, their PAN, their bank details, their family or an emergency contact. None of that
 * is anybody's business until an offer is made, and the onboarding form is where it is collected.
 *
 * The order runs from what the candidate knows without looking anything up to what they have to
 * fetch a document for.
 */

// Explicit extensions: this module is read directly by the tests, which resolve as plain Node ESM
// rather than through the bundler.
import { latestDateOfBirth } from "./fieldValidation.js";

/*
 * Identity-free normalisers: only the two numbers, held to the shape the register keeps them in.
 *
 * A backstop now rather than the rule. `PhoneField` draws both numbers and emits `+91 9876543210`
 * with the digits already stripped, which these pass through untouched; they stay because the form
 * state is also written from the prefill, which carries whatever the register holds.
 */
export const applicationFieldNormalizers = {
  contactNumber: (value) => String(value || "").replace(/[^\d+\s-]/g, "").slice(0, 20),
  whatsappNumber: (value) => String(value || "").replace(/[^\d+\s-]/g, "").slice(0, 20),
};

/**
 * The two answers to "fresher or experienced", named once so the form, the check and the payload
 * cannot drift. They are words rather than a flag because the register's Experience column is text,
 * and "Fresher" is what it already holds for somebody with nothing to list.
 */
export const FRESHER = "Fresher";
export const EXPERIENCED = "Experienced";
export const EXPERIENCE_LEVELS = [FRESHER, EXPERIENCED];

/**
 * How soon somebody can leave the job they are in, as the five answers worth telling apart.
 *
 * A closed list rather than the free-text box it was, because the answer is read to decide **when a
 * conversation is worth having** and free text made that a reading exercise: "1 month", "30 days",
 * "one month notice", "30days" and "1 mnth" are one answer typed five ways, and nothing could sort
 * or filter them. The bands are what the studio actually acts on.
 *
 * Fixed here rather than in Settings, the way `EXPERIENCE_LEVELS` is: these are the rungs of a
 * ladder, not a list the studio maintains, and the register's column takes whatever a sheet or a
 * CSV carries - so an imported "45-60 days" is still kept and shown, it is simply not offered here.
 */
export const NOTICE_PERIODS = ["Immediate", "Under 15 days", "Under 30 days", "Under 45 days", "60 days or more"];

/**
 * How many links the form takes. Named here because the form draws the boxes, the submit trims to
 * it and the server's own schema caps at the same number - three places that must agree.
 */
export const MAX_PORTFOLIO_LINKS = 3;

/**
 * How many files a candidate may attach besides the résumé. The server's own schema caps at the
 * same number, so the control stops before an upload rather than the submit refusing after one.
 */
export const MAX_ATTACHMENTS = 5;

/**
 * The two answers to "are you an immediate joiner?", and what Yes means on the register.
 *
 * Words rather than a boolean because `availableFrom` is a free-text column that already holds
 * either a day or a word - "Immediately", "15 days" - so Yes is written into it as `IMMEDIATE_JOIN`
 * and needs no column of its own, and a row that already said "Immediate" reads back as Yes.
 */
export const JOINS_IMMEDIATELY = "Yes";
export const JOINS_LATER = "No";
export const IMMEDIATE_JOINER_ANSWERS = [JOINS_IMMEDIATELY, JOINS_LATER];
export const IMMEDIATE_JOIN = "Immediate";

/**
 * What the Experience Details rows add up to, as the register's Experience column reads it.
 *
 * "" where no row states a span, which is honest rather than helpful: a row with a company and no
 * years says somebody worked there, not that they worked there for no time, and sending "0 years"
 * would put a wrong number on the record where a blank leaves HR to ask.
 */
export function totalExperienceFrom(rows = []) {
  const years = (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
    const value = Number(String(row?.years ?? "").trim());
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  if (!years) return "";
  // Rounded to one place, and without a trailing ".0": 2.5 years reads as itself, 3 as "3 years".
  const rounded = Math.round(years * 10) / 10;
  return `${rounded} ${rounded === 1 ? "year" : "years"}`;
}

/**
 * Whether the candidate has said they have worked before.
 *
 * One predicate, read by the fields that only apply then **and** by `missingApplicationFields`
 * through `requiredApplicationFields`, so a question that is not on screen can never be one the
 * submit refuses for. `EXPERIENCED` rather than "not Fresher": an unanswered question is neither,
 * and it should show the fresher's shorter form until somebody says otherwise.
 */
const isExperienced = (values) => values?.experienceLevel === EXPERIENCED;

/**
 * Whether to ask for a joining date: only once the candidate has said they cannot start now.
 *
 * `JOINS_LATER` rather than "not Yes", for the reason `isExperienced` tests the positive: an
 * unanswered question is neither answer, and it should ask nothing further until somebody says.
 */
const isNotImmediate = (values) => values?.immediateJoiner === JOINS_LATER;

/*
 * Why this section is ordered the way it is.
 *
 * The section is a two-column grid that fields flow into in order, so **a lone field leaves the one
 * after it in the other column**, and every pair below it is knocked out of step. That is what made
 * the screen look wrong rather than any field being in the wrong place: a fresher hid Total
 * Experience, so the joining question slid up beside the fresher question and its own Expected
 * Joining Date wrapped underneath a question it has nothing to do with, with Least Expected Salary
 * and Expected Salary - a pair, read together or not at all - split diagonally across the rows.
 *
 * Holding those cells open instead only traded the fault for a hole in the form. Two rules fix it
 * properly, and neither leaves a gap:
 *
 *   1. **Total Experience is drawn for everybody**, so the question at the head of the section
 *      always has a partner. It is a readout, not a question - the rows' sum, or the word "Fresher"
 *      - so a fresher sees what the register will record rather than a box asking anything again.
 *   2. **The two salaries sit above the joining question**, so the only remaining optional field,
 *      Expected Joining Date, falls beside the question that summons it rather than between a pair.
 *
 * What is left over in the answers that hide the most - a fresher who can start now - is the
 * joining question beside Skills, which is two unrelated boxes of the same size on one row, and
 * nothing that has to be read together is broken up.
 */

export const applicationFormSections = [
  {
    id: "position",
    title: "The Role",
    fields: [
      /*
       * Filled in from the invite and still editable: HR raised the form naming a position, and a
       * candidate applying for something else should be able to say so rather than being held to
       * what was typed for them.
       */
      { name: "position", label: "Position Applied For", required: true, props: { placeholder: "e.g. Wedding Photographer" } },
      /*
       * No Department. It was asked as "where you would be working, if you know", which is a
       * question a candidate cannot answer about a studio they have not joined - so it came back
       * blank, guessed, or as the name of a team that does not exist. Which department a hire lands
       * in is the studio's answer, set on the record and filled by a sheet or a CSV, and the form
       * no longer sends it at all, so a blank one cannot wipe what HR put there.
       */
      { name: "employmentType", label: "Applying As", type: "select", options: "employmentTypes", placeholder: "Select", props: { sorted: false } },
      /*
       * No Available From. When somebody can start is a **conversation**, not a date typed into a
       * form before anybody has spoken to them: the honest answers are "immediately", "after my
       * notice period" and "once my exams finish", and a date picker takes none of them. What it
       * did take was a guess, which then sat on the register as though the candidate had committed
       * to it. Notice Period below is the part of that question worth asking at this stage, and it
       * is asked as free text of somebody who actually has one. The register keeps its When Can You
       * Join column, filled by HR, by a sheet or by a CSV - the form no longer sends the key at
       * all, so a blank one cannot wipe what HR put there.
       */
    ],
  },
  {
    id: "about-you",
    title: "About You",
    fields: [
      { name: "firstName", label: "First Name", required: true },
      { name: "lastName", label: "Last Name" },
      { name: "gender", label: "Gender", type: "select", options: "genders", placeholder: "Select" },
      // Nobody under eighteen can be taken on, so the calendar does not offer those days. `props`
      // is read at render time rather than at import, so a tab left open overnight does not keep
      // yesterday's boundary - the same arrangement the onboarding form's own field uses.
      { name: "dateOfBirth", label: "Date of Birth", type: "date", props: () => ({ restriction: "future", maxDate: latestDateOfBirth() }) },
      /*
       * The application's own phone control, not a text box: a country picker beside a field that
       * takes digits only, on a numeric keypad, held to the national length of the code chosen. It
       * was a plain box here and nowhere else in the application, which is how a candidate typing
       * "9876 500 000 (whatsapp)" got a number the register could not match them by.
       */
      { name: "contactNumber", label: "Phone", type: "phone", required: true },
      { name: "whatsappNumber", label: "WhatsApp Number", type: "phone" },
      { name: "emailId", label: "Email", required: true, type: "text" },
      { name: "city", label: "City" },
      /*
       * Where they are **from**, and where they are **now**.
       *
       * These replace a **State** and a postal **Address**, neither of which answered the question a
       * studio actually asks about somebody it is considering: a state is too coarse to say whether
       * they can be on the floor on Saturday, and a full address is more than a studio should hold
       * about a person it has not hired - and asking for it on a first form is the kind of question
       * that makes a candidate close the tab.
       *
       * "Native Place" is the studio's own word for it and is what the question reads as here.
       * Both are ordinary one-line boxes: an answer is a town, sometimes a district, and a textarea
       * would invite the paragraph that Address used to collect.
       *
       * `state` and `address` are **not** merely hidden - they are gone from the payload and the
       * schema too, because the submission writes partially and an empty key would wipe whatever a
       * linked sheet or the CSV import put on the record. Both stay on the record for HR to read.
       */
      { name: "nativePlace", label: "Native Place", props: { placeholder: "Madurai" } },
      { name: "currentLocation", label: "Current Location", props: { placeholder: "Chennai" } },
      /*
       * What the candidate studied, asked here rather than in a section of its own.
       *
       * Education is part of **who somebody is**, and it is the one part of a CV every candidate
       * has an answer to - a fresher most of all, for whom it is the whole application. It used to
       * sit at the very bottom in a combined "Education & Work History" section, below the salary
       * and notice-period questions, which put a fresher's strongest answer last and behind
       * questions that do not apply to them.
       *
       * A `custom` field drawn by the form's `qualifications` renderer, which is how the onboarding
       * form carries the same list: rows rather than a box, so it flows in section order with
       * everything else instead of needing a section built around it.
       */
      { name: "qualifications", label: "Qualification Details", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "experience",
    title: "Experience & Expectations",
    fields: [
      /*
       * Fresher or experienced, asked **before** the work history below and answered with one tap.
       *
       * It replaces a **Total Experience** box, which asked a candidate to state a number they then
       * stated again row by row in Experience Details - two answers to one question, free to
       * disagree, and the studio had no way to tell which was meant. The total is now added up from
       * the rows themselves and shown back beside them, and a fresher is not asked for rows at all.
       *
       * **Highest Qualification** went the same way: it was a box beside a Qualifications list that
       * asks for every qualification with its own marks and year, so it was the same answer typed
       * twice, in a shorter form, with nothing to say which the studio should believe.
       */
      { name: "experienceLevel", label: "Are you a fresher or experienced?", type: "select", required: true, options: "experienceLevels", placeholder: "Select" },
      /*
       * The work history, asked **immediately under the question that branches on it**.
       *
       * Answering "Experienced" and then being shown nothing is a form that has taken an answer and
       * done nothing with it: the rows were at the bottom of the page in a section of their own, so
       * the question and the only thing it changes were a screen apart, and a candidate could tap
       * Experienced, scroll past four salary boxes and reach the submit button without ever seeing
       * the list they were meant to fill. It is now the next thing on screen.
       *
       * A fresher is shown no list at all - answering Fresher *is* the answer to it - and the total
       * is added up from these rows rather than asked for a second time in a box of its own.
       */
      /*
       * The rows' own sum, read back rather than asked for: a box somebody could type into would be
       * a second answer to a question already answered below, free to disagree with it.
       *
       * **Beside the question, not under the rows.** The grid is two columns from `md` up, so this
       * sits in the second one against "Are you a fresher or experienced?" - which is where the
       * answer belongs, because "Experienced" and "4.5 years" are one sentence. Under the list it
       * was a lone half-width box below a full-width block, reading as a question somebody had
       * forgotten to answer rather than as the total of what they just typed. It still fills in as
       * the rows below are typed, so the candidate watches the number the studio will read.
       */
      { name: "totalExperience", label: "Total Experience", type: "custom" },
      { name: "experiences", label: "Experience Details", type: "custom", colSpan: 2, when: isExperienced },
      /*
       * The four questions that presuppose a job, asked only of somebody who has said they have one.
       *
       * A fresher has no current company, no designation, no current salary and no notice to serve,
       * so each was a box they had to read, understand does not apply to them, and leave empty -
       * four times over, in the middle of the form. "Leave empty if you are not working" was the
       * placeholder admitting it. They are now simply absent until the answer above is Experienced,
       * and `missingApplicationFields` reads the same `when`, so nothing withheld is ever demanded.
       *
       * **Expected Salary stays for everybody**: a fresher has no current salary but does have an
       * expectation, and it is one of the few answers that changes whether a conversation is worth
       * having. It is the one field of the five that does not presuppose a job.
       */
      { name: "currentCompany", label: "Current Company", when: isExperienced },
      { name: "currentDesignation", label: "Current Designation", when: isExperienced },
      { name: "currentCtc", label: "Current Salary", when: isExperienced, props: { placeholder: "e.g. 3.5 LPA" } },
      { name: "noticePeriod", label: "Notice Period", type: "select", when: isExperienced, options: "noticePeriods", placeholder: "Select", props: { sorted: false } },
      /*
       * Two salary answers, and they are not the same question.
       *
       * **Expected Salary** is the opening ask; **Least Expected Salary** is the floor - the lowest
       * the candidate would actually take. The floor is the one that decides whether a conversation
       * is worth having at all, and HR was learning it on a call that a number here settles. Asked
       * of everybody, freshers included: a fresher has no *current* salary but has both of these.
       *
       * The floor is asked first, because it is the one that gets read.
       */
      { name: "minExpectedCtc", label: "Least Expected Salary", props: { placeholder: "e.g. 3 LPA" } },
      { name: "expectedCtc", label: "Expected Salary", props: { placeholder: "e.g. 5 LPA" } },
      /*
       * When they can start, asked as the question that actually has an answer.
       *
       * A bare date picker was taken off The Role for good reason - it made a candidate guess a day
       * before anybody had spoken to them, and the guess then sat on the register as a commitment.
       * The question underneath it is worth asking, though, and it is a **yes or no**: most people
       * either can start now or cannot, and only the second group has a date in mind at all.
       *
       * So: everybody answers Yes or No - a fresher between semesters has this answer as surely as
       * somebody serving notice - and only a No is asked for the day. Radio rather than a toggle
       * because a toggle has no unanswered state: it would default to "not immediate" and open the
       * date box under somebody who has not read the question yet.
       *
       * Neither of these is a new column. The register's `availableFrom` - "When Can You Join" - is
       * free text precisely because the answer is as often a word as a day, so Yes is stored as
       * "Immediate" and No stores the date. `immediateJoiner` is this form's branch, like
       * `experienceLevel`, and is never sent.
       *
       * Half a row rather than the full width: Yes and No are two small controls, and a bar the
       * width of the form around them is mostly empty space that pushes everything after it down a
       * row. At half it takes the column it needs and whatever comes next sits beside it - the
       * joining date when the answer is No, the salary floor when it is Yes.
       */
      {
        name: "immediateJoiner",
        label: "Are you an immediate joiner?",
        type: "radio",
        required: true,
        options: "immediateJoinerAnswers",
        /*
         * Drawn to the size of the boxes beside it, which is not what the shared radio defaults to.
         *
         * `RadioGroupField` is built for a group standing on its own - a legend at `text-sm` and a
         * 44px control - so dropped into a grid of text fields it read a size too large: a heavier,
         * bigger question than "Least Expected Salary" next to it, in a box visibly taller than the
         * inputs on its row. These are the values `WhatsappGroupNameDialog` already uses for the
         * same reason, so a radio sitting among fields looks the same in both places: the label
         * typography every other field's label has, and a control matching `TextField`'s own
         * `min-h-9`, `rounded-lg` and `mt-1.5`. The `!` beats the component's base classes, which a
         * plain utility of the same property would not reliably do.
         */
        props: {
          className: "text-[11px] font-semibold text-slate-600 sm:text-xs",
          controlClassName: "!mt-1.5 !min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-0",
        },
      },
      { name: "availableFrom", label: "Expected Joining Date", type: "date", when: isNotImmediate, props: { restriction: "past" } },
      /*
       * Both say **comma separated** in the label rather than only hinting it in the placeholder.
       *
       * A placeholder is gone the moment somebody types, so the one instruction that decides whether
       * an answer is readable afterwards disappeared exactly when it started mattering - and what
       * came back was "Photography and a bit of Lightroom, also Premiere", which no column can be
       * filtered or counted on. The example stays in the placeholder; the rule is in the label,
       * where it is still on screen while the box is being filled in.
       */
      { name: "skills", label: "Skills (comma separated)", props: { placeholder: "Photography, Lightroom, Premiere Pro" } },
      { name: "languagesKnown", label: "Languages Known (comma separated)", props: { placeholder: "Tamil, English" } },
      /*
       * A link rather than an upload, and asked of everybody: a photographer's or an editor's work
       * is the application, and a studio reads it before it reads anything else. The résumé below
       * is the file; this is the work.
       */
      /*
       * The candidate's own links, up to three.
       *
       * One box was one link, and a photographer or an editor applies with more than one - a
       * portfolio site, an Instagram, a Drive folder - so the other two went into Remarks or
       * nowhere. It starts as a single box with a plus beside it and grows a box at a time to
       * `MAX_PORTFOLIO_LINKS`, which is `RepeatableTextList`: one plain value per row rather than
       * the framed card `RepeatableDetailsField` draws, which is the right furniture for a
       * qualification and far too much for a URL.
       *
       * Three rather than unbounded because a link nobody opens is not evidence, and the register's
       * own Portfolio Link column takes the first of them - see the migration for why that column
       * stays.
       */
      { name: "portfolioLinks", label: "Portfolio / Links", type: "custom", colSpan: 2 },
      {
        name: "resume",
        label: "Resume",
        type: "file",
        colSpan: 2,
        props: { maxFiles: 1, accept: ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" },
      },
      /*
       * Everything else the candidate wants to send, beside the résumé rather than instead of it.
       *
       * One file was the whole of the form's appetite, so a certificate, an experience letter, an
       * award or a scanned portfolio either went into the portfolio link as a Drive folder or was
       * emailed separately and lost from the record. The résumé keeps a field of its own because it
       * is the one file every candidate has and the register shows it as its own column; these are
       * the rest, and they are optional.
       *
       * Same control and the same accepted types as the résumé above, up to `MAX_ATTACHMENTS`.
       * Uploaded to R2 by the shared `storeDocument`, exactly as the résumé is, and stored **as
       * they are**: the 5 MB-per-file cap is the guard rather than re-encoding, because compressing
       * a PDF or a scanned certificate damages the one thing it is being read for. Resampling in
       * the browser is what the *image* fields do, and a certificate is not a picture of one.
       */
      {
        name: "attachments",
        label: "Other Attachments",
        type: "file",
        colSpan: 2,
        props: { maxFiles: MAX_ATTACHMENTS, accept: ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" },
      },
    ],
  },
  {
    id: "anything-else",
    title: "Anything Else",
    fields: [
      { name: "referredBy", label: "Referred By", props: { placeholder: "Who told you about us, if anybody" } },
      /*
       * Two questions in place of the box that used to end the form.
       *
       * "Anything you would like us to know" is a question with no shape, and it came back the
       * three ways a shapeless question does: empty, holding a covering letter, or repeating a
       * phone number already asked for three fields above. Nobody could read a column of those
       * answers and learn anything, because no two of them answered the same thing.
       *
       * These do. **How do you know us?** is how they came to hear of the studio - which is not the
       * register's `source` column and is deliberately not written into it: that one is the
       * studio's own answer, set by a linked sheet's rules and filtered on, and a candidate writing
       * into it would overwrite what the import established. The two are different questions, and a
       * Meta lead who answers "my cousin works there" is honestly both.
       *
       * **Anything about us?** is the cheapest read there is on whether somebody is applying to
       * this studio or to forty of them, and it is the one answer on the form that cannot be
       * prepared in advance.
       *
       * Neither writes to `remarks`, which stays HR's own note on the record - so a studio's note
       * can no longer be overwritten by a candidate reopening their link and submitting again.
       */
      { name: "howYouKnowUs", label: "How do you know us?", props: { placeholder: "Instagram, a friend, a job post…" } },
      { name: "aboutUs", label: "Anything about us?", type: "textarea", colSpan: 2, props: { rows: 5, placeholder: "What you know about the studio, and why you are applying here." } },
    ],
  },
];

/** The fields the candidate never fills in, and the one the form owns rather than submits. */
export const applicationInitialValues = {
  ...Object.fromEntries(applicationFormSections.flatMap((section) => section.fields).map((field) => [field.name, ["toggle", "checkbox"].includes(field.type) ? false : ""])),
  // The two repeating lists, which start empty rather than with a blank row waiting to be filled.
  qualifications: [],
  experiences: [],
  resume: [],
  attachments: [],
  // One empty box rather than none: a list nobody has typed into still has to be typed into, and
  // `RepeatableTextList` draws that row whether or not the value carries it.
  portfolioLinks: [""],
};

/** Every field's label, so a validation message can name the field the candidate is looking at. */
export const applicationFieldLabels = Object.fromEntries(applicationFormSections.flatMap((section) => section.fields).map((field) => [field.name, field.label]));

/** Everything the candidate must answer before the form will submit, in the order it is asked. */
export const requiredApplicationFields = applicationFormSections
  .flatMap((section) => section.fields)
  .filter((field) => field.required)
  .map((field) => [field.name, field.label, field.when]);

/**
 * What is still unanswered, by label, in the order the form asks for it.
 *
 * Here rather than inside the form for the reason the sections are: it is the rule itself, and a
 * rule the tests can call is a rule that cannot quietly stop holding.
 */
export function missingApplicationFields(values = {}, context = undefined) {
  return requiredApplicationFields
    .filter(([, , when]) => !when || when(values, context))
    .filter(([name]) => {
      const value = values[name];
      if (Array.isArray(value)) return !value.length;
      if (typeof value === "boolean") return !value;
      return String(value ?? "").trim() === "";
    })
    .map(([, label]) => label);
}
