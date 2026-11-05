const { z } = require("zod");
const multer = require("multer");
const service = require("./service");
const { dashboardQuerySchema } = require("../../../services/dashboardRange");
const { taskDashboard } = require("./dashboard");

/**
 * Validation, status codes, and nothing else - the lifecycle itself is `service.js`.
 *
 * The three list views are three handlers rather than one reading a `scope` from the query string,
 * because the scope is what decides which permission the route needed. A single handler taking
 * `?scope=all` would have put that choice in the caller's hands, below the guard that was chosen
 * for it.
 */

const trimmed = (max) => z.string().trim().min(1).max(max);

/*
 * Everything a task says about itself, shared by raising one and correcting one.
 *
 * Kept as the bare object so both schemas can be built from it: `.superRefine` returns a
 * `ZodEffects`, which has no `.omit`, so deriving the edit from the finished create schema is not
 * possible. One definition either way, which is the point - a field added to a task has to appear
 * on both forms or on neither.
 */
const taskFields = z.object({
  assignedToUserId: z.coerce.number().int().positive(),
  title: trimmed(200),
  description: trimmed(5000),
  // Checked against the studio's own list rather than a set built at require time, exactly as the
  // department and branch below are - a type added this morning must not be refused. Async, which
  // is what makes the parses of this schema `safeParseAsync`.
  taskType: trimmed(120).refine(
    async (value) => (await service.taskTypeNames()).includes(value),
    { message: "Choose a task type" },
  ),
  // Optional in the shape and required by the refinement below, because whether it is required is
  // the type's answer, not the field's - "" is what the form sends for a field it never showed.
  taskTypeOther: z.string().trim().max(120).optional().nullable().transform((value) => value || null),
  priority: z.enum(service.PRIORITIES),
  // Free-shaped here and checked against the live lists in the service, because both come from
  // master data the studio edits - an enum built at require time would refuse a department added
  // this morning.
  department: trimmed(120),
  branch: trimmed(120),
  /*
   * Required, which it was not.
   *
   * A task with no due date is in nobody's "due this week" and nothing chases it - it sits in the
   * list being neither done nor overdue, which is the state the studio asked to stop creating. The
   * form sends "" for a date nobody filled in, so the emptiness is refused here rather than
   * transformed to null and stored.
   */
  dueOn: trimmed(40).refine(
    // A length check alone let anything through: `new Date("next friday")` is an Invalid Date, which
    // reaches Prisma and comes back a 500 rather than the 400 that says which field was wrong. The
    // form sends a day key, so that is what is accepted.
    (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime()),
    { message: "Give the due date as YYYY-MM-DD." },
  ),
});

/*
 * A type that does not describe itself has to be described, or the list reads "Other" with nothing
 * behind it. Which types those are is `asks_for_details` on the row rather than the literal word
 * "Other", so the studio can rename it or name a second one. Refused here as well as on the form,
 * since the form is not the only caller - and applied to both schemas, because an edit can change
 * the type as easily as a create can choose it.
 */
const refineTaskTypeDetail = async (values, ctx) => {
  if ((await service.taskTypesAskingForDetails()).includes(values.taskType) && !values.taskTypeOther) {
    ctx.addIssue({ code: "custom", path: ["taskTypeOther"], message: "Say what kind of task this is." });
  }
};

const createSchema = taskFields.superRefine(refineTaskTypeDetail);

/*
 * Correcting a task, which is every field above except who it is for.
 *
 * Handing a task to somebody else is a real event in its life - the holder chain records it and the
 * new holder is told - so it is `POST /:id/reassign` and not a field on this form. Editing the
 * assignee here would be a second, quieter way of doing something the module already does properly.
 */
const updateSchema = taskFields.omit({ assignedToUserId: true }).superRefine(refineTaskTypeDetail);

/*
 * Reassigning: who it goes to, and why it is leaving.
 *
 * Both required. The reason is what a reassignment *is* — the next person is being handed work with
 * no history of their own, and the sentence explaining why is the only thing that lets them pick it
 * up — and without somebody to go to there is nothing to reassign it to.
 */
const reassignSchema = z.object({
  assignedToUserId: z.coerce.number().int().positive(),
  reason: trimmed(1000),
});
const cancelSchema = z.object({ reason: z.string().trim().max(1000).optional().nullable() });
// Revoking may name who it goes to next; left out, it comes back to whoever assigned it.
const revokeSchema = cancelSchema.extend({ assignedToUserId: z.coerce.number().int().positive().optional().nullable() });

function fail(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

/*
 * One file at a time, held in memory on the way to the bucket.
 *
 * Memory rather than a temporary file because nothing here touches the disk: the buffer goes
 * straight to R2 and is dropped. 15MB is the brief, the reference shot and the spreadsheet a task
 * is done from - a video belongs in Image Selection, which is built for it.
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/**
 * Multer's own refusals, answered in this module's shape.
 *
 * Without this an oversized file reaches the shared error handler as a 500, and the reader is told
 * the studio broke rather than that their file is too big.
 */
function uploadSingle(req, res, next) {
  return upload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "That file is larger than 15MB." });
    return res.status(400).json({ message: "That file could not be read." });
  });
}

function attachmentId(req, res) {
  const id = Number.parseInt(req.params.attachmentId, 10);
  if (Number.isInteger(id) && id > 0) return id;
  res.status(400).json({ message: "That is not a valid attachment id." });
  return null;
}

function taskId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isInteger(id) && id > 0) return id;
  res.status(400).json({ message: "That is not a valid task id." });
  return null;
}

/** The pickers the create form needs: who a task can go to, and the kinds a task can be. */
async function options(req, res) {
  try {
    return res.json({
      data: {
        users: await service.assignableUsers(),
        taskTypes: await service.taskTypeNames(),
        // Which of them ask what the work actually was. Sent with the list rather than worked out in
        // the browser, so the form asks for exactly what this endpoint would refuse without.
        taskTypesAskingForDetails: await service.taskTypesAskingForDetails(),
        priorities: service.PRIORITIES,
        statuses: service.STATUSES,
        departments: await service.taskDepartments(),
        branches: await service.taskBranches(),
      },
    });
  } catch (error) {
    return fail(res, error, "Unable to load the task options.");
  }
}

/** My Tasks: what this person has been asked to do. Scoped to them, so it needs no more permission. */
async function listMine(req, res) {
  try {
    return res.json({ data: await service.listTasks({ scope: "mine", userId: req.user.id, role: req.user.role, status: String(req.query.status || "").trim() }) });
  } catch (error) {
    return fail(res, error, "Unable to load your tasks.");
  }
}

/** Tasks Given: what this person has asked of others. */
async function listGiven(req, res) {
  try {
    return res.json({ data: await service.listTasks({ scope: "given", userId: req.user.id, role: req.user.role, status: String(req.query.status || "").trim() }) });
  } catch (error) {
    return fail(res, error, "Unable to load the tasks you have given.");
  }
}

/** All Tasks: the whole studio's list, behind `HRM / All Tasks` on the route. */
/** The Dashboard: the reader's own tasks as figures, over the range picked. */
async function dashboard(req, res) {
  const parsed = dashboardQuerySchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ message: "Choose a range the dashboard offers." });
  try {
    return res.json({ data: await taskDashboard({ userId: req.user.id, range: parsed.data.range, canSeeAll: Boolean(req.canSeeAll) }) });
  } catch (error) {
    return fail(res, error, "Unable to load the task dashboard.");
  }
}

async function listAll(req, res) {
  try {
    return res.json({ data: await service.listTasks({ scope: "all", userId: req.user.id, role: req.user.role, status: String(req.query.status || "").trim() }) });
  } catch (error) {
    return fail(res, error, "Unable to load the studio's tasks.");
  }
}

/**
 * One task with its history.
 *
 * `req.canSeeAll` is set by the route from the `HRM / All Tasks` permission, so a supervisor can
 * open a task they are neither side of - and everybody else gets the same 404 for a task that is
 * not theirs as for one that does not exist.
 */
async function getTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  try {
    return res.json({ data: await service.getTask(id, req.user.id, Boolean(req.canSeeAll), req.user.role) });
  } catch (error) {
    return fail(res, error, "Unable to load that task.");
  }
}

async function createTask(req, res) {
  // `safeParseAsync`, because the task type is checked against the studio's own list. The two
  // parses below stay synchronous: neither schema reads a list.
  const parsed = await createSchema.safeParseAsync(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Check the task details and try again.", errors: parsed.error.flatten() });
  try {
    return res.status(201).json({ data: await service.createTask(parsed.data, req.user) });
  } catch (error) {
    return fail(res, error, "Unable to create that task.");
  }
}

/**
 * Correcting what a task says - the giver's, and a Super Admin's.
 *
 * `PATCH` rather than a verb under `/:id`, because unlike start, complete, reassign and cancel this
 * is not something that happens *to* a task: it is the record being brought in line with what was
 * always meant. The service decides who may, through the same `refusalFor` the other verbs use.
 */
async function updateTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  // `safeParseAsync` for the same reason the create uses it: the task type is checked against the
  // studio's own list.
  const parsed = await updateSchema.safeParseAsync(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Check the task details and try again.", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await service.updateTask(id, parsed.data, req.user, { canSeeAll: Boolean(req.canSeeAll) }) });
  } catch (error) {
    return fail(res, error, "Unable to update that task.");
  }
}

/** The receiver picking a task up. Its own verb because it is a state change, not an edit. */
async function startTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  try {
    return res.json({ data: await service.transition(id, "start", req.user, { canSeeAll: Boolean(req.canSeeAll) }) });
  } catch (error) {
    return fail(res, error, "Unable to start that task.");
  }
}

/**
 * A feedback issue answered by its holder: `{ outcome: "Issues sorted" | "Rejected", remarks }` - a
 * remark required for Rejected. Only on a task that is a feedback issue, and only by its holder; the
 * service decides both, as it does for every other verb.
 */
async function resolveFeedbackTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  const body = req.body || {};
  try {
    return res.json({ data: await service.transition(id, "resolve", req.user, {
      canSeeAll: Boolean(req.canSeeAll),
      outcome: typeof body.outcome === "string" ? body.outcome : null,
      remarks: typeof body.remarks === "string" ? body.remarks : null,
    }) });
  } catch (error) {
    return fail(res, error, "Unable to answer that feedback issue.");
  }
}

async function completeTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  try {
    return res.json({ data: await service.transition(id, "complete", req.user, { canSeeAll: Boolean(req.canSeeAll) }) });
  } catch (error) {
    return fail(res, error, "Unable to complete that task.");
  }
}

/**
 * Handing a task on, which replaced rolling it back.
 *
 * Refused without both halves: the person it goes to, and why it is leaving. The service checks the
 * same two again before writing — this schema only decides the shape, and the rules about who may
 * be given a task and whether this one may move at all are the service's.
 */
async function reassignTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  const parsed = reassignSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Choose who this task is going to, and say why.", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await service.transition(id, "reassign", req.user, {
      reason: parsed.data.reason,
      assignToUserId: parsed.data.assignedToUserId,
      canSeeAll: Boolean(req.canSeeAll),
    }) });
  } catch (error) {
    return fail(res, error, "Unable to reassign that task.");
  }
}

/** The giver calling a task off. A reason is welcome here but not demanded. */
async function cancelTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  const parsed = cancelSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Validation failed.", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await service.transition(id, "cancel", req.user, { reason: parsed.data.reason || null, canSeeAll: Boolean(req.canSeeAll) }) });
  } catch (error) {
    return fail(res, error, "Unable to cancel that task.");
  }
}

/** Mark as Completed, by whoever assigned the task - only once it has been finished and sent back. */
async function approveTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  try {
    return res.json({ data: await service.transition(id, "approve", req.user, { canSeeAll: Boolean(req.canSeeAll) }) });
  } catch (error) {
    return fail(res, error, "Unable to mark that task as completed.");
  }
}

/** Revoking: whoever assigned the task takes it back, optionally reassigning it to someone. */
async function revokeTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  const parsed = revokeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Validation failed.", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await service.transition(id, "revoke", req.user, {
      reason: parsed.data.reason || null,
      assignToUserId: parsed.data.assignedToUserId || null,
      canSeeAll: Boolean(req.canSeeAll),
    }) });
  } catch (error) {
    return fail(res, error, "Unable to revoke that task.");
  }
}

/**
 * Deleting a task, which the giver and a Super Admin may do and nobody else.
 *
 * The role is read in the service alongside the task's own two people, not here: a check on
 * `req.user.role` in a controller sits below the route's permission guard and quietly overrules it.
 * This handler only says which task and who is asking.
 *
 * A soft delete, so the reply is the id that went rather than a row - there is nothing left to show.
 */
/**
 * Deleting one task, as the route and the bulk delete both do it.
 *
 * `service.deleteTask` is where the ownership rule lives - the task's giver, or a Super Admin - so
 * running it per id is what keeps a selection from deleting work somebody else gave out. It throws
 * for a task that is not theirs, and the bulk runner counts the throw as an id it could not take.
 */
function deleteTaskRecord(req, id) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("That is not a valid task id.");
  return service.deleteTask(parsed, req.user, { canSeeAll: Boolean(req.canSeeAll) });
}

async function deleteTask(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  try {
    return res.json({ data: await deleteTaskRecord(req, id) });
  } catch (error) {
    return fail(res, error, "Unable to delete that task.");
  }
}

/** Attaching one file to a task. The two people on the task may; a reader of All Tasks may not. */
async function addAttachment(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  try {
    const data = await service.addAttachment(id, req.file, req.user, { canSeeAll: Boolean(req.canSeeAll) });
    return res.status(201).json({ data });
  } catch (error) {
    return fail(res, error, "Unable to attach that file.");
  }
}

/**
 * The bytes, streamed through the login rather than served from a public URL.
 *
 * `Content-Disposition: attachment` so pressing Download saves the file under the name it was
 * picked with, whatever the object is called in the bucket. The name is quoted and its quotes
 * escaped: a file called `my "final" brief.pdf` would otherwise end the header early.
 */
async function downloadAttachment(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  const fileId = attachmentId(req, res);
  if (!fileId) return undefined;
  try {
    const file = await service.readTaskAttachment(id, fileId, req.user.id, { canSeeAll: Boolean(req.canSeeAll) });
    res.setHeader("Content-Type", file.contentType || file.mimeType || "application/octet-stream");
    if (file.contentLength) res.setHeader("Content-Length", file.contentLength);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${String(file.name || "attachment").replace(/["\\]/g, "_")}"`);
    return file.stream.pipe(res);
  } catch (error) {
    return fail(res, error, "Unable to open that attachment.");
  }
}

/** Removing one. Whoever attached it, or whoever set the task. */
async function deleteAttachment(req, res) {
  const id = taskId(req, res);
  if (!id) return undefined;
  const fileId = attachmentId(req, res);
  if (!fileId) return undefined;
  try {
    await service.removeTaskAttachment(id, fileId, req.user, { canSeeAll: Boolean(req.canSeeAll) });
    return res.json({ message: "Attachment removed." });
  } catch (error) {
    return fail(res, error, "Unable to remove that attachment.");
  }
}

module.exports = {
  dashboard, resolveFeedbackTask, createSchema, updateSchema, options, listMine, listGiven, listAll, getTask, createTask, updateTask, startTask, completeTask, approveTask, revokeTask, reassignTask, cancelTask, deleteTask, deleteTaskRecord, uploadSingle, addAttachment, downloadAttachment, deleteAttachment };
