/**
 * Project Management → Feedback's Give Feedback form, as data: the project it is for, the rating
 * and what the reviewer has to say.
 *
 * The project is not a field: feedback is given from a project's own Give Feedback, so the form
 * states that project - its Project Description, in the card Cash Spent shows (`RecordSummaryCard`) -
 * and nothing of it is asked. The ratings come from the server
 * (`GET /feedback/options`) through the form's `context`, so the list offered is the one it accepts.
 */

export const FEEDBACK_MAX_LENGTH = 5000;

/**
 * The Feedback page's status bar, in order - the server's `STATUSES` (feedback service). Every
 * feedback starts at the first; the bar opens on it.
 */
/** The reviews that are an issue - each needs somebody assigned to sort it out (the server's `ISSUE_REVIEWS`). */
export const ISSUE_REVIEWS = ["Average", "Poor"];

/**
 * The New Project Feedback's review: the server's key for it, the form field holding the rating, and
 * the field holding who it is assigned to when it is Average or Poor.
 */
export const FEEDBACK_REVIEW_FIELDS = [["REVIEW", "review", "reviewAssignee"]];

/**
 * **Assign to**, beside a review, asked only while that review is Average or Poor: who sorts it out.
 * Required then - the review becomes a task for them - and gone, and not required, otherwise.
 */
const assignField = (reviewField, name) => ({
  name,
  label: "Assign to",
  type: "select",
  required: true,
  placeholder: "Who sorts this out?",
  when: (values) => ISSUE_REVIEWS.includes(values?.[reviewField]),
  options: (values, context) => (Array.isArray(context?.assignees) ? context.assignees : []),
  props: { helperText: "They get it as a task, and answer it Issues sorted or Rejected." },
});

export const FEEDBACK_STATUSES = ["Yet to be done", "Issues", "Issues sorted", "Completed", "Rejected"];
export const DEFAULT_FEEDBACK_STATUS = FEEDBACK_STATUSES[0];

/** Where a feedback under Issues can be moved from its ⋮ menu - the server's `ISSUE_OUTCOMES`. */
export const FEEDBACK_ISSUE_OUTCOMES = ["Issues sorted", "Rejected"];

/** A row's status, with one written before statuses existed read as the first. */
export const feedbackStatusOf = (row) => (FEEDBACK_STATUSES.includes(row?.status) ? row.status : DEFAULT_FEEDBACK_STATUS);

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

/**
 * The project the feedback is for, as `[label, value]` rows for `RecordSummaryCard`, in the order
 * Cash Spent shows a project - and, for a shoot's feedback, the shoot after it. `project` is the
 * waiting row from the Yet to be done tab (`GET /feedback/pending`). An empty value is drawn as a
 * dash by the card.
 */
export function projectDescriptionRows(project) {
  if (!project) return [];
  return [
    ["Event ID", project.eventId],
    ["Project", project.projectName],
    ["Client Name", project.clientName],
    ["Project Status", project.projectStatus],
    ["Main Event Date", formatDate(project.eventDate)],
    ["Branch", project.branch],
    ["CRM", project.crmName],
    ...(project.shootKey ? [["Shoot ID", project.shootCode], ["Shoot", project.shootName], ["Shoot Date", formatDate(project.shootDate)]] : []),
  ];
}

export const feedbackSections = [
  {
    id: "feedback",
    title: "Feedback",
    fields: [
      // Drawn by the form (`context.renderers.projectDescription`): the project it was opened for.
      { name: "projectDescription", type: "custom", colSpan: 2 },
      {
        name: "review",
        label: "Review",
        type: "select",
        required: true,
        options: (values, context) => (Array.isArray(context?.reviews) ? context.reviews : []).map((review) => ({ value: review, label: review })),
        helperText: "How the client rated the work; Average or Poor asks who will sort it out.",
        // Best to worst, not alphabetical.
        props: { sorted: false },
      },
      assignField("review", "reviewAssignee"),
      {
        name: "feedback",
        label: "Feedback",
        type: "textarea",
        required: true,
        colSpan: 2,
        placeholder: "What went well, and what could be better?",
        helperText: "The client's comments in their own words, kept with this project's feedback.",
        props: { rows: 5, maxLength: FEEDBACK_MAX_LENGTH },
      },
    ],
  },
];

/** The shoot's people (`context.people`), less the ones already named in the other list. */
const peopleOptions = (otherList) => (values, context) => (Array.isArray(context?.people) ? context.people : [])
  .filter((option) => !(values?.[otherList] || []).includes(option.value));

/**
 * Shoot Completion Feedback, as data: the review and feedback every feedback asks, then the people the
 * client appreciates or is not satisfied with - picked from those who worked on that shoot
 * (`GET /feedback/projects/:id/people?shootId=`), and never the same person in both lists.
 */
export const shootCompletionSections = [
  ...feedbackSections,
  {
    id: "appreciation",
    title: "Appreciation",
    fields: [{
      name: "appreciatedEmployeeIds", label: "Employees Appreciated", type: "multiselect", colSpan: 2, placeholder: "Choose who to appreciate",
      options: peopleOptions("notSatisfiedEmployeeIds"),
      props: { helperText: "The people who worked on this shoot in Sales, Pre Production and Production. Someone chosen under Not Satisfied is not listed here." },
    }],
  },
  {
    id: "not-satisfied",
    title: "Not Satisfied",
    fields: [{
      name: "notSatisfiedEmployeeIds", label: "Employees Not Satisfied With", type: "multiselect", colSpan: 2, placeholder: "Choose who they were not satisfied with",
      options: peopleOptions("appreciatedEmployeeIds"),
      props: { helperText: "The people who worked on this shoot in Sales, Pre Production and Production. Someone chosen under Appreciation is not listed here." },
    }],
  },
];
