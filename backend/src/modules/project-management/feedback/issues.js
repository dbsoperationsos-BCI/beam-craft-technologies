/*
 * Project Management → Feedback: the Average and Poor reviews, given to somebody to answer.
 *
 * Every review a feedback form asks for that comes back **Average or Poor** is assigned to a person
 * and becomes an HRM task for them (`project_feedback_issue`, keyed to its task). They answer it from
 * their Tasks - **Issues sorted** or **Rejected**, with a remark - and once every issue of a feedback
 * is answered, the feedback leaves Issues: for Rejected if any issue was rejected, else Issues sorted.
 *
 * A file of its own, kept free of the Tasks module and the feedback service, because both need it:
 * the feedback service writes the issues, the Tasks module answers them.
 */

/** The reviews that are an issue. */
const ISSUE_REVIEWS = ["Average", "Poor"];

/** The answers an issue takes, as the feedback page's statuses name them, and as stored. */
const ANSWERS = { "Issues sorted": "SORTED", Rejected: "REJECTED" };
const ANSWER_LABELS = { OPEN: "Open", SORTED: "Issues sorted", REJECTED: "Rejected" };

/**
 * The reviews a feedback asks for, by the key an issue is filed under, with the names they are read
 * by - the same ones the Give Feedback form shows.
 */
const REVIEW_LABELS = {
  REVIEW: "Review",
  SALES: "Sales",
  PRE_PRODUCTION: "Pre Production",
  PRODUCTION: "Production",
  POST_PRODUCTION: "Post Production",
  OVERALL_EXPERIENCE: "Overall Experience",
};

const REMARKS_MAX_LENGTH = 1000;

/** `{ outcome, remarks }` for an answer, or `{ problem }` saying what is wrong with it. */
function validAnswer(outcome, remarks) {
  if (!ANSWERS[outcome]) return { problem: "Choose Issues sorted or Rejected." };
  const text = String(remarks || "").trim();
  if (outcome === "Rejected" && !text) return { problem: "Give the reason for rejecting it." };
  if (text.length > REMARKS_MAX_LENGTH) return { problem: `Keep the remarks to ${REMARKS_MAX_LENGTH} characters.` };
  return { outcome, remarks: text };
}

/**
 * Answers one issue, inside `client`'s transaction, and moves its feedback out of Issues once it was
 * the last one open.
 *
 * Both writes are conditional: the issue only while it is still open, the feedback only while it is
 * still under Issues - so an issue answered twice at once is refused the second time, and a feedback
 * somebody moved by hand meanwhile is left where they put it.
 *
 * **The feedback is locked first.** Two people answering a feedback's last two issues at the same
 * moment would each see the other's still open and leave it in Issues for good. Touching the
 * feedback row before anything else - a write, so it takes the row's lock - makes the second wait
 * for the first to commit, and its read of the issues, the first plain read in its transaction, then
 * sees both answers. `issue` is `{ id, feedbackId }`, read before the transaction for that reason.
 */
async function answerIssue(client, issue, { outcome, remarks, userId }) {
  const now = new Date();
  await client.projectFeedback.updateMany({ where: { id: issue.feedbackId }, data: { updatedAt: now } });
  const { count } = await client.projectFeedbackIssue.updateMany({
    where: { id: issue.id, status: "OPEN" },
    data: { status: ANSWERS[outcome], remarks: remarks || null, answeredByUserId: userId, answeredAt: now },
  });
  if (!count) throw Object.assign(new Error("This feedback issue has already been answered."), { status: 409 });

  const issues = await client.projectFeedbackIssue.findMany({ where: { feedbackId: issue.feedbackId }, orderBy: { id: "asc" } });
  if (issues.some((row) => row.status === "OPEN")) return;

  const rejected = issues.some((row) => row.status === "REJECTED");
  await client.projectFeedback.updateMany({
    where: { id: issue.feedbackId, status: "Issues" },
    data: {
      status: rejected ? "Rejected" : "Issues sorted",
      // Every answer, one line each, so the feedback reads what each person said.
      issueRemarks: issues.map((row) => `${REVIEW_LABELS[row.reviewKey] || row.reviewKey} - ${ANSWER_LABELS[row.status]}${row.remarks ? `: ${row.remarks}` : ""}`).join("\n"),
      issueResolvedByUserId: userId,
      issueResolvedAt: now,
    },
  });
}

/** An issue as a task row carries it, or null for a task that is not one. */
function issueOnTask(issue) {
  if (!issue) return null;
  const feedback = issue.projectFeedback;
  return {
    id: issue.id,
    review: issue.review,
    reviewLabel: REVIEW_LABELS[issue.reviewKey] || issue.reviewKey,
    status: issue.status,
    statusLabel: ANSWER_LABELS[issue.status] || issue.status,
    remarks: issue.remarks || "",
    feedbackCode: feedback?.feedbackCode || "",
    eventId: feedback?.project?.eventId || "",
    projectName: feedback?.project?.whatsappGroupName || "",
    // A Shoot Completion Feedback's shoot, so two shoots of one project read apart.
    shootCode: feedback?.shoot?.shootId || "",
  };
}

module.exports = { ISSUE_REVIEWS, ANSWERS, ANSWER_LABELS, REVIEW_LABELS, REMARKS_MAX_LENGTH, validAnswer, answerIssue, issueOnTask };
