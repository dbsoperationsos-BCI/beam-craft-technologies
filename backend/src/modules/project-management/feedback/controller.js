const { z } = require("zod");
const { sendFeedbackWhatsApp, REVIEWS, OPEN_STAGES, ISSUE_OUTCOMES, listFeedback, pendingFeedback, feedbackOptions, createFeedback, createFeedbackMany, resolveIssue, shootPeople, feedbackAssignees } = require("./service");

const FEEDBACK_MAX_LENGTH = 5000;

// Somebody chosen twice is named once.
const employeeIds = z.array(z.coerce.number().int().positive(), { message: "Choose people from the list." }).max(50, "Name at most 50 people.")
  .transform((ids) => [...new Set(ids)]);

/*
 * What Give Feedback sends: the waiting project's key, which of its feedbacks it is (`stage`: New
 * Project when none is sent, Shoot Completion with the waiting shoot's key in `shootId`, or Overall),
 * one review and the feedback, and, for an Average or Poor review, who it is given to
 * (`assignees.REVIEW`, a login's id). A Shoot Completion Feedback may also name the people who
 * worked on the shoot that the client appreciates or is not satisfied with - never the same person
 * in both; which people may be named is the server's to check, against the shoot (`shootPeople`).
 * Unknown keys are dropped.
 */
const createSchema = z.object({
  projectId: z.string({ message: "Choose the project." }).trim().min(1, "Choose the project.").max(191),
  shootId: z.string({ message: "Choose the shoot." }).trim().min(1, "Choose the shoot.").max(191).optional(),
  review: z.enum(REVIEWS, { message: "Choose a review: Excellent, Good, Average or Poor." }),
  feedback: z.string({ message: "Write the feedback." }).trim().min(1, "Write the feedback.").max(FEEDBACK_MAX_LENGTH, `Keep the feedback under ${FEEDBACK_MAX_LENGTH} characters.`),
  assignees: z.object({ REVIEW: z.coerce.number().int().positive({ message: "Choose who to assign it to." }).optional() }).optional(),
  stage: z.enum(OPEN_STAGES, { message: "Choose which feedback this is." }).default("NEW_PROJECT"),
  appreciatedEmployeeIds: employeeIds.optional(),
  notSatisfiedEmployeeIds: employeeIds.optional(),
}).superRefine((input, ctx) => {
  // A shoot's feedback names its shoot, and only it does.
  if (input.stage === "SHOOT_COMPLETION" && !input.shootId) ctx.addIssue({ code: "custom", path: ["shootId"], message: "Choose the shoot." });
  if (input.stage !== "SHOOT_COMPLETION" && input.shootId) ctx.addIssue({ code: "custom", path: ["shootId"], message: "Only a Shoot Completion Feedback names a shoot." });
  const appreciated = new Set(input.appreciatedEmployeeIds || []);
  if ((input.notSatisfiedEmployeeIds || []).some((id) => appreciated.has(id))) ctx.addIssue({ code: "custom", path: ["notSatisfiedEmployeeIds"], message: "Somebody cannot be both appreciated and not satisfied with." });
});

/** The most rows one bulk request saves; the screen sends a larger selection in batches of this. */
const BULK_MAX_ITEMS = 500;

/*
 * What Give Feedback over ticked rows sends: the rows (`items`, each a waiting project's key, its
 * stage and, for a Shoot Completion Feedback, its shoot's key) and the review, feedback and
 * Average/Poor assignee shared by all of them. People appreciated or not satisfied with are a
 * single shoot's, so the bulk form never names them.
 */
const bulkItem = z.object({
  projectId: z.string({ message: "Choose the project." }).trim().min(1, "Choose the project.").max(191),
  shootId: z.string().trim().min(1).max(191).optional(),
  stage: z.enum(OPEN_STAGES, { message: "Choose which feedback this is." }).default("NEW_PROJECT"),
}).refine((item) => (item.stage === "SHOOT_COMPLETION") === Boolean(item.shootId), { message: "Only a Shoot Completion Feedback names a shoot, and it must." });
const bulkSchema = z.object({
  items: z.array(bulkItem, { message: "Tick the rows to give feedback to." }).min(1, "Tick the rows to give feedback to.").max(BULK_MAX_ITEMS, `Send at most ${BULK_MAX_ITEMS} rows at a time.`),
  review: z.enum(REVIEWS, { message: "Choose a review: Excellent, Good, Average or Poor." }),
  feedback: z.string({ message: "Write the feedback." }).trim().min(1, "Write the feedback.").max(FEEDBACK_MAX_LENGTH, `Keep the feedback under ${FEEDBACK_MAX_LENGTH} characters.`),
  assignees: z.object({ REVIEW: z.coerce.number().int().positive({ message: "Choose who to assign it to." }).optional() }).optional(),
});

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

async function list(req, res) {
  try {
    // Their own feedback, or everybody's with View All Feedback - decided in the service.
    return res.json({ data: await listFeedback({ userId: req.user.id }) });
  } catch (error) {
    return sendError(res, error, "Unable to load feedback.");
  }
}

async function pending(_req, res) {
  try {
    // Each project's open feedback stages not given yet - the Yet to be done tab's own rows.
    return res.json({ data: await pendingFeedback() });
  } catch (error) {
    return sendError(res, error, "Unable to load the projects waiting for feedback.");
  }
}

/** The people who worked on a shoot, by area - its Shoot Completion Feedback's Appreciation and Not Satisfied lists. */
async function people(req, res) {
  try {
    const data = await shootPeople(req.params.projectId, req.query.shootId);
    if (!data) return res.status(404).json({ message: "That shoot was not found on this project." });
    return res.json({ data });
  } catch (error) {
    return sendError(res, error, "Unable to load the shoot's people.");
  }
}

/** Who an Average or Poor review can be given to as a task: the active logins, with their photos. */
async function assignees(_req, res) {
  try {
    return res.json({ data: await feedbackAssignees() });
  } catch (error) {
    return sendError(res, error, "Unable to load who can be assigned.");
  }
}

async function options(_req, res) {
  try {
    return res.json({ data: feedbackOptions() });
  } catch (error) {
    return sendError(res, error, "Unable to load the reviews.");
  }
}

async function create(req, res) {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Validation failed", errors: parsed.error.flatten() });
  }
  try {
    const data = await createFeedback({ input: parsed.data, userId: req.user.id });
    return res.status(201).json({ data });
  } catch (error) {
    return sendError(res, error, "Unable to save the feedback.");
  }
}

/** Give Feedback over many ticked rows: `{ saved, refused }` - a refused row does not stop the rest. */
async function createMany(req, res) {
  const parsed = bulkSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Validation failed", errors: parsed.error.flatten() });
  }
  const { items, ...common } = parsed.data;
  try {
    const data = await createFeedbackMany({ items, common, userId: req.user.id });
    return res.status(201).json({ data });
  } catch (error) {
    return sendError(res, error, "Unable to save the feedback.");
  }
}

/** The longest remark kept when a feedback is moved on from Issues. */
const ISSUE_REMARKS_MAX_LENGTH = 1000;

/**
 * Where a feedback under Issues is moved to: Issues sorted or Rejected, and nothing else - with a
 * remark, which a rejection must give and Issues sorted may leave blank.
 */
const issueStatusSchema = z.object({
  status: z.enum(ISSUE_OUTCOMES, { message: "Choose Issues sorted or Rejected." }),
  remarks: z.string().trim().max(ISSUE_REMARKS_MAX_LENGTH, `Keep the remarks to ${ISSUE_REMARKS_MAX_LENGTH} characters.`).optional().default(""),
}).refine((input) => input.status !== "Rejected" || input.remarks, { message: "Give the reason for rejecting it.", path: ["remarks"] });

async function setIssueStatus(req, res) {
  const parsed = issueStatusSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Choose Issues sorted or Rejected." });
  try {
    return res.json({ data: await resolveIssue({ feedbackId: req.params.id, status: parsed.data.status, remarks: parsed.data.remarks, userId: req.user.id }) });
  } catch (error) {
    return sendError(res, error, "Unable to change the feedback's status.");
  }
}

// The client's answer to a feedback, on WhatsApp - the text the screen shows.
const sendWhatsAppSchema = z.object({ message: z.string({ message: "Write the message." }).trim().min(1, "Write the message.").max(4096) });
async function sendWhatsApp(req, res) {
  const parsed = sendWhatsAppSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Write the message." });
  try {
    await sendFeedbackWhatsApp({ feedbackId: req.params.id, message: parsed.data.message, userId: req.user.id });
    return res.json({ message: "Sent on WhatsApp to the client." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
    console.error("Unable to send the feedback message on WhatsApp:", error);
    return res.status(502).json({ message: "Unable to send this message on WhatsApp." });
  }
}

module.exports = { sendWhatsApp, list, pending, options, people, assignees, create, createMany, setIssueStatus, issueStatusSchema, createSchema, bulkSchema, BULK_MAX_ITEMS, FEEDBACK_MAX_LENGTH, ISSUE_REMARKS_MAX_LENGTH };
