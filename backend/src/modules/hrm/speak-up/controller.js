const { pipeline } = require("node:stream/promises");
const { z } = require("zod");
const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { nextIdentifier } = require("../../../services/identifiers");
// Held as the module object rather than destructured, so a test can stub `getPrivateObject`.
const objectStorage = require("../../../services/objectStorage");
const { compressImage } = require("../../../services/imageCompression");
const tasks = require("../tasks/service");

const TYPES = ["Team / Manager Issue", "HR / People", "Work Environment", "Suggestion", "App / System Issue", "Other"];

/** The decoded upload may be at most this large - the same cap `FileUploadField` holds in the browser. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * The only content types accepted, each with the one extension its object key is given. The key's
 * extension comes from here - the confirmed type - never from the file name the client sent, which
 * is kept only as the name shown on screen.
 */
const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  // Roughly 5MB of base64 plus the `data:<mime>;base64,` prefix; the decoded size is checked again.
  data: z.string().trim().min(1).max(7_000_000),
}).nullable().optional();

const createSchema = z.object({
  type: z.enum(TYPES),
  title: z.string().trim().min(1).max(191),
  // The column is TEXT (64KB); this keeps an overlong value a 400 rather than a database error.
  description: z.string().trim().min(1).max(60000),
  attachment: attachmentSchema,
});

/*
 * ── The reviewer's decision ───────────────────────────────────────────────────────────────────
 *
 * A speak-up is PENDING until somebody holding Speak-up Review with write decides it, once:
 *   APPROVE - noted, nothing more;
 *   ASSIGN  - approved and given to somebody as an HRM task, in the same write;
 *   REJECT  - turned down, with the reason, which stays in Speak-up Review.
 * The employee who raised it sees only the status.
 */
const DECISIONS = { APPROVE: "APPROVED", ASSIGN: "ASSIGNED", REJECT: "REJECTED" };

const reviewSchema = z.object({
  decision: z.enum(Object.keys(DECISIONS)),
  remark: z.string().trim().max(2000).optional().transform((value) => value || null),
  assignedToUserId: z.coerce.number().int().positive().optional(),
  priority: z.enum(tasks.PRIORITIES).optional().default("MEDIUM"),
  // A day key, as the task form sends - `new Date("next friday")` would reach Prisma as Invalid Date.
  dueOn: z.string().trim().optional().transform((value) => value || null).refine(
    (value) => value === null || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())),
    { message: "Give the due date as YYYY-MM-DD." },
  ),
}).superRefine((value, ctx) => {
  if (value.decision === "REJECT" && !value.remark) ctx.addIssue({ code: "custom", path: ["remark"], message: "Say why it is rejected." });
  if (value.decision === "ASSIGN" && !value.assignedToUserId) ctx.addIssue({ code: "custom", path: ["assignedToUserId"], message: "Choose who it is assigned to." });
});

/**
 * The task an assigned speak-up becomes.
 *
 * It says what the speak-up says and **not who raised it**: the person it is given to may be the
 * manager it is about. Who raised it stays in Speak-up Review, behind that permission. The
 * attachment stays there too - it is private to the speak-up, and copying it would widen who can
 * open it.
 */
function speakUpTask(row, values) {
  return {
    title: `Speak-up ${row.speakUpId || row.id}: ${row.title}`.slice(0, 200),
    description: [
      `Type: ${row.type}`,
      row.description,
      values.remark ? `From the reviewer: ${values.remark}` : "",
    ].filter(Boolean).join("\n\n"),
    // Its own type, so it reads as a speak-up on every task list - the way a feedback issue does.
    taskType: "Speak-up",
    priority: values.priority,
    department: null,
    branch: null,
    branchId: null,
    dueOn: values.dueOn,
  };
}

const NOT_FOUND = "This attachment could not be found.";

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

/** A deliberate error keeps its message; anything unexpected is logged here and never echoed. */
function handleError(res, error, fallback, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Speak-up ${action} failed:`, error);
  return res.status(500).json({ message: fallback });
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/** A row as the client sees it: whether a file is attached, never the object key it is stored under. */
function toClient(row) {
  const { attachmentKey, reviewedBy, task, ...rest } = row;
  return {
    ...rest,
    hasAttachment: Boolean(attachmentKey),
    // The reviewer's name through the login it links to, and the task's code - Speak-up Review only.
    reviewedByName: reviewedBy ? tasks.nameOf(reviewedBy) : null,
    taskCode: task?.taskCode || null,
  };
}

/** The employee's own view of a row: the status, never who decided it, why, or whom it went to. */
function toOwnClient(row) {
  const { reviewRemark, reviewedByUserId, reviewedByName, taskId, taskCode, ...rest } = toClient(row);
  return rest;
}

const REVIEW_INCLUDE = {
  reviewedBy: { select: { id: true, name: true, username: true, email: true } },
  task: { select: { taskCode: true } },
};

/**
 * Decodes a `{ name, data }` upload (the `FileUploadField` shape, a base64 data URL) into a
 * private object, or `null` when nothing was attached. Only the types in `ALLOWED_TYPES` are
 * accepted, and the stored extension is the one that type maps to; the client's file name is kept
 * only as the display name.
 */
async function storeAttachment(attachment) {
  if (!attachment) return null;
  const match = /^data:([^;,]+);base64,(.+)$/.exec(attachment.data);
  if (!match) throw badRequest("That attachment could not be read.");
  const [, declaredType, base64] = match;
  let contentType = declaredType.toLowerCase();
  let extension = ALLOWED_TYPES[contentType];
  if (!extension) throw badRequest("Attach a PDF, an image (PNG, JPEG, WebP), a Word document or a text file.");
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw badRequest("That attachment could not be read.");
  let buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw badRequest("That attachment could not be read.");
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw badRequest("An attachment may be at most 5MB.");
  // A photo compresses the same way every other image in the app does, before it reaches private
  // storage - an unread phone photo attached here is the same several megabytes as anywhere else.
  // A photo `compressImage` cannot shrink further is stored as received rather than refused.
  if (contentType.startsWith("image/")) {
    try {
      const compressed = await compressImage(buffer);
      buffer = compressed.buffer;
      contentType = compressed.mimeType;
      extension = compressed.extension;
    } catch (error) {
      console.warn("[speak-up] Image not compressed, storing as received:", error.message);
    }
  }
  const { key } = await objectStorage.uploadPrivateObject(buffer, { folder: "hrm/speak-up", extension, contentType });
  return { key, name: attachment.name };
}

/** The employee behind this login, or `null` for an account with none - an admin-only user. */
async function callingEmployee(req) {
  const employeeId = Number(req.user?.linkedEmployeeId) || null;
  if (!employeeId) return null;
  return prisma.employee.findFirst({ where: { id: employeeId }, select: { id: true, employeeName: true } });
}

async function create(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const employee = await callingEmployee(req);
    if (!employee) return res.status(400).json({ message: "Your login is not linked to an employee record, so a Speak-up cannot be attributed to you." });

    const stored = await storeAttachment(parsed.data.attachment);
    // Minted inside the same transaction as the create, so a Speak-up that fails to save does not
    // spend a number and leave a gap in a run HR reads as a count - the same rule Employee Referral
    // mints its code under.
    const created = await prisma.$transaction(async (client) => {
      const speakUpId = await nextIdentifier("SPEAK_UP", {}, client);
      return client.speakUp.create({
        data: {
          speakUpId,
          employeeId: employee.id,
          employeeName: employee.employeeName,
          type: parsed.data.type,
          title: parsed.data.title,
          description: parsed.data.description,
          attachmentKey: stored?.key ?? null,
          attachmentFileName: stored?.name ?? null,
        },
      });
    });
    return res.status(201).json({ data: toClient(created) });
  } catch (error) {
    return handleError(res, error, "Unable to save this Speak-up.", "create");
  }
}

async function mine(req, res) {
  try {
    const employee = await callingEmployee(req);
    const rows = employee
      ? await prisma.speakUp.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: "desc" } })
      : [];
    return res.json({ data: rows.map(toOwnClient) });
  } catch (error) {
    return handleError(res, error, "Unable to load your Speak-ups.", "mine");
  }
}

// Capped rather than paged: the newest 500 are returned. A "load more" control is future work.
const REVIEW_LIST_LIMIT = 500;

async function all(req, res) {
  try {
    const rows = await prisma.speakUp.findMany({ orderBy: { createdAt: "desc" }, take: REVIEW_LIST_LIMIT, include: REVIEW_INCLUDE });
    return res.json({ data: rows.map(toClient) });
  } catch (error) {
    return handleError(res, error, "Unable to load Speak-ups.", "all");
  }
}

/** Who an assigned speak-up can be given to: the active logins that can answer a task. */
async function assignees(req, res) {
  try {
    return res.json({ data: await tasks.taskAnswerers() });
  } catch (error) {
    return handleError(res, error, "Unable to load who this can be assigned to.", "assignees");
  }
}

/**
 * Records the reviewer's decision on one pending speak-up.
 *
 * Claimed with `status: "PENDING"` in the write itself, so two reviewers deciding at once cannot both
 * win - the second is told it has already been decided. An assignment's task is created in the same
 * transaction: the speak-up never reads ASSIGNED without its task, nor the task exist without it.
 */
async function review(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ message: "That Speak-up could not be found." });
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const values = parsed.data;
  try {
    let assignee = null;
    if (values.decision === "ASSIGN") {
      assignee = await prisma.user.findFirst({
        where: { id: values.assignedToUserId, status: "ACTIVE" },
        select: { id: true, name: true, username: true, email: true, status: true, linkedEmployeeId: true },
      });
      if (!assignee || !(await tasks.canAnswerTasks(assignee.id))) {
        throw badRequest("That person cannot take a task - they need an active login with HRM / Task Management. Choose somebody else.");
      }
    }

    const saved = await prisma.$transaction(async (client) => {
      const row = await client.speakUp.findUnique({ where: { id } });
      if (!row) throw Object.assign(new Error("That Speak-up could not be found."), { status: 404 });
      // Never back to the person who raised it: they would learn who it went to, and see only the
      // status is the promise.
      if (assignee && row.employeeId && assignee.linkedEmployeeId === row.employeeId) {
        throw badRequest("Choose somebody other than the person who raised it.");
      }
      const claimed = await client.speakUp.updateMany({
        where: { id, status: "PENDING" },
        data: { status: DECISIONS[values.decision], reviewedByUserId: req.user.id, reviewedAt: new Date(), reviewRemark: values.remark },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("This Speak-up has already been decided."), { status: 409 });
      if (assignee) {
        const task = await tasks.insertTask(client, speakUpTask(row, values), assignee, req.user);
        await client.speakUp.update({ where: { id }, data: { taskId: task.id } });
      }
      return client.speakUp.findUnique({ where: { id }, include: REVIEW_INCLUDE });
    });
    return res.json({ data: toClient(saved) });
  } catch (error) {
    return handleError(res, error, "Unable to record this decision.", "review");
  }
}

/**
 * Streams one attachment back. `HRM / Speak-up Review` may ask for any row; a caller who reached
 * this route only through the base `HRM / Speak-up` guard may ask only for a row that is their
 * own - re-checked here directly against `iamService`, the same way `isAttendanceAdmin` asks a
 * finer question than the route guard already answered, rather than trusted from whichever list
 * the request claims to have come from.
 *
 * Who may see the row is decided before whether it has a file, and "not yours", "no such row" and
 * "no file" all answer the same 404 - so the answer never says which other rows exist or carry one.
 */
/**
 * Removes one Speak-up, and the attachment that came with it - what the tick boxes' Delete calls per
 * id (`runBulkDelete` reports each refusal back, so a selection half of which may not go says which).
 *
 * Two ways in, because the two screens are not the same act:
 *
 *   - **Speak-up Review** (`own: false`) clears a record HR is finished with, whatever its state.
 *   - **the employee's own page** (`own: true`) takes back something they sent. Only their own, and
 *     only while it is still **PENDING**: once a reviewer has decided it, the decision is the
 *     studio's record of what was raised and answered, and the person who raised it withdrawing it
 *     afterwards would erase that.
 *
 * The object goes after the row, best-effort: a bucket that is unreachable must not leave a Speak-up
 * nobody can delete, and `deleteObject` never throws.
 */
async function deleteSpeakUpRecord(req, id, { own = false } = {}) {
  const key = Number(id);
  if (!Number.isInteger(key) || key <= 0) throw Object.assign(new Error("Speak-up not found."), { status: 404 });
  const row = await prisma.speakUp.findFirst({ where: { id: key }, select: { id: true, employeeId: true, status: true, attachmentKey: true, taskId: true } });
  if (!row) throw Object.assign(new Error("Speak-up not found."), { status: 404 });
  if (own) {
    const employee = await callingEmployee(req);
    if (!employee || row.employeeId !== employee.id) throw Object.assign(new Error("Speak-up not found."), { status: 404 });
    if (row.status !== "PENDING") throw Object.assign(new Error("This Speak-up has already been reviewed, so it is the studio's record now. Ask HR to remove it."), { status: 409 });
  }
  await prisma.speakUp.delete({ where: { id: row.id } });
  if (row.attachmentKey) await objectStorage.deleteObject(row.attachmentKey);
  // The HRM task an ASSIGNED one became is left alone: it is work somebody was given, and it is
  // theirs to close on the Tasks board rather than something a delete here reaches into.
  return { id: row.id, taskId: row.taskId };
}

async function attachment(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "That Speak-up could not be found." });
  try {
    const row = await prisma.speakUp.findUnique({ where: { id }, select: { attachmentKey: true, attachmentFileName: true, employeeId: true } });

    const canReviewAll = await iamService.hasPermission(req.user.id, "HRM", "Speak-up Review", "READ");
    let allowed = Boolean(row) && canReviewAll;
    if (row && !canReviewAll) {
      const employee = await callingEmployee(req);
      allowed = Boolean(employee) && employee.id === row.employeeId;
    }
    if (!allowed) return res.status(404).json({ message: NOT_FOUND });
    if (!row.attachmentKey) return res.status(404).json({ message: NOT_FOUND });

    const object = await objectStorage.getPrivateObject(row.attachmentKey);
    if (!object) return res.status(404).json({ message: "This attachment is no longer stored." });
    // `res.attachment` encodes a non-ASCII name (RFC 5987) and also guesses a Content-Type from
    // the name's extension, so the stored type is set after it and wins.
    res.attachment(row.attachmentFileName || "attachment");
    res.setHeader("Content-Type", object.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (object.contentLength) res.setHeader("Content-Length", String(object.contentLength));
    await pipeline(object.body, res);
  } catch (error) {
    if (res.headersSent || res.destroyed) {
      // The stream broke: `pipeline` has already closed the response, so all that is left is to log it.
      console.error("Speak-up attachment stream failed:", error);
      return undefined;
    }
    return handleError(res, error, "Unable to load this attachment.", "attachment");
  }
}

module.exports = { TYPES, DECISIONS, create, mine, all, assignees, review, attachment, deleteSpeakUpRecord };
