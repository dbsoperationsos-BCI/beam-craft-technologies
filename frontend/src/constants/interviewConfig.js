/**
 * The Interview screen, described as data for the shared components to draw: the status filters in
 * the tab row, the table's own columns, the info panel beside it, and the Add Application form.
 *
 * The strings here are the server's, not labels invented for the screen - the statuses, the
 * employment types, the interview modes and the sources mirror
 * `backend/src/modules/hrm/interview/candidates.js`. A status typed differently on the two sides
 * would filter to an empty tab with nothing on screen to say why. The options endpoint sends the
 * live lists; these are what the page offers before it answers, and if it never does.
 */

/**
 * The stages a candidate moves through, in the order the tab row shows them.
 *
 * Seven tabs, following one candidate from arriving to an answer: **Yet to Connect** is somebody
 * nobody has spoken to, **Form Submission Pending** is a screening form that has gone out and not
 * come back, **Form Submitted** is one that is back and waiting to be read, **Interview Scheduled**
 * is a conversation in the diary, **Selected** is the job offered, **On Hold** is a candidate
 * parked, and **Rejected** is one turned down.
 *
 * **Rejected is last** and **On Hold sits beside it**, because both are places a candidate stops:
 * the five tabs before them are the ones somebody works every morning.
 *
 * Shortlisted, Interviewed and Joined are deliberately not tabs - a form that has been read is
 * either worth a conversation or it is not, "Interviewed" says only that a meeting happened where
 * the next thing anybody wants is the answer, and somebody who has joined is an employee read from
 * the Employee Repository. A candidate whose sheet says one of those three keeps the word and
 * appears under All, which is what happens to any stage this list does not name.
 */
export const DEFAULT_CANDIDATE_STATUS = "Yet to Connect";
/*
 * **Follow Up** - somebody has been reached for, and the studio is chasing them.
 *
 * Straight after Yet to Connect, because that is the one stage it answers. A candidate nobody has
 * spoken to gets one of two things done to them: the screening form, or a call - and until now only
 * the first of those was a stage. The second was a remark, or nothing, so a register worked every
 * morning could not tell "nobody has tried this person" from "we have called them three times and
 * they have not answered". Those are the two rows that need completely different work.
 *
 * A candidate can be moved here **more than once**, and each move records when to look again and
 * why. That repetition is the point: chasing is not a step somebody passes through, it is a thing
 * that happens until it stops being worth doing - so every attempt is an entry in their decisions
 * rather than a note written over the last one.
 */
export const FOLLOW_UP_STATUS = "Follow Up";
export const FORM_PENDING_STATUS = "Form Submission Pending";
export const FORM_SUBMITTED_STATUS = "Form Submitted";
export const INTERVIEW_SCHEDULED_STATUS = "Interview Scheduled";
export const SELECTED_STATUS = "Selected";
/*
 * **Onboarded** - the offer was taken, and they have actually started.
 *
 * After Selected because the two are different answers, and the gap between them is where hiring
 * most often goes wrong: somebody offered a job has not necessarily accepted it, and a register
 * that stopped at Selected could not tell an offer still out from one already turned up for. That
 * gap was being tracked in Remarks, or nowhere.
 */
export const ONBOARDED_STATUS = "Onboarded";
export const ON_HOLD_STATUS = "On Hold";
export const REJECTED_STATUS = "Rejected";

export const CANDIDATE_STATUSES = [
  DEFAULT_CANDIDATE_STATUS,
  FOLLOW_UP_STATUS,
  FORM_PENDING_STATUS,
  FORM_SUBMITTED_STATUS,
  INTERVIEW_SCHEDULED_STATUS,
  SELECTED_STATUS,
  ONBOARDED_STATUS,
  ON_HOLD_STATUS,
  REJECTED_STATUS,
];

export const INTERVIEW_MODES = ["In Person", "Google Meet", "Phone"];
export const EMPLOYMENT_TYPES = ["Full Time", "Part Time", "Intern", "Freelance"];

/*
 * There is deliberately no source list here.
 *
 * Where an application came from is the **studio's** list, maintained in Settings → Fields →
 * Interview → Sources and served by the module's own options endpoint. It was an array on this line
 * and a second copy of the same array in `hrm/interview/candidates.js`, which is two faults rather
 * than one: a studio that started advertising somewhere new could not say so, and the two copies
 * could disagree about what the picker offered.
 *
 * So every screen that asks for a source reads `options.sources` and offers nothing if that is
 * empty - which costs nothing, because Source is an optional combobox everywhere it is asked and
 * degrades to a box somebody types into. A fallback array written here would be the hardcoding
 * back, one read failure away from being what the studio is offered.
 */

/*
 * **Add Application does not offer a stage at all**, and there is no list here of the ones it does.
 *
 * There was: every stage but Interview Scheduled, Onboarded and Rejected, on the argument that those
 * three cannot be true of an application being written down as it arrives. The argument was right
 * and did not go far enough - *none* of them can. An arriving application **is** at Yet to Connect,
 * which is the whole definition of that stage: nobody has spoken to them yet. Form Submission
 * Pending means a form has gone out, Form Submitted means it has come back, and Selected and On Hold
 * are decisions about somebody nobody has met.
 *
 * So the pills are gone and the dialog files every application at `DEFAULT_CANDIDATE_STATUS`. Each
 * of the other stages is reached by the act that makes it true - the screening form being sent and
 * returned, a round being scheduled, the decision dialog, the onboarding invite - which is also what
 * keeps the stage and the register from disagreeing.
 */

/*
 * The stages a **selection** may be moved to, which is a shorter list than the register holds.
 *
 * Three of the eight, and the line between them is whether the stage is a decision or a consequence.
 *
 *   * **Selected, On Hold and Rejected are decisions.** The studio takes them about a person, it can
 *     take the same one about twelve people at once, and each word means exactly what it says
 *     wherever it is written. Those are what a selection is for: reading a stage and answering it.
 *   * **The other five are consequences of an act.** A candidate is at Form Submission Pending
 *     because a form went out, at Interview Scheduled because a conversation is in the diary, at
 *     Onboarded because an invite was raised. Writing one of those onto a row in bulk puts a
 *     candidate in a tab whose entire meaning is that something exists which does not - and that
 *     tab is then worked by somebody looking for an interview nobody booked. Each stays where it is
 *     actually made: the screening form dialog, the schedule dialog, the onboarding invite.
 *
 * Yet to Connect is left out for the same reason read the other way: it is where a candidate starts,
 * and there is no act that returns a set of people to never-having-been-spoken-to.
 */
export const BULK_STAGE_STATUSES = [SELECTED_STATUS, ON_HOLD_STATUS, REJECTED_STATUS];

/** The tab row's "no filter" entry - the whole register, whatever stage a candidate is at. */
export const ALL_CANDIDATE_STATUSES = "ALL";

export const CANDIDATE_STATUS_FILTERS = [
  { id: ALL_CANDIDATE_STATUSES, label: "All" },
  ...CANDIDATE_STATUSES.map((status) => ({ id: status, label: status })),
];

/** The `?status=` a tab asks the server for. `All` narrows nothing, so it sends no status at all. */
export const statusQueryFor = (statusFilter) => (statusFilter === ALL_CANDIDATE_STATUSES ? "" : String(statusFilter || ""));

/**
 * The candidates one tab shows.
 *
 * The register is now read a page at a time and the **server** applies the stage, so a page has
 * already been narrowed by the time it arrives and this only guards against a page that outlived
 * the tab it was fetched for. `All` is everything, including a candidate whose sheet gave them a
 * stage the list has no name for - the only tab such a row appears under.
 *
 * It was a filter over the whole register, which is what the screen used to hold. That stopped
 * being affordable at several thousand candidates: the browser waited on every row before drawing
 * one, and then kept all of them.
 */
export const candidatesForStatus = (candidates, statusFilter) => (statusFilter === ALL_CANDIDATE_STATUSES
  ? [...(candidates || [])]
  : (candidates || []).filter((candidate) => candidate?.status === statusFilter));

/**
 * How many candidates sit behind each tab, keyed by the tab's own id.
 *
 * `serverCounts` is the register's own tally, grouped by status by the server, and is what the tabs
 * read: a tab's number describes the register rather than the page that has been scrolled in, and
 * counting the rows in hand would have every tab shrink to "100" the moment paging arrived.
 *
 * `All` is the sum rather than a count of its own, so it cannot disagree with the tabs beside it.
 * Falls back to counting what is held, which is what an unanswered or failed read leaves.
 */
export function candidateStatusCounts(candidates, serverCounts = null) {
  if (serverCounts && typeof serverCounts === "object") {
    const counts = { ...serverCounts };
    counts[ALL_CANDIDATE_STATUSES] = Object.values(serverCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
    return counts;
  }
  const rows = Array.isArray(candidates) ? candidates : [];
  const counts = { [ALL_CANDIDATE_STATUSES]: rows.length };
  for (const candidate of rows) counts[candidate?.status] = (counts[candidate?.status] || 0) + 1;
  return counts;
}

/**
 * The dot beside a status, the same reading the task and payment dots give: sky for somebody nobody
 * has reached yet, amber while the studio is waiting on the candidate, cyan once the form is back
 * and there is something to read, orange for one parked. A stage this list has no name for keeps
 * the shared slate, which is how an unlisted word from a sheet reads as exactly that.
 */
/**
 * The dot beside an interview's **mode**, on the same scale the stage dots use.
 *
 * Three colours for three genuinely different arrangements, because the mode decides what somebody
 * has to do about the appointment: **In Person** is a day blocked out and a room, **Google Meet** is
 * a link to open, **Phone** is a number to ring. Read down the column they separate at a glance,
 * which is the whole reason the stage beside them carries a dot rather than only a word.
 *
 * Deliberately clear of the stage colours: an interview is never both, but the two columns sit near
 * each other and a shared colour would invite the reading that they mean the same thing. A mode
 * this list has no name for keeps the shared slate, exactly as an unlisted stage does.
 */
export const candidateModeStyles = {
  "In Person": "bg-violet-500",
  "Google Meet": "bg-blue-600",
  Phone: "bg-teal-500",
};

export const candidateStatusStyles = {
  [DEFAULT_CANDIDATE_STATUS]: "bg-sky-500",
  // A deeper sky than Yet to Connect beside it: the same candidate, being worked rather than
  // waiting, so the pair reads as one thing progressing rather than as two unrelated stages - the
  // reading Selected and Onboarded already get from their two greens.
  [FOLLOW_UP_STATUS]: "bg-sky-700",
  [FORM_PENDING_STATUS]: "bg-amber-500",
  [FORM_SUBMITTED_STATUS]: "bg-cyan-600",
  [INTERVIEW_SCHEDULED_STATUS]: "bg-indigo-500",
  [SELECTED_STATUS]: "bg-emerald-600",
  // A deeper green than Selected beside it: the same answer, one step further on, so the pair reads
  // as a progression rather than as two unrelated stages.
  [ONBOARDED_STATUS]: "bg-green-800",
  [ON_HOLD_STATUS]: "bg-orange-400",
  [REJECTED_STATUS]: "bg-rose-600",
};

/**
 * `[key, header, type, size, minSize]`, the same shape every other module table uses.
 *
 * The order is the order of the studio's own hiring sheet, which is a **Meta lead export**: the day
 * the application came in, which ad brought it, what the candidate answered, and then who they are.
 * It reads left to right the way the sheet it replaces does, so somebody moving off that sheet is
 * not relearning their own register. Everything the module also holds follows after it, and
 * Manage Columns moves any of it out of the way.
 *
 * `Sl. No.` is not here: the shared table numbers its own rows, which is why the sheet's own serial
 * column is the one heading the importer leaves unread.
 *
 * The headers are the studio's words rather than the module's where the two differ - Current Salary
 * for `currentCtc`, When Can You Join for `availableFrom` - because these are the questions their
 * own ad form asks, and a column headed something else is a column somebody has to translate.
 */
/**
 * The columns whose filter offers a list of what the column holds, asked of the server.
 *
 * The same set the backend will answer for. Everything else keeps the plain text box, which is the
 * right control for a name or a number somebody types part of - and for a date, which is a range.
 */
export const FILTERABLE_CANDIDATE_COLUMNS = [
  "position", "department", "branch", "status", "source", "employmentType", "interviewer",
  "interviewMode", "gender", "city", "state", "campaignName", "adsetName", "adName",
  "experience", "noticePeriod", "highestQualification", "referredBy", "howYouKnowUs",
];

export const candidateTableFields = [
  // ── The sheet, in its own order ────────────────────────────────────────────────────────────
  // "Date" rather than "Applied On": one column, the studio's word for it. The record still reads
  // "Applied On", where three other dates sit beside it and "Date" would say which of them it is.
  ["appliedDate", "Date", "day", 130, 110],
  ["campaignName", "Campaign Name", undefined, 200, 140],
  ["adsetName", "Adset Name", undefined, 180, 130],
  ["adName", "Ad Name", undefined, 180, 130],
  ["experience", "Years of Experience", undefined, 170, 130],
  ["currentCtc", "Current Salary", undefined, 150, 120],
  // The floor beside the ask. Both visible by default: they are read together or the pair says
  // nothing, the way the two follow-up dates below are.
  ["minExpectedCtc", "Least Expected Salary", undefined, 180, 140],
  ["expectedCtc", "Expected Salary", undefined, 150, 120],
  ["languagesKnown", "Languages Known", undefined, 180, 130],
  ["availableFrom", "When Can You Join", "day", 180, 130],
  ["name", "Name", undefined, 200, 150],
  ["phone", "Phone Number", undefined, 160, 130],
  // The number a candidate is actually reached on, which is not always the one they applied with.
  // The record and the info panel have always shown it; the table simply never offered it.
  ["whatsappNumber", "WhatsApp Number", undefined, 170, 140],
  ["gender", "Gender", undefined, 130, 110],
  ["city", "City", undefined, 130, 110],
  // Where they are from and where they are now, which is what the screening form asks in place of a
  // state and a postal address. Hidden by default like most of the form's own columns; the info
  // panel and the record show them without being asked.
  ["nativePlace", "Native Place", undefined, 150, 120],
  ["currentLocation", "Current Location", undefined, 160, 130],
  // The candidate's own two links, drawn as what they open rather than as the URL that reaches them.
  // A résumé is a PDF as often as an image, so both are links and neither is a thumbnail.
  ["resumeUrl", "Resume", "link", 190, 140],
  ["portfolioUrl", "Portfolio Link", "link", 200, 140],
  // ── What the register holds besides ────────────────────────────────────────────────────────
  ["candidateCode", "Candidate ID", undefined, 160, 130],
  ["status", "Status", "status", 200, 150],
  ["position", "Position", undefined, 180, 130],
  ["employmentType", "Employment Type", undefined, 160, 120],
  ["department", "Department", undefined, 150, 120],
  /*
   * Which round they are on, beside the date of it.
   *
   * Derived by the server from the rounds themselves rather than stored, so a count and the list
   * behind it cannot drift apart. A candidate nobody has called yet reads "—" rather than 0,
   * because no rounds is not a round.
   */
  ["interviewRound", "Round", "round", 110, 90],
  ["interviewDate", "Interview Scheduled On", "day", 190, 140],
  ["branch", "Branch", undefined, 150, 120],
  ["source", "Source", undefined, 170, 120],
  // The two follow-up dates read together or not at all: what the last conversation was and when
  // the next one is due is one answer, and split across a Manage Columns toggle it is neither.
  ["lastFollowUpDate", "Last Follow-up", "day", 150, 120],
  ["nextFollowUpDate", "Next Follow-up", "day", 150, 120],
  ["email", "Email", undefined, 220, 150],
  ["interviewer", "Interviewer", undefined, 170, 130],
  ["interviewTime", "Interview Time", undefined, 140, 110],
  // A dot and the word, the way the stage column reads - see `candidateModeStyles`.
  ["interviewMode", "Mode", "status", 130, 100],
  /*
   * The link itself, beside the mode that explains it.
   *
   * A Google Meet interview is a link somebody has to open, and it lived only on the record - so
   * joining a call meant opening the candidate first. As a `link` cell it opens in a **new tab**,
   * with `noopener noreferrer`, and stops the row's own click, so following it never navigates the
   * register away or opens the info panel underneath.
   */
  ["meetLink", "Meet Link", "link", 170, 130],
  ["currentCompany", "Current Company", undefined, 180, 130],
  ["currentDesignation", "Current Designation", undefined, 180, 130],
  ["noticePeriod", "Notice Period", undefined, 140, 110],
  ["highestQualification", "Qualification", undefined, 180, 130],
  ["skills", "Skills", undefined, 200, 140],
  ["dateOfBirth", "Date of Birth", "day", 150, 120],
  ["state", "State", undefined, 130, 110],
  // Filled by a sheet or an import rather than typed here, and long, so it stays off by default -
  // but it is a column the register holds and it belongs in Manage Columns like the rest.
  ["address", "Address", undefined, 240, 160],
  ["referredBy", "Referred By", undefined, 160, 120],
  ["howYouKnowUs", "How They Know Us", undefined, 200, 140],
  ["aboutUs", "What They Know About Us", undefined, 240, 160],
  ["remarks", "Remarks", undefined, 220, 150],
  ["createdAt", "Created", "date", 140, 120],
  ["updatedAt", "Last Updated", "date", 150, 130],
];

/**
 * The columns a table opens with. Everything is available in Manage Columns; the ones hidden here
 * are the second-order details, which crowd out the answer most readings of this screen are after.
 *
 * The hiring sheet's own columns are all visible, including the six that used to be hidden - a
 * salary, a language, a joining answer, a gender and a city are what the studio's ad form asks, so
 * on this register they are the answer rather than a detail.
 */
export const candidateDefaultHiddenColumns = [
  // `interviewer` is hidden rather than removed: with one HR nothing on screen assigns a candidate,
  // so the column is empty for everybody who does not link a sheet - and for those who do, its
  // rules still fill it in, so the column stays available in Manage Columns and on the info panel.
  "interviewer",
  /*
   * `interviewMode` and `meetLink` are **not** hidden.
   *
   * The mode decides what somebody has to do about an appointment - a room, a link, or a number -
   * and it carries a colour for exactly that reading, which a column nobody has turned on cannot
   * give. The link beside it is the one thing on this register anybody acts on without opening a
   * candidate first: a Meet interview is joined from the row. Both are in Manage Columns like
   * everything else, for a studio that interviews in person and wants the width back.
   */
  "email", "interviewTime", "currentCompany", "currentDesignation",
  "highestQualification", "skills", "dateOfBirth", "state", "nativePlace", "currentLocation", "referredBy",
  // `address` is hidden for the reason the rest here are - it is long and rarely read on a register
  // - while **Remarks is not**: it is HR's running note on the person, which is the one thing on
  // this screen somebody scans a register for, and it spent its life behind Manage Columns.
  "address",
  // `whatsappNumber` likewise: the register opens on the studio's hiring sheet, and a second number
  // is not one of its columns - it is reached for when somebody is about to message the candidate,
  // which is what Manage Columns and the info panel are for.
  "whatsappNumber",
  // Two sentences a candidate wrote: available in Manage Columns, but not what the register opens
  // on - the same treatment Remarks beside them already gets.
  "howYouKnowUs", "aboutUs",
  "createdAt", "updatedAt",
];

export const candidateInfoSections = [
  { title: "Candidate", fields: [["candidateCode", "Candidate ID"], ["name", "Name"], ["status", "Status"], ["position", "Position"], ["employmentType", "Employment Type"], ["department", "Department"], ["branch", "Branch"]] },
  { title: "Contact", fields: [["phone", "Phone Number"], ["whatsappNumber", "WhatsApp"], ["email", "Email"], ["city", "City"], ["nativePlace", "Native Place"], ["currentLocation", "Current Location"], ["state", "State"], ["address", "Address"]] },
  { title: "Interview", fields: [["interviewer", "Interviewer"], ["interviewRound", "Round", "round"], ["interviewDate", "Interview Scheduled On"], ["interviewTime", "Interview Time"], ["interviewMode", "Mode"], ["meetLink", "Meet Link", "meetLink"], ["lastFollowUpDate", "Last Follow-up"], ["nextFollowUpDate", "Next Follow-up"]] },
  { title: "Background", fields: [["experience", "Years of Experience"], ["currentCompany", "Current Company"], ["currentDesignation", "Current Designation"], ["currentCtc", "Current Salary"], ["minExpectedCtc", "Least Expected Salary"], ["expectedCtc", "Expected Salary"], ["noticePeriod", "Notice Period"], ["availableFrom", "When Can You Join"], ["highestQualification", "Qualification"], ["skills", "Skills"], ["languagesKnown", "Languages Known"], ["portfolioUrl", "Portfolio"], ["resumeUrl", "Resume"], ["attachments", "Other Attachments", "attachments"]] },
  /*
   * HR's running note on the person, and it sits **above** Application deliberately.
   *
   * What follows it is provenance - which ad brought them in, when they applied, when the row was
   * created - read when somebody is checking where a candidate came from. The remarks are read
   * every time the record is opened, so they belong with the sections about the person rather than
   * below the ones about the paperwork.
   *
   * Kept apart from "In Their Words" below: that is the candidate's own answer about the studio,
   * and reading a studio's note and a candidate's answer under one heading loses which is which.
   */
  { title: "Remarks", fields: [["remarks", "Remarks"]] },
  { title: "Application", fields: [["source", "Source"], ["campaignName", "Campaign Name"], ["adsetName", "Adset Name"], ["adName", "Ad Name"], ["referredBy", "Referred By"], ["gender", "Gender"], ["dateOfBirth", "Date of Birth"], ["appliedDate", "Applied On"], ["addedTime", "Added Time"], ["createdAt", "Created", "date"], ["updatedAt", "Last Updated", "date"]] },
  // The candidate's own words about the studio, kept apart from Remarks - that is HR's note, and
  // reading a studio's note and a candidate's answer under one heading loses which is which.
  /*
   * **Every remark written as the stage moved**, newest last, and the one place they accumulate.
   *
   * Kept apart from Remarks above, which is HR's single running note on the person and is written
   * over each time it is edited. These are appended and never rewritten: a candidate chased on the
   * 8th, chased again on the 15th, held in March and rejected in May has five things somebody said
   * about them at five different moments, and none of them explains any of the others. A Follow Up
   * entry carries the day it promised as well, since the record only ever holds the next one.
   *
   * Read in full wherever the record is - the info panel beside the table, and the panel a
   * double-click opens - because both draw from this list.
   */
  { title: "Follow-ups & Decisions", fields: [["statusNotes", "Why", "statusNotes"]] },
  { title: "In Their Words", fields: [["howYouKnowUs", "How do you know us?"], ["aboutUs", "Anything about us?"]] },
];

/**
 * The candidate's record in full, as the four sections the panel a row opens is drawn from.
 *
 * **Not the Add Application dialog**, which asks six questions and is written out in
 * `InterviewAddApplicationDialog` - the same split the CRM has between Add Lead and the lead popup.
 * An arriving application is a name, a number and the job they are after; this is every column the
 * register can hold, including the ones only a linked sheet, a CSV or the candidate's own submitted
 * form ever fill in, so that each of them can be read and corrected.
 *
 * Application Details first, because that is what the record *is*: who applied, for what, and on
 * what terms. Then the person, then their background, then the screening the studio does - which is
 * last because it is answered after the application arrives rather than with it.
 *
 * Position, department and source are comboboxes rather than closed lists: a candidate who arrived
 * from a sheet may carry a spelling the studio's lists do not have, and the form has to be able to
 * show it back rather than blank it.
 */
/**
 * Whether this record is being read as somebody with a work history.
 *
 * The record's own copy of the application form's `isExperienced`, testing the same value. It is a
 * separate line rather than an import because the two modules must not depend on each other - the
 * register's config is read by the signed-in screens, the application's by a public page - and the
 * word they agree on is `"Experienced"`, which both spell out.
 */
const isRecordExperienced = (values) => values?.experienceLevel === "Experienced";

export const candidateFormSections = [
  /*
   * **The candidate's own application form, as the record reads it back.**
   *
   * The two had drifted into different forms of the same interview: the application asked for
   * education as rows and the record as a one-line "Highest Qualification"; the application banded
   * the notice period and the record took free text; the application collected three links and the
   * record showed one. So HR read a record that did not look like what the candidate filled in, and
   * half of what was submitted - the education rows, the work history, the extra links, the
   * attachments - could not be seen here at all, let alone corrected.
   *
   * The sections, their order and their questions now mirror `interviewApplicationConfig`, with two
   * deliberate differences:
   *
   *   1. **The studio's own columns are folded into the matching section** rather than given one of
   *      their own - department, branch, source and the three ad columns sit under The Role,
   *      because they answer "what was applied for" even though the candidate is never asked them.
   *   2. **Screening is a section the application does not have**, and comes last: the stage, the
   *      interview, the follow-ups and HR's own remarks are the studio's answers about a candidate
   *      rather than the candidate's about themselves.
   *
   * Where a control differs it is because this form has to survive what the application form never
   * sees: a value a linked sheet or a CSV put there. Those are marked at the field.
   */
  {
    id: "application",
    title: "The Role",
    fields: [
      { name: "position", label: "Position Applied For", type: "combobox", required: true, options: "positions", placeholder: "Select or type a position" },
      // `sorted: false` because the order of the list is the order the studio hires in.
      { name: "employmentType", label: "Employment Type", type: "select", options: "employmentTypes", placeholder: "Select a type", props: { sorted: false } },
      /*
       * The studio's own four, which the application deliberately never asks. Department is the
       * studio's answer about a hire rather than a candidate's guess; branch, source and the ad
       * columns are set here, by a linked sheet's rules, or by a CSV.
       */
      { name: "department", label: "Department", type: "combobox", options: "departments", placeholder: "Select or type a department" },
      { name: "branch", label: "Branch Applied For", type: "select", options: "branches", placeholder: "Select a branch", props: { searchable: true } },
      { name: "source", label: "Source", type: "combobox", options: "sources", placeholder: "Select or type a source" },
      { name: "campaignName", label: "Campaign Name", type: "text" },
      { name: "adsetName", label: "Adset Name", type: "text" },
      { name: "adName", label: "Ad Name", type: "text" },
      { name: "appliedDate", label: "Applied On", type: "date" },
    ],
  },
  {
    id: "candidate",
    title: "About You",
    fields: [
      // The application's own order, so a record reads the way the form that filled it in did.
      { name: "name", label: "Candidate Name", type: "text", required: true, placeholder: "e.g. Anu Priya", colSpan: 2 },
      { name: "gender", label: "Gender", type: "select", options: "genders", placeholder: "Select" },
      { name: "dateOfBirth", label: "Date of Birth", type: "date" },
      { name: "phone", label: "Phone Number", type: "phone", required: true },
      { name: "whatsappNumber", label: "WhatsApp Number", type: "phone" },
      { name: "email", label: "Email", type: "text", placeholder: "name@example.com" },
      { name: "city", label: "City", type: "text" },
      /*
       * What the screening form now asks in place of a state and a postal address. `state` and
       * `address` stay below them rather than going: a linked sheet and the CSV import still fill
       * those for candidates who arrived that way, and throwing away answers already collected is
       * not what "the form no longer asks" means.
       */
      { name: "nativePlace", label: "Native Place", type: "text" },
      { name: "currentLocation", label: "Current Location", type: "text" },
      { name: "state", label: "State", type: "text" },
      { name: "address", label: "Address", type: "textarea", props: { rows: 3 }, colSpan: 2 },
      /*
       * What the candidate studied, as the rows they submitted rather than as a line of text.
       *
       * This is the half of the application HR could not see: the form has asked for education as
       * rows with an institution and a year since it was written, and the record answered with a
       * single "Highest Qualification" box - so the rows were stored, shown on no screen, and
       * uneditable. That box is gone with the arrival of these, exactly as it went from the
       * application form and for the same reason: it is the same answer twice, in a shorter form,
       * with nothing to say which the studio should believe.
       */
      { name: "educationEntries", label: "Qualification Details", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "background",
    title: "Experience & Expectations",
    fields: [
      /*
       * The application's own question, asked here the same way and **answered from the record**.
       *
       * `experienceLevel` is not a column - it is the branch, exactly as it is on the application
       * form - so `candidateFormValues` reads it back off what the candidate submitted: rows on the
       * record mean Experienced, the word "Fresher" in the Experience column means Fresher. Opening
       * a candidate therefore shows the answer they gave rather than an empty question.
       *
       * What is stored stays `experience`, the free-text column, shown beside it as the readout the
       * form shows - and written on save the way the form writes it, which is the one place the two
       * screens must not disagree.
       */
      { name: "experienceLevel", label: "Are you a fresher or experienced?", type: "select", options: "experienceLevels", placeholder: "Select", props: { sorted: false } },
      { name: "experience", label: "Total Experience", type: "custom" },
      { name: "experienceEntries", label: "Experience Details", type: "custom", colSpan: 2, when: isRecordExperienced },
      /*
       * The four that presuppose a job, hidden for a fresher exactly as they are on the form.
       *
       * Hidden, never blanked: this record keeps whatever a sheet put in them, and a value that is
       * off screen is still carried back by the save - see `payloadFrom` in the panel.
       */
      { name: "currentCompany", label: "Current Company", type: "text", when: isRecordExperienced },
      { name: "currentDesignation", label: "Current Designation", type: "text", when: isRecordExperienced },
      { name: "currentCtc", label: "Current Salary", type: "text", placeholder: "e.g. 3.5 LPA", when: isRecordExperienced },
      /*
       * The application's own bands, offered rather than enforced.
       *
       * A **combobox**, not the form's `select`: a candidate can only choose a band, but this record
       * may already hold "45-60 days" from a sheet or a CSV, and a closed list would show that back
       * as empty and then save the blank over it. The list is what to pick; the box is what to keep.
       */
      { name: "noticePeriod", label: "Notice Period", type: "combobox", options: "noticePeriods", placeholder: "Select or type", props: { sorted: false }, when: isRecordExperienced },
      { name: "minExpectedCtc", label: "Least Expected Salary", type: "text", placeholder: "e.g. 3 LPA" },
      { name: "expectedCtc", label: "Expected Salary", type: "text", placeholder: "e.g. 5 LPA" },
      /*
       * When they can join, as the one column that holds every answer to it.
       *
       * The application asks this as a yes-or-no and writes "Immediate" or a date. It was a **date
       * picker** here, which could show neither - `candidateFormValues` blanked anything that was
       * not `YYYY-MM-DD`, and because this form saves every key it is given, opening a candidate
       * who answered "Immediate" and pressing Save **erased their answer**. A combobox offering
       * Immediate shows and keeps all three: the word, a day, and a sheet's own "15 days".
       */
      { name: "availableFrom", label: "When Can You Join", type: "combobox", options: "joiningAnswers", placeholder: "Immediate, a date, or type it" },
      { name: "skills", label: "Skills", type: "text", placeholder: "Photography, Lightroom, Premiere Pro" },
      { name: "languagesKnown", label: "Languages Known", type: "text", placeholder: "Tamil, English" },
      // The three the candidate may send, in place of the single Portfolio Link box this had.
      { name: "portfolioLinks", label: "Portfolio / Links", type: "custom", colSpan: 2 },
      /*
       * The résumé itself, and the address it lives at.
       *
       * It was a URL in a text box, which is the one thing nobody wants from it: a résumé is read,
       * not proof-read. The field now opens the document *and* keeps the box, because this record
       * is also where a row imported with the link in the wrong column is put right - reading it
       * and correcting it are both things this screen is for.
       */
      { name: "resumeUrl", label: "Resume", type: "custom", colSpan: 2 },
      /*
       * What else they attached, read rather than edited. HR replaces a file by asking for a new
       * form rather than uploading on the candidate's behalf, so this opens each one and offers no
       * control to change it - which is also why the update endpoint does not take the key.
       */
      { name: "attachments", label: "Other Attachments", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "anything-else",
    title: "Anything Else",
    fields: [
      { name: "referredBy", label: "Referred By", type: "text", placeholder: "Who sent them, where it was a referral" },
      { name: "howYouKnowUs", label: "How do you know us?", type: "text" },
      /*
       * The candidate's own words, kept here beside the question above and **out of Screening**,
       * where it briefly sat next to Remarks. Those two are different things: this is what the
       * candidate says about the studio, Remarks is what the studio says about the candidate, and
       * one heading over both loses which is which.
       */
      { name: "aboutUs", label: "Anything about us?", type: "textarea", props: { rows: 4 }, colSpan: 2 },
    ],
  },
];

/**
 * **Schedule Interview** - putting a conversation in the diary, asked apart from the record.
 *
 * These used to be the last section of the record, which made one screen two jobs: reading back
 * what a candidate submitted, and deciding what the studio does about them. They are different
 * work, done at different moments and often by different people - correcting a mistyped salary is
 * not the same errand as putting a conversation in the diary.
 *
 * ── There is no Status field, and that is the point ──
 *
 * The stage of a candidate with a round in the diary **is** "Interview Scheduled", so a picker
 * asking somebody to say so after they have just booked it is asking them to restate what they
 * have done - and every time it was missed, the register's stage disagreed with the register's own
 * interview date. The server moves the stage from the act itself now
 * (`POST /candidates/:id/schedule`), and records why, so nothing has to be remembered. The three
 * stages that *are* decisions - Selected, On Hold, Rejected - are taken in their own dialog, which
 * asks the question this one cannot: why.
 *
 * ── There is no Meet Link box, at any mode ──
 *
 * For a **Google Meet** round it cannot be one: a link does not exist until Google issues it, and
 * Google issues one only as part of a calendar event. The server creates the event, invites the
 * guests and puts the link on the round, so a box would be asking for the one answer the form is
 * about to produce.
 *
 * For **In Person** and **Phone** there is nothing to ask for either. Somebody walking into the
 * studio has no link, and a phone call is a number the record already holds - so the box stood empty
 * on every round of both modes, and the one thing it could collect was a link pasted onto a round
 * that is not a video call at all.
 *
 * A link a round already carries - one a linked sheet or a CSV wrote, or a Meet booked before this -
 * is **kept** rather than blanked: not asking for a value is not the same as deciding it is wrong.
 * The register still shows it, as the Meet Link column and as "Join the meeting" on the record.
 *
 * Exported as a section list rather than as fields, so the dialog draws it with the same
 * `SchemaFormField` every other form here uses and a field added to it needs no component change.
 */

/** The mode that means "this application books it": the one round that gets a calendar event. */
export const GOOGLE_MEET_MODE = "Google Meet";

/** Whether the round being scheduled is one this application books a Google Meet for. */
export const isMeetRound = (values) => String(values?.interviewMode || "").trim() === GOOGLE_MEET_MODE;

/**
 * How long an interview runs, offered as the CRM's own Add Meet offers it - the same six lengths,
 * so somebody who books client meetings is not asked the same question two different ways.
 */
export const MEET_DURATIONS = [
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1 hour 30 minutes" },
  { value: 120, label: "2 hours" },
];

export const DEFAULT_MEET_DURATION = 30;

export const candidateScheduleSections = [
  {
    id: "interview",
    title: "Interview",
    fields: [
      { name: "interviewDate", label: "Interview Date", type: "date", required: true },
      /*
       * Required in the schema because every round has an hour, and refused by the dialog only for a
       * Google Meet - where the server cannot book an event without one. An in-person round noted as
       * "sometime Thursday" is a real thing a studio writes down, and it is not this form's business
       * to refuse it.
       */
      { name: "interviewTime", label: "Interview Time", type: "time" },
      { name: "interviewMode", label: "Mode", type: "select", options: "modes", required: true, placeholder: "Select a mode", props: { sorted: false } },
      // Only for a round this application books: the other two modes have no event to give a length to.
      { name: "durationMinutes", label: "Duration", type: "select", options: "durations", when: isMeetRound, props: { sorted: false } },
      /*
       * **Who is taking it.** The register has always held an interviewer - a linked sheet's
       * assignment rules fill it in - and nothing on screen ever asked for one, because the studio
       * has one HR and there was nobody to assign a candidate to. A Meet changes that: somebody has
       * to be *in* the conversation, and their work address is what the invite goes to.
       */
      { name: "interviewerEmployeeId", label: "Interviewer", type: "select", options: "interviewers", placeholder: "Who is taking this round" },
      // Who the invite goes to, for a round this application books. There is no Meet Link field at
      // any mode - see the note above this list.
      { name: "attendees", label: "Guests", type: "custom", colSpan: 2, when: isMeetRound },
      /*
       * **No Last Follow-up box.** It asked HR to tell the register something the register already
       * knows, and it was a box that had to be *remembered*: the column means "the day somebody last
       * worked this candidate", so one nobody updated said the opposite of the truth rather than
       * nothing at all. The server stamps it from the act itself now - saving a candidate is working
       * them - see `updateCandidate` in `hrm/interview/service.js`.
       *
       * Next Follow-up stays a box, and the difference is which way it points: the last one is a
       * fact the application can observe, and the next one is a decision only a person can make.
       */
      { name: "nextFollowUpDate", label: "Next Follow-up", type: "date" },
      // No placeholder: the heading says what the box is for. HR's own note on the candidate, which
      // the application form no longer writes to at all.
      { name: "remarks", label: "Remarks", type: "textarea", props: { rows: 6 }, colSpan: 2 },
    ],
  },
];

/**
 * Every field the record's form holds, empty - which is what `candidateFormValues` fills in from a
 * candidate, and so the one list of keys the panel reads and writes. The Add Application dialog
 * keeps its own much shorter set; it asks six questions and does not draw from this.
 */
export const emptyCandidateValues = () => ({
  name: "",
  phone: "",
  whatsappNumber: "",
  email: "",
  gender: "",
  dateOfBirth: "",
  city: "",
  nativePlace: "",
  currentLocation: "",
  state: "",
  address: "",
  branch: "",
  position: "",
  department: "",
  employmentType: "",
  experience: "",
  currentCompany: "",
  currentDesignation: "",
  currentCtc: "",
  minExpectedCtc: "",
  expectedCtc: "",
  noticePeriod: "",
  availableFrom: "",
  highestQualification: "",
  skills: "",
  languagesKnown: "",
  portfolioUrl: "",
  resumeUrl: "",
  status: DEFAULT_CANDIDATE_STATUS,
  interviewDate: "",
  interviewTime: "",
  interviewMode: "",
  meetLink: "",
  lastFollowUpDate: "",
  nextFollowUpDate: "",
  source: "",
  campaignName: "",
  adsetName: "",
  adName: "",
  referredBy: "",
  howYouKnowUs: "",
  aboutUs: "",
  // Removed from the form with the arrival of the education rows, and left here so a stored value
  // is carried back untouched rather than blanked by a save - the update writes every key it gets.
  highestQualification: "",
  appliedDate: "",
  remarks: "",
});

/**
 * A stored time as `TimeField` wants it - `HH:MM`, 24-hour - or the value untouched.
 *
 * The column is free text and holds whatever reached it: the server normalises what it can on every
 * write, but a linked sheet or a CSV can still land "10:30 am", "10.30 AM" or something no rule
 * reads. `TimeField` is the shared control every time in the application is drawn with, and it
 * renders only `HH:MM`, so the common written forms are converted here rather than shown as an
 * empty box.
 *
 * **Anything unreadable is returned as it stands, not blanked.** The control cannot display it, but
 * the value stays in the form's state, so a save carries it back rather than writing an empty over
 * it - which is the fault `availableFrom` had, and the reason this returns the original instead of
 * "" the way `dateValue` below does.
 */
const clockValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[:.]?([0-5]\d)?\s*(am|pm)?$/i);
  if (!match) return raw;
  const [, rawHour, rawMinute, meridiem] = match;
  const hour = Number(rawHour);
  if (!Number.isFinite(hour)) return raw;
  const suffix = (meridiem || "").toLowerCase();
  let hour24 = hour;
  // 12am is midnight and 12pm is noon, which is the one case the "+12" rule gets backwards.
  if (suffix === "pm" && hour !== 12) hour24 += 12;
  if (suffix === "am" && hour === 12) hour24 = 0;
  if (hour24 > 23) return raw;
  return `${String(hour24).padStart(2, "0")}:${rawMinute || "00"}`;
};

/** A stored date as the date field wants it - `YYYY-MM-DD` - or "" for anything else. */
const dateValue = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value || "")) ? String(value).slice(0, 10) : "");

/** The form's values for a candidate being edited: every field as stored, dates as the picker reads them. */
/** A stored list as the form holds it: the rows themselves, or none. */
const listValue = (value) => (Array.isArray(value) ? value : []);

export const candidateFormValues = (candidate) => ({
  ...emptyCandidateValues(),
  ...Object.fromEntries(Object.keys(emptyCandidateValues()).map((key) => [key, candidate?.[key] ?? ""])),
  interviewDate: dateValue(candidate?.interviewDate),
  lastFollowUpDate: dateValue(candidate?.lastFollowUpDate),
  nextFollowUpDate: dateValue(candidate?.nextFollowUpDate),
  appliedDate: dateValue(candidate?.appliedDate),
  dateOfBirth: dateValue(candidate?.dateOfBirth),
  interviewTime: clockValue(candidate?.interviewTime),
  /*
   * **Not** `dateValue`, which is what this was and which quietly destroyed answers.
   *
   * When Can You Join is free text and always has been - the application writes "Immediate" into
   * it, a sheet writes "15 days", a CSV writes a day. `dateValue` returns "" for anything that is
   * not `YYYY-MM-DD`, so opening such a candidate showed the field empty, and because an update
   * writes every column it is given a key for, pressing Save then wrote that blank over their
   * answer. Kept as stored, and the field beside it is a combobox so all three show.
   */
  availableFrom: candidate?.availableFrom ?? "",
  status: candidate?.status || DEFAULT_CANDIDATE_STATUS,
  /*
   * Fresher or experienced, **answered from the record** rather than asked again.
   *
   * The same reading the application form's own prefill takes, and deliberately the same order:
   * rows on the record mean experienced, the word "fresher" in the Experience column means fresher,
   * and anything else - a sheet's "2-3 yrs", a blank - leaves the question unanswered, which is the
   * honest reading of a column that says a span and nothing about rows. Not a column of its own:
   * it is the branch, exactly as it is on the form.
   */
  experienceLevel: candidate?.experienceEntries?.length
    ? "Experienced"
    : (/fresher/i.test(String(candidate?.experience || "")) ? "Fresher" : ""),
  /*
   * The lists, which the record could not show at all before this. They are arrays rather than
   * strings, so they are taken from the candidate directly instead of through the string mapping
   * above, which would have turned each into "".
   */
  educationEntries: listValue(candidate?.educationEntries),
  experienceEntries: listValue(candidate?.experienceEntries),
  attachments: listValue(candidate?.attachments),
  /*
   * A candidate written before the list existed carries one link in `portfolioUrl`, which is
   * exactly one link and no list - the same reading the application form's own prefill takes, so
   * opening either screen shows that candidate the same single box.
   */
  portfolioLinks: candidate?.portfolioLinks?.length
    ? candidate.portfolioLinks
    : (candidate?.portfolioUrl ? [candidate.portfolioUrl] : []),
});
