/**
 * What an interview candidate is, stated once for every reader of the module.
 *
 * Data and pure helpers only - no database, no Google - so the form, the sheet importer, the
 * options endpoint and the tests all answer "what is a status" and "what does a code look like"
 * from the same lines. `frontend/src/constants/interviewConfig.js` mirrors the lists for the screen;
 * a status typed differently on the two sides would filter to an empty tab with nothing to say why.
 */

/**
 * The stages a candidate moves through, in the order the tab row shows them.
 *
 * Eight, and they follow one candidate from arriving to an answer: nobody has spoken to them yet,
 * the screening form has gone out and not come back, the form is back and waiting to be read, a
 * conversation is in the diary, they have the job, they have started, they are parked, or they were
 * turned down. Named for what the studio is waiting on rather than for a step in a process - "Yet to
 * Connect" says what to do next, where "New" said only when it arrived.
 *
 * **Rejected is last**, after every stage a candidate can still move on from, and **On Hold sits
 * beside it** - both are places a candidate stops, so the tabs somebody works every morning are the
 * five before them.
 *
 * ── What is deliberately not a stage ──
 *
 * **Shortlisted, Interviewed and Joined** are not on this list. A form that has been read is either
 * worth a conversation - in which case it is scheduled - or it is not, so Shortlisted is a stage
 * with nothing to do in it; Interviewed says only that a meeting happened, which the interview date
 * already records, and the next thing anybody wants to know is the answer; and somebody who has
 * joined is an employee, read from the Employee Repository rather than from a hiring queue.
 *
 * **Onboarded** is not that word wearing a different hat. Somebody offered a job has not
 * necessarily accepted it, and the register had no way to tell an offer still out from one already
 * turned up for - a gap that was tracked in Remarks or nowhere. The stage answers the hiring
 * question without waiting for a repository row to exist.
 *
 * None of those three words is folded onto a stage that remains, and that matters: a recruiter's
 * spreadsheet saying "Interviewed" keeps saying it (see `normalizeCandidateStatus`) and the
 * candidate shows under All, rather than being quietly moved somewhere the studio did not choose.
 */
const DEFAULT_CANDIDATE_STATUS = "Yet to Connect";
/*
 * **Follow Up** - somebody has been reached for, and the studio is chasing them.
 *
 * Straight after Yet to Connect, because that is the one stage it answers: a candidate nobody has
 * spoken to is either sent the screening form or chased, and until now only the first of those was
 * a stage. The second was a remark, or nothing - so a register worked every morning could not tell
 * "nobody has tried this person" from "we have called them three times and they have not answered",
 * which are the two rows that need completely different work.
 *
 * It is a stage a candidate can be moved to **more than once**, and each move records when to look
 * again and why - see `statusNotes`. That repetition is the point of it: chasing is not a step
 * somebody passes through, it is a thing that happens until it stops being worth doing.
 */
const FOLLOW_UP_STATUS = "Follow Up";
const FORM_PENDING_STATUS = "Form Submission Pending";
const FORM_SUBMITTED_STATUS = "Form Submitted";
const INTERVIEW_SCHEDULED_STATUS = "Interview Scheduled";
const SELECTED_STATUS = "Selected";
/*
 * **Onboarded** - the offer was taken, and the candidate has actually started.
 *
 * It sits after Selected because the two are different answers and the gap between them is where
 * hiring most often goes wrong: somebody offered a job has not necessarily accepted it, and a
 * register that stopped at Selected could not tell an offer still out from one already turned up
 * for. That gap was being tracked in Remarks or in somebody's head.
 *
 * This is deliberately not "Joined", the word left off this list on the argument that somebody who
 * has joined is an employee read from the Employee Repository. That argument still holds for the
 * *employee* record and does not answer the hiring question: the register has to be able to say
 * that this application ended in somebody arriving, without waiting for a repository row to exist.
 */
const ONBOARDED_STATUS = "Onboarded";
const ON_HOLD_STATUS = "On Hold";
const REJECTED_STATUS = "Rejected";
const CANDIDATE_STATUSES = [
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

const INTERVIEW_MODES = ["In Person", "Google Meet", "Phone"];

/** The kind of engagement applied for - the one question every hiring form asks first. */
const EMPLOYMENT_TYPES = ["Full Time", "Part Time", "Intern", "Freelance"];

/*
 * ── Where an application came from ────────────────────────────────────────────────────────────
 *
 * The list itself is **not here**. It is master data the studio maintains - Settings → Fields →
 * Interview → Sources, the `interview_source` table - read through `optionLists.js` by the module's
 * options endpoint. It was an array on this line and a second copy of the same array in the
 * browser, which is two faults rather than one: a studio that started advertising somewhere new
 * could not say so, and the two copies could disagree about what the picker offered. Its starting
 * rows are `prisma/seeds/interview-sources.seed.js`.
 *
 * These two stay named here, and that is the distinction worth keeping: they are not choices
 * anybody makes, they are what the public application form and the sheet importer **stamp** on a
 * candidate, and what the code then compares against. A studio renaming a row in Field Settings
 * must not change what an importer writes.
 */
const SHEET_SOURCE = "Google sheet integration";
const APPLICATION_FORM_SOURCE = "Application Form";
/*
 * The other two ways a candidate reaches the register, stamped for the same reason the two above
 * are: **how a row got here is never nothing.**
 *
 * A candidate typed in by hand had a blank Source, so the column answered "where did this come
 * from?" for everything the sheet brought and for nothing anybody entered - and a register that
 * says nothing about the rows a person added is one where the column cannot be read at all.
 *
 * A **fallback**, never an override: somebody who names Naukri, a referral or a walk-in on the form
 * keeps it, exactly as a sheet row carrying its own Source column keeps that. These answer only
 * where the question was left blank.
 */
const MANUAL_SOURCE = "Manual entry";
const CSV_IMPORT_SOURCE = "CSV import";

/*
 * `DBS-INTV-000001`, in the shape every other business id in the studio wears. No vertical and no
 * branch - a candidate is the studio's, not a board's - and six digits like the leads it sits beside.
 * `INTV` rather than `CID`, for the reason `identifiers.js` gives for the call log: a code read out
 * over the phone must not sound like an Enquiry ID.
 */
const CANDIDATE_CODE_PREFIX = "DBS-INTV-";
const CANDIDATE_CODE_WIDTH = 6;
const CANDIDATE_CODE_PATTERN = /^DBS-INTV-(\d{6,})$/;
const CANDIDATE_SEQUENCE_KEY = "HRM_INTERVIEW_ID";

const formatCandidateCode = (value) => `${CANDIDATE_CODE_PREFIX}${String(Number(value) || 0).padStart(CANDIDATE_CODE_WIDTH, "0")}`;

/** The number inside a code this module issued, or 0 for anything else. */
function parseCandidateCode(code) {
  const match = CANDIDATE_CODE_PATTERN.exec(String(code || "").trim());
  return match ? Number(match[1]) : 0;
}

/** Lowercase alphanumerics only - the same blunt folding every sheet value here is compared with. */
const fold = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/*
 * The spellings a status arrives under from a sheet, folded onto the four above. A word the list
 * does not know is kept exactly as typed rather than refused or silently filed as the first stage:
 * it shows under All with a grey dot, which is the honest reading of a stage the studio has not
 * named here. The old names, New and Screening, fold onto the stages that replaced them.
 */
const STATUS_ALIASES = new Map([
  ["new", DEFAULT_CANDIDATE_STATUS], ["applied", DEFAULT_CANDIDATE_STATUS], ["fresh", DEFAULT_CANDIDATE_STATUS], ["open", DEFAULT_CANDIDATE_STATUS],
  ["yettoconnect", DEFAULT_CANDIDATE_STATUS], ["notcontacted", DEFAULT_CANDIDATE_STATUS], ["tocall", DEFAULT_CANDIDATE_STATUS],
  // Chasing somebody, under the words a spreadsheet writes it in. "callback" and "notreachable" fold
  // here too: both describe a candidate the studio is still trying to reach rather than a decision.
  ["followup", FOLLOW_UP_STATUS], ["follow", FOLLOW_UP_STATUS], ["following", FOLLOW_UP_STATUS],
  ["callback", FOLLOW_UP_STATUS], ["callagain", FOLLOW_UP_STATUS], ["notreachable", FOLLOW_UP_STATUS],
  ["noresponse", FOLLOW_UP_STATUS], ["nopickup", FOLLOW_UP_STATUS], ["didnotpick", FOLLOW_UP_STATUS],
  ["screening", FORM_PENDING_STATUS], ["screened", FORM_PENDING_STATUS], ["screen", FORM_PENDING_STATUS], ["telephonic", FORM_PENDING_STATUS],
  ["formsubmissionpending", FORM_PENDING_STATUS], ["formpending", FORM_PENDING_STATUS], ["formsent", FORM_PENDING_STATUS], ["applicationsent", FORM_PENDING_STATUS],
  ["formsubmitted", FORM_SUBMITTED_STATUS], ["submitted", FORM_SUBMITTED_STATUS], ["applicationreceived", FORM_SUBMITTED_STATUS], ["applicationsubmitted", FORM_SUBMITTED_STATUS],
  ["screeningformsent", FORM_PENDING_STATUS], ["screeningformpending", FORM_PENDING_STATUS], ["screeningformsubmitted", FORM_SUBMITTED_STATUS],
  ["interviewscheduled", INTERVIEW_SCHEDULED_STATUS], ["scheduled", INTERVIEW_SCHEDULED_STATUS], ["interviewfixed", INTERVIEW_SCHEDULED_STATUS], ["interviewbooked", INTERVIEW_SCHEDULED_STATUS],
  ["selected", SELECTED_STATUS], ["hired", SELECTED_STATUS], ["offered", SELECTED_STATUS], ["offerreleased", SELECTED_STATUS], ["offerextended", SELECTED_STATUS],
  /*
   * Onboarded: they took the offer and started.
   *
   * **Nothing for "joined"**, though it means the same thing in most spreadsheets - the argument
   * below about Shortlisted, Interviewed and Joined is unchanged, and folding a word this map has
   * always left alone would quietly move rows a studio had put somewhere on purpose. Worth asking
   * about rather than deciding here.
   */
  ["onboarded", ONBOARDED_STATUS], ["onboard", ONBOARDED_STATUS], ["onboarding", ONBOARDED_STATUS],
  ["onhold", ON_HOLD_STATUS], ["hold", ON_HOLD_STATUS], ["holded", ON_HOLD_STATUS], ["parked", ON_HOLD_STATUS],
  ["rejected", REJECTED_STATUS], ["reject", REJECTED_STATUS], ["notselected", REJECTED_STATUS], ["notsuitable", REJECTED_STATUS], ["notshortlisted", REJECTED_STATUS],
  /*
   * Nothing for Shortlisted, Interviewed or Joined, the three stages that are not on the list.
   *
   * None of them may be folded onto a stage that remains: reading "Interviewed" as Form Submitted
   * would move a candidate backwards, and reading it as Selected would answer a question nobody has
   * answered yet. They arrive as typed and show under All, which is what any unlisted stage does.
   *
   * Nothing for "declined" either, and deliberately. A candidate who declined an offer and one the
   * studio turned down are not the same row to anybody reading the register, and guessing which a
   * spreadsheet meant is the one mistake this map must not make.
   */
]);

/** A status as the module spells it, or the text exactly as it arrived where the list has no word for it. */
function normalizeCandidateStatus(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return STATUS_ALIASES.get(fold(text)) || text;
}

/** An employment type as the list spells it, or the text as it arrived. */
function normalizeEmploymentType(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const key = fold(text);
  const aliases = { fulltime: "Full Time", permanent: "Full Time", ft: "Full Time", parttime: "Part Time", pt: "Part Time", intern: "Intern", internship: "Intern", trainee: "Intern", freelance: "Freelance", freelancer: "Freelance", contract: "Freelance" };
  return EMPLOYMENT_TYPES.find((type) => fold(type) === key) || aliases[key] || text;
}

const isKnownStatus = (status) => CANDIDATE_STATUSES.includes(status);

module.exports = {
  CANDIDATE_STATUSES,
  ONBOARDED_STATUS,
  DEFAULT_CANDIDATE_STATUS,
  FOLLOW_UP_STATUS,
  FORM_PENDING_STATUS,
  FORM_SUBMITTED_STATUS,
  INTERVIEW_SCHEDULED_STATUS,
  SELECTED_STATUS,
  ON_HOLD_STATUS,
  REJECTED_STATUS,
  INTERVIEW_MODES,
  EMPLOYMENT_TYPES,
  SHEET_SOURCE,
  APPLICATION_FORM_SOURCE,
  MANUAL_SOURCE,
  CSV_IMPORT_SOURCE,
  CANDIDATE_CODE_PREFIX,
  CANDIDATE_CODE_PATTERN,
  CANDIDATE_SEQUENCE_KEY,
  formatCandidateCode,
  parseCandidateCode,
  normalizeCandidateStatus,
  normalizeEmploymentType,
  isKnownStatus,
  fold,
};
