"use client";

import HelpTip from "@/components/shared/HelpTip";
import RepeatableDetailsField from "@/components/shared/RepeatableDetailsField";
import RepeatableTextList from "@/components/shared/RepeatableTextList";
import TextField from "@/components/shared/TextField";
import interviewInfoFormatters from "@/components/hrm/interviewInfoFormatters";
import { detailListErrors, employeeDetailLists } from "@/constants/employeeDetailFields";
import { EXPERIENCED, EXPERIENCE_LEVELS, FRESHER, IMMEDIATE_JOIN, MAX_PORTFOLIO_LINKS, NOTICE_PERIODS, totalExperienceFrom } from "@/constants/interviewApplicationConfig";
import {
  CANDIDATE_STATUSES,
  DEFAULT_CANDIDATE_STATUS,
  EMPLOYMENT_TYPES,
  FOLLOW_UP_STATUS,
  INTERVIEW_MODES,
} from "@/constants/interviewConfig";
import { parseDateKey } from "@/components/shared/CalendarPanel";

/**
 * Everything the candidate record's form needs that is not the shell it is drawn in.
 *
 * It was all inside the side drawer `InterviewCandidateFormPanel`, which the candidate popup
 * replaces. Moving it here rather than copying it is the point: the four sections of
 * `candidateFormSections` do not work from the section list alone - they need the eleven option lists
 * with their fallbacks, the four custom controls, the required-field rules, and the payload shaping
 * that keeps an update from blanking columns the form does not draw. A screen that had the sections
 * and not this apparatus would look right and quietly destroy imported answers on the first save.
 */

/*
 * The four fields this record holds that are not a box: the candidate's education, their work
 * history, their links, and what they attached.
 *
 * The first three are the **same controls the application form draws them with** - that is the
 * whole point of the record mirroring the form, and it is why the two entry lists are the employee
 * record's own shared descriptions rather than anything defined here. The fourth is read-only: HR
 * replaces a file by asking for a new form rather than uploading on the candidate's behalf, so the
 * list opens each one and offers no control to change it.
 */
/* `{ record key: the shared description it is drawn from }` - the register names these two columns
   for what they hold, the employee lists for what they ask. */
const ENTRY_LISTS = { educationEntries: "qualifications", experienceEntries: "experiences" };

/* The ⓘ beside each custom control's label, where the section list does not give one of its own. */
const CUSTOM_HELP = {
  educationEntries: "Each qualification the candidate listed, with the institution and year.",
  experienceEntries: "Each past job the candidate listed, with the role and how long.",
  portfolioLinks: "Links to the candidate's work, such as a portfolio or Instagram page.",
  attachments: "Files the candidate sent with the form; open one to read it.",
  resumeUrl: "Opens their résumé; correct the link below if an import put it wrong.",
};
const helpFor = (field, name) => field?.helperText || CUSTOM_HELP[name] || "";

const entryListRenderers = Object.fromEntries(Object.entries(ENTRY_LISTS).map(([name, list]) => [name, ({ values, onChange, field, error }) => <RepeatableDetailsField
  {...employeeDetailLists[list].props}
  // The shared lists' hint speaks to the candidate filling them in; HR reading the record gets
  // CUSTOM_HELP's sentence as the ⓘ instead, not both.
  hint=""
  helperText={helpFor(field, name)}
  required={field?.required}
  value={values[name] || []}
  errors={error && typeof error === "object" ? error : {}}
  error={typeof error === "string" ? error : ""}
  onChange={onChange}
/>]));

export const candidateRenderers = {
  ...entryListRenderers,
  portfolioLinks: ({ values, onChange, field, error }) => <RepeatableTextList
    label={<>{field?.label || "Portfolio / Links"}<HelpTip text={helpFor(field, "portfolioLinks")} /></>}
    max={MAX_PORTFOLIO_LINKS}
    rowLabel={(index) => `Link ${index + 1}`}
    addAriaLabel="Add another link"
    placeholder="https://"
    value={values.portfolioLinks || []}
    errors={error && typeof error === "object" ? error : {}}
    error={typeof error === "string" ? error : ""}
    onChange={onChange}
  />,
  /*
   * Read, not edited - and drawn by the same formatter the info panel and the record view use, so
   * an attachment reads the same wherever a candidate is opened.
   */
  attachments: ({ values, field }) => <div>
    <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{field?.label || "Other Attachments"}<HelpTip text={helpFor(field, "attachments")} /></p>
    <div className="mt-1.5 text-xs font-normal text-slate-700 sm:text-sm">
      {interviewInfoFormatters.attachments(values.attachments)}
    </div>
  </div>,
  /*
   * The résumé: the document to open, and under it the address it lives at.
   *
   * Both, because this screen does both jobs - a résumé is read rather than proof-read, and this
   * record is also where a row imported with the link in the wrong column is put right. The link is
   * drawn by the same formatter the attachments use, so the two read alike.
   */
  resumeUrl: ({ values, onChange, field }) => <div>
    <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{field?.label || "Resume"}<HelpTip text={helpFor(field, "resumeUrl")} /></p>
    <div className="mt-1.5 text-xs font-normal text-slate-700 sm:text-sm">
      {interviewInfoFormatters.attachments(values.resumeUrl ? [{ name: "Open résumé", url: values.resumeUrl }] : [])}
    </div>
    <TextField
      label=""
      className="mt-2"
      placeholder="https://"
      value={values.resumeUrl || ""}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>,
  /*
   * What the register keeps as Experience, read back rather than typed - the application form's own
   * readout. A fresher reads "Fresher"; somebody experienced reads what their rows add up to, or
   * the column's own text where a sheet wrote something the rows do not account for.
   */
  experience: ({ values, field }) => <TextField
    label={field?.label || "Total Experience"}
    helperText={field?.helperText || "Worked out from the experience answer and rows; it cannot be typed."}
    value={values.experienceLevel === EXPERIENCED
      ? (totalExperienceFrom(values.experienceEntries) || values.experience || "")
      : (values.experienceLevel || values.experience || "")}
    onChange={() => {}}
    readOnly
    placeholder="From the answer and the rows"
  />,
};

/**
 * The option lists every picker on the record draws from, with **whatever this candidate already
 * holds added back**.
 *
 * That last part is what this screen needs more than any other in the register: a sheet's own word
 * for a stage, a position nobody has on the designation list, a source since renamed in Field
 * Settings. None of it may be silently dropped by an edit, so a stored value the list does not carry
 * is appended to the list rather than left to render as a blank picker.
 */
export function buildCandidateContext({ options = {}, candidate }) {
  const withCurrent = (list, current) => (current && !list.includes(current) ? [...list, current] : list);
  return {
    options: {
      statuses: withCurrent(options.statuses?.length ? options.statuses : CANDIDATE_STATUSES, candidate?.status),
      modes: withCurrent(options.modes?.length ? options.modes : INTERVIEW_MODES, candidate?.interviewMode),
      sources: withCurrent(options.sources || [], candidate?.source),
      employmentTypes: withCurrent(options.employmentTypes?.length ? options.employmentTypes : EMPLOYMENT_TYPES, candidate?.employmentType),
      positions: withCurrent(options.positions || [], candidate?.position),
      departments: withCurrent(options.departments || [], candidate?.department),
      branches: withCurrent(options.branches || [], candidate?.branch),
      genders: withCurrent(options.genders || [], candidate?.gender),
      /*
       * The application form's own bands and its "Immediate", offered as comboboxes so a value
       * neither list carries - a sheet's "45-60 days", a CSV's own wording - is shown back and kept
       * rather than blanked by the save.
       */
      noticePeriods: withCurrent(NOTICE_PERIODS, candidate?.noticePeriod),
      joiningAnswers: withCurrent([IMMEDIATE_JOIN], candidate?.availableFrom),
      experienceLevels: EXPERIENCE_LEVELS,
    },
    renderers: candidateRenderers,
  };
}

/** What the server would refuse, asked first so the answer lands on the field itself. */
export function validateCandidate(values) {
  const found = {};
  if (!String(values.name || "").trim()) found.name = "Enter the candidate's name.";
  if (!String(values.phone || "").trim()) found.phone = "Enter the candidate's phone number.";
  /* No `position` here. The server takes it as optional (`position: optional(150)`), and the studio
     regularly writes a candidate down before anybody knows which job they are after. */
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email).trim())) found.email = "Enter a valid email address.";
  if (!values.status) found.status = "Choose a status.";
  /*
   * Follow Up is a promise to call back, so it needs the day of the call - a real one, read the way
   * the date field reads it (`parseDateKey`). The server refuses the same (`followUpDateProblem`);
   * asked here so the error lands under the field rather than after a round trip. No other stage
   * asks for a date.
   */
  if (values.status === FOLLOW_UP_STATUS) {
    const date = String(values.nextFollowUpDate || "").trim();
    if (!date) found.nextFollowUpDate = "Next follow-up date is required for Follow Up stage.";
    else if (!parseDateKey(date)) found.nextFollowUpDate = "Enter a valid next follow-up date.";
  }
  /*
   * The two lists' rows, judged the way the application and employee forms judge them - a row
   * started and not finished (no Degree, no Company Name) is marked on the row. Blank rows are
   * not judged, and experience only while the list is on screen (Experienced).
   */
  Object.entries(ENTRY_LISTS)
    .filter(([name]) => name !== "experienceEntries" || values.experienceLevel === EXPERIENCED)
    .forEach(([name, list]) => {
      const problems = detailListErrors(list, values[name] || []);
      if (Object.keys(problems).length) found[name] = problems;
    });
  return found;
}

/**
 * What a save actually sends, which is not the draft.
 *
 * `PUT /candidates/:id` is **not partial** - `prepareValues` writes every column it is given a key
 * for - so three things have to be right or an ordinary edit destroys data:
 *
 *   * **Experience** is written the way the application form writes it. Fresher is the word;
 *     Experienced is what the rows add up to - *unless there are no rows*, where the column's own
 *     text is kept instead, because a sheet's "2-3 yrs" is a real answer and replacing it with ""
 *     would be this screen destroying an import.
 *   * **`experienceLevel` and `attachments` are taken out.** Neither is a column the update takes:
 *     the first is a branch the form reasons with, the second is read-only on this screen.
 *   * **The interviewer is carried straight back.** No screen asks for one - the studio has one HR -
 *     but a linked sheet's assignment rules fill it in, and omitting the keys would blank what they
 *     wrote on the first edit anybody made.
 */
export function candidatePayload({ values, candidate }) {
  const experienced = values.experienceLevel === EXPERIENCED;
  const summed = totalExperienceFrom(values.experienceEntries);
  const experience = values.experienceLevel
    ? (experienced ? (summed || candidate?.experience || "") : FRESHER)
    : (candidate?.experience || "");

  return {
    ...values,
    experience,
    experienceLevel: undefined,
    attachments: undefined,
    name: String(values.name || "").trim(),
    interviewerEmployeeId: candidate?.interviewerEmployeeId ?? null,
    interviewer: candidate?.interviewer || null,
    status: values.status || candidate?.status || DEFAULT_CANDIDATE_STATUS,
  };
}
