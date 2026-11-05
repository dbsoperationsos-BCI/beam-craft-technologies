/**
 * One project's feedback, read back in the Feedback page's info panel and View: the project, then
 * each of its feedbacks in the order the studio asks for them (the server's `FEEDBACK_STAGES`).
 *
 * A row on the page is one feedback of one project, so what is shown for it is put together from the
 * rows the page holds for the same project: a feedback given is shown in full, and one still waiting
 * reads "Yet to be done". A project has one New Project Feedback, a Shoot Completion Feedback for
 * each shoot Production has completed - a section per shoot, named by its Shoot ID - and one Overall
 * Feedback once Production has completed them all, shown once it waits or is given. Production
 * Completion and Project Completed Feedback are no longer asked for; one given before they were
 * removed is shown, and one never given is left out.
 */

export const FEEDBACK_STAGE_SECTIONS = [
  { stage: "NEW_PROJECT", title: "New Project Feedback" },
  { stage: "SHOOT_COMPLETION", title: "Shoot Completion Feedback", perShoot: true },
  { stage: "OVERALL", title: "Overall Feedback" },
  { stage: "PRODUCTION_COMPLETION", title: "Production Completion Feedback" },
  { stage: "PROJECT_COMPLETED", title: "Project Completed Feedback" },
];

export const FEEDBACK_PROJECT_FIELDS = [
  ["eventId", "Event ID"],
  ["eventDate", "Event Date", "date"],
  ["projectName", "Project"],
  ["clientName", "Client Name"],
  ["projectStatus", "Project Status"],
  ["branch", "Branch"],
  ["crmName", "CRM"],
];

/** A given feedback's fields. The last three only once it has been moved on from Issues. */
export const FEEDBACK_GIVEN_FIELDS = [
  ["feedbackCode", "Feedback ID"],
  ["status", "Status"],
  // Each Average or Poor review: who it was given to, where their task stands, and the outcome
  // (`issueFieldsFor`) - in place of this one entry.
  ["issuesSummary", "Assigned Issues", "multiline"],
  ["review", "Review"],
  ["feedback", "Feedback", "multiline"],
  ["givenBy", "Given By"],
  ["createdAt", "Given On", "date"],
  ["issueRemarks", "Remarks", "multiline"],
  ["issueResolvedBy", "Decided By"],
  ["issueResolvedAt", "Decided On", "date"],
];
/** A given Production Completion Feedback's fields: each area, the referral, and the people named. */
export const PRODUCTION_COMPLETION_FIELDS = [
  ["feedbackCode", "Feedback ID"],
  ["status", "Status"],
  // Each Average or Poor review: who it was given to, where their task stands, and the outcome
  // (`issueFieldsFor`) - in place of this one entry.
  ["issuesSummary", "Assigned Issues", "multiline"],
  ["salesReview", "Sales Review"],
  ["salesFeedback", "Sales Feedback", "multiline"],
  ["preProductionReview", "Pre Production Review"],
  ["preProductionFeedback", "Pre Production Feedback", "multiline"],
  ["productionReview", "Production Review"],
  ["productionFeedback", "Production Feedback", "multiline"],
  ["referralName", "Referral Name"],
  ["referralMobile", "Referral Mobile"],
  ["appreciated", "Appreciation", "multiline"],
  ["notSatisfied", "Not Satisfied", "multiline"],
  ["givenBy", "Given By"],
  ["createdAt", "Given On", "date"],
  ["issueRemarks", "Remarks", "multiline"],
  ["issueResolvedBy", "Decided By"],
  ["issueResolvedAt", "Decided On", "date"],
];
/** A given Project Completed Feedback's fields: Post Production, the Overall Experience and the Suggestion. */
export const PROJECT_COMPLETED_FIELDS = [
  ["feedbackCode", "Feedback ID"],
  ["status", "Status"],
  // Each Average or Poor review: who it was given to, where their task stands, and the outcome
  // (`issueFieldsFor`) - in place of this one entry.
  ["issuesSummary", "Assigned Issues", "multiline"],
  ["postProductionReview", "Post Production Review"],
  ["postProductionFeedback", "Post Production Feedback", "multiline"],
  ["overallExperience", "Overall Experience"],
  ["suggestion", "Suggestion", "multiline"],
  ["givenBy", "Given By"],
  ["createdAt", "Given On", "date"],
  ["issueRemarks", "Remarks", "multiline"],
  ["issueResolvedBy", "Decided By"],
  ["issueResolvedAt", "Decided On", "date"],
];
const OUTCOME_KEYS = ["issueRemarks", "issueResolvedBy", "issueResolvedAt"];

/** The shoot a Shoot Completion Feedback is about, first in its section. */
const FEEDBACK_SHOOT_FIELDS = [
  ["shootCode", "Shoot ID"],
  ["shootName", "Shoot"],
  ["shootDate", "Shoot Date", "date"],
];

/** What is shown of each assigned issue: who has it, where their task stands, and how it ended. */
const ISSUE_FIELDS = [
  ["assignedTo", "Assigned To"],
  ["taskStatus", "Task Status"],
  ["taskCode", "Task ID"],
  ["status", "Outcome"],
  ["remarks", "Remarks", "multiline"],
];

/**
 * A stage's assigned issues - each Average or Poor review given to somebody as a task - as fields of
 * their own rather than one line: **Assigned To**, **Task Status** (the task's own progress, Pending
 * to Completed), **Task ID**, **Outcome** (Open, Issues sorted, Rejected) and their Remarks once
 * written. One issue reads under those plain labels; several are each named by the review they are
 * about ("Sales (Poor) - Assigned To"), so it is clear whose is whose.
 */
export function issueFieldsFor(stage, issues) {
  const list = Array.isArray(issues) ? issues : [];
  const named = list.length > 1;
  const fields = [];
  const values = {};
  list.forEach((issue, index) => {
    const prefix = named ? `${issue.reviewLabel} (${issue.review}) - ` : "";
    for (const [key, label, type] of ISSUE_FIELDS) {
      if (key === "remarks" && !issue.remarks) continue;
      const id = `${stage}.issue${index}.${key}`;
      values[id] = key === "assignedTo" ? issue.assignedTo || "Nobody" : issue[key];
      fields.push(type ? [id, `${prefix}${label}`, type] : [id, `${prefix}${label}`]);
    }
  });
  return { fields, values };
}
/** A given Shoot Completion Feedback's fields: every feedback's, with the people it names after the words. */
export const SHOOT_COMPLETION_FIELDS = FEEDBACK_GIVEN_FIELDS.flatMap((field) => (field[0] === "feedback"
  ? [field, ["appreciated", "Appreciation", "multiline"], ["notSatisfied", "Not Satisfied", "multiline"]]
  : [field]));
const GIVEN_FIELDS = { SHOOT_COMPLETION: SHOOT_COMPLETION_FIELDS, PRODUCTION_COMPLETION: PRODUCTION_COMPLETION_FIELDS, PROJECT_COMPLETED: PROJECT_COMPLETED_FIELDS };
const ISSUE_OUTCOMES = ["Issues sorted", "Rejected"];

/**
 * `{ entity, sections }` for `row`, from `rows` - everything the page holds. A stage's fields are
 * keyed `<STAGE>.<field>` on the entity, so two stages of one project never share a value.
 */
export function feedbackRecordFor(row, rows = []) {
  if (!row) return { entity: null, sections: [] };
  const entity = { id: row.id };
  for (const [key] of FEEDBACK_PROJECT_FIELDS) entity[key] = row[key];
  const sections = [{ title: "Project", fields: FEEDBACK_PROJECT_FIELDS }];
  const sameProject = (other) => other.projectKey === row.projectKey;

  // One feedback's section, its fields keyed `<prefix>.<field>` on the entity - the stage, or the
  // stage and shoot - so two feedbacks of one project never share a value.
  const addSection = (prefix, title, found, lead = []) => {
    const shown = [];
    for (const [key, label, type] of lead) {
      entity[`${prefix}.${key}`] = found[key];
      shown.push(type ? [`${prefix}.${key}`, label, type] : [`${prefix}.${key}`, label]);
    }
    if (found.pending) {
      entity[`${prefix}.status`] = "Yet to be done";
      sections.push({ title, fields: [...shown, [`${prefix}.status`, "Status"]] });
      return;
    }
    const given = GIVEN_FIELDS[found.stage] || FEEDBACK_GIVEN_FIELDS;
    const fields = given.filter(([key]) => !OUTCOME_KEYS.includes(key) || ISSUE_OUTCOMES.includes(found.status));
    for (const [key, label, type] of fields) {
      // The issues, each as its own fields, where the one-line summary used to be.
      if (key === "issuesSummary") {
        const issues = issueFieldsFor(prefix, found.issues);
        Object.assign(entity, issues.values);
        shown.push(...issues.fields);
        continue;
      }
      entity[`${prefix}.${key}`] = found[key];
      shown.push(type ? [`${prefix}.${key}`, label, type] : [`${prefix}.${key}`, label]);
    }
    sections.push({ title, fields: shown });
  };

  for (const { stage, title, perShoot } of FEEDBACK_STAGE_SECTIONS) {
    if (perShoot) {
      // Each shoot once - given before waiting, the row opened before the rest - by its shoot date.
      const byShoot = new Map();
      for (const other of [row, ...rows.filter((entry) => !entry.pending), ...rows.filter((entry) => entry.pending)]) {
        if (sameProject(other) && other.stage === stage && other.shootKey && !byShoot.has(other.shootKey)) byShoot.set(other.shootKey, other);
      }
      const shoots = [...byShoot.values()].sort((a, b) => String(a.shootDate || "").localeCompare(String(b.shootDate || "")));
      for (const found of shoots) addSection(`${stage}.${found.shootKey}`, `${title} - ${found.shootCode || "Shoot"}`, found, FEEDBACK_SHOOT_FIELDS);
      continue;
    }
    const found = row.stage === stage ? row
      : rows.find((other) => sameProject(other) && other.stage === stage && !other.pending)
        || rows.find((other) => sameProject(other) && other.stage === stage && other.pending);
    if (!found) {
      // New Project Feedback is asked of every project: absent here - neither waiting nor given - it
      // was given by somebody whose feedback this reader is not shown. A later stage never given is
      // no longer asked for, so it is left out.
      if (stage === "NEW_PROJECT") {
        entity[`${stage}.status`] = "Given - not shown to you";
        sections.push({ title, fields: [[`${stage}.status`, "Status"]] });
      }
      continue;
    }
    addSection(stage, title, found);
  }
  return { entity, sections };
}
