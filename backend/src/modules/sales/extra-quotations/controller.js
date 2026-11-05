const { z } = require("zod");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { projectAccessWhere } = require("../../../services/projectScope");
const { attachFiles, removeDroppedFiles, fileUrls, discardUploads } = require("../../../services/uploadMetadata");

/**
 * Work agreed on top of what a project was sold for: an extra shoot, an album nobody quoted.
 *
 * Deliberately not a fifth kind of payment request. Those four are the studio paying somebody, and
 * approving one writes a cash entry; this agrees work and writes nothing to the books — the client
 * pays for it later as an ordinary receipt, like any other money coming in. It carries one thing
 * rather than a list of lines, and it is decided by the manager of the project it names rather than
 * by Accounts, because whether the studio takes on more work is that project's call.
 *
 * Until it is decided it sits at PENDING, which every screen reads as "Approval pending". Only once
 * approved does it count as an extra on the project's Payments tab.
 */

const STATUSES = ["PENDING", "APPROVED", "REJECTED"];
/** Who may be credited with an extra: the same "currently employed" list every other picker uses. */
// The employment statuses that count as working here, read off the status list the studio
// maintains in Settings → Field Settings rather than written out again. See
// `services/employeeOptionLists`.
/** Where the client's agreement lives in the bucket, under the module that owns it. */
const PROOF_FOLDER = "sales/extra-quotations/proof";
const MAX_PROOF_FILES = 5;

const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const createSchema = z.object({
  projectId: z.string().trim().min(1, "Choose the project this extra is for").max(191),
  // An extra usually belongs to a shoot, but one agreed for the project as a whole has none to name.
  shootId: optionalText(191),
  service: z.string().trim().min(1, "Choose the service being added").max(150),
  amount: z.coerce.number().positive("Enter an amount greater than zero").max(999_999_999),
  // Who it was added by and when. Both are asked rather than assumed: a coordinator often enters an
  // extra for the person who agreed it, and one agreed on the shoot day is typed in the morning
  // after. Optional on the way in — a form that offers neither still records the person signed in,
  // today, which is what it used to do for everybody.
  addedById: z.coerce.number().int().positive().nullable().optional(),
  addedAt: z.coerce.date().optional(),
  remarks: optionalText(5000),
  // Files already on the record come back as the URLs they were stored under; anything just picked
  // arrives as an inline data URI. `attachFiles` tells them apart, so the form need not.
  proof: z.array(z.string().min(1)).max(MAX_PROOF_FILES, `Attach at most ${MAX_PROOF_FILES} files`).nullable().optional(),
});

const decisionSchema = z.object({ remarks: optionalText(5000) });
const listQuerySchema = z.object({
  projectId: optionalText(191),
  status: z.enum(STATUSES).optional(),
  // "The ones that concern me": what I raised, and what I am the one to decide. Without it the list
  // is every extra, which is what a project's own tab asks for when it names a `projectId`.
  mine: z.enum(["true", "false"]).optional(),
});

const include = {
  project: { select: { id: true, eventId: true, whatsappGroupName: true, projectManagerEmployeeId: true, projectManager: true } },
  shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true } },
};

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

function handleError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.code === "P2025") return res.status(404).json({ message: "Extra quotation not found" });
  return res.status(500).json({ message: fallback, error: error.message });
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/** EXT-000001, from the counter every generated identifier in the app comes from. */
async function nextRequestCode(client = prisma) {
  const row = await client.appSequence.upsert({
    where: { key: "PROJECT_EXTRA_QUOTATION_ID" },
    create: { key: "PROJECT_EXTRA_QUOTATION_ID", currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  return `EXT-${String(row.currentValue).padStart(6, "0")}`;
}

/**
 * One extra, flattened the way every table in the app reads its rows, with the project and shoot
 * named by the identifiers a person recognises rather than by their internal ids.
 */
function toRow(extra) {
  return {
    ...extra,
    amount: Number(extra.amount),
    projectCode: extra.project?.eventId || "",
    projectName: extra.project?.whatsappGroupName || "",
    shootCode: extra.shoot?.shootId || "",
    shootName: extra.shoot?.shoot || "",
    shootDate: extra.shoot?.dateCreated || null,
    projectManager: extra.project?.projectManager || "",
    addedById: extra.requestedById,
    proofUrls: fileUrls(extra.proof),
  };
}

/**
 * Who the studio thinks this person is, which decides what they may do here.
 *
 * A user and an employee are separate records, so deciding an extra means asking which employee the
 * signed-in account belongs to and whether the project names them as its manager.
 */
async function actorFor(userId) {
  const account = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { id: true, name: true, role: true, linkedEmployeeId: true },
  });
  if (!account) throw Object.assign(new Error("The authenticated user no longer exists."), { status: 401 });
  const employee = account.linkedEmployeeId
    ? await prisma.employee.findFirst({ where: { id: account.linkedEmployeeId, archivedAt: null }, select: { id: true, employeeName: true } })
    : null;
  return { userId: account.id, name: employee?.employeeName || account.name, employeeId: employee?.id || null, isSuperAdmin: account.role === "SUPER_ADMIN" };
}

/**
 * Whether this person may decide this extra: the project's own manager, or a super admin.
 *
 * Holding `Payment Request Approval` is deliberately not enough. Approving spend and agreeing to
 * sell more work are different authorities, and the second belongs to whoever is running the
 * project. A super admin decides alongside them so a project whose manager has left is not stuck.
 */
const canDecide = (actor, extra) => actor.isSuperAdmin
  || (Boolean(extra.project?.projectManagerEmployeeId) && extra.project.projectManagerEmployeeId === actor.employeeId);

async function listExtras(req, res) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const actor = await actorFor(req.user.id);
    /*
     * "Mine" is both halves of the workflow in one list: the extras I raised, and the extras I am
     * the one to decide. They are the same question from two ends — what is waiting on me — and
     * splitting them into two screens would mean checking two places to learn the same thing.
     *
     * A super admin is not narrowed, since they may decide any of them.
     */
    const mine = parsed.data.mine === "true" && !actor.isSuperAdmin
      ? { OR: [
        { createdBy: actor.userId },
        ...(actor.employeeId ? [{ project: { projectManagerEmployeeId: actor.employeeId } }] : []),
      ] }
      : {};
    /*
     * An extra belongs to the project it names, so it is seen exactly when that project is. `AND`
     * rather than a spread: `mine` sets its own `OR`, and spreading the access fragment beside it
     * would replace the rule instead of narrowing by it.
     */
    const data = await prisma.projectExtraQuotation.findMany({
      where: {
        deletedAt: null,
        ...mine,
        ...(parsed.data.projectId ? { projectId: parsed.data.projectId } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        AND: [{ project: await projectAccessWhere({ userId: req.user.id, permissions: req.permission }) }],
      },
      orderBy: { createdAt: "desc" },
      include,
    });
    // Each row says whether this reader may decide it, so the screen can offer the buttons to the
    // manager and withhold them from the person who raised it without asking a second time.
    return res.json({ data: data.map((extra) => ({ ...toRow(extra), canDecide: canDecide(actor, extra), raisedByMe: extra.createdBy === actor.userId })) });
  } catch (error) { return handleError(res, error, "Unable to load extra quotations"); }
}

/**
 * The employee an extra is credited to: the one chosen on the form, or the person signed in when
 * the form offered no choice. A name is stored alongside so the record still reads after they are
 * archived.
 */
async function addedBy(input, actor) {
  if (!input.addedById) return { requestedById: actor.employeeId, requestedByName: actor.name };
  const employee = await prisma.employee.findFirst({
    where: { id: input.addedById, archivedAt: null },
    select: { id: true, employeeName: true },
  });
  if (!employee) throw badRequest("Select a current employee as the person who added this extra.");
  return { requestedById: employee.id, requestedByName: employee.employeeName };
}

async function createExtra(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;

  let uploads = [];
  try {
    const actor = await actorFor(req.user.id);
    // Not narrowed: the picker offers every project, so refusing one here would refuse what the
    // form itself offered. The extra is then the raiser's own to read back, whoever runs the project.
    const project = await prisma.salesProject.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true } });
    if (!project) throw badRequest("Select a valid project for this extra.");
    // A shoot from another project is refused rather than quietly re-filed: the two arrive from
    // pickers where the project narrows the shoots, so a mismatch is a stale value, not a choice.
    if (input.shootId) {
      const shoot = await prisma.projectShoot.findFirst({ where: { id: input.shootId, deletedAt: null }, select: { projectId: true } });
      if (!shoot) throw badRequest("Select a valid shoot for this extra.");
      if (shoot.projectId !== project.id) throw badRequest("That shoot does not belong to the chosen project.");
    }

    const attached = await attachFiles(input.proof, null, { folder: PROOF_FOLDER, userId: actor.userId });
    uploads = attached.uploads;
    const created = await prisma.projectExtraQuotation.create({
      data: {
        requestCode: await nextRequestCode(),
        projectId: project.id,
        shootId: input.shootId || null,
        service: input.service,
        amount: input.amount.toFixed(2),
        remarks: input.remarks ?? null,
        ...(await addedBy(input, actor)),
        addedAt: input.addedAt || new Date(),
        proof: attached.files,
        createdBy: actor.userId,
      },
      include,
    });
    return res.status(201).json({ data: toRow(created) });
  } catch (error) {
    // The record was never written, so the files it uploaded have nothing to belong to.
    await discardUploads(uploads);
    return handleError(res, error, "Unable to raise this extra quotation");
  }
}

/**
 * Correcting an extra that has not been decided yet.
 *
 * Only while it is pending, and only by whoever raised it or a super admin — the same rule as
 * withdrawing, and for the same reason. Once a manager has approved it the figure is what the
 * project agreed to sell; changing it afterwards would move that quietly, so an approved extra is
 * edited by raising another one rather than by rewriting this.
 */
async function updateExtra(req, res) {
  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;

  let uploads = [];
  try {
    // Held to the same line as the list: an extra on a project this reader cannot see is not found.
    const extra = await prisma.projectExtraQuotation.findFirst({ where: { id: String(req.params.id), deletedAt: null, AND: [{ project: await projectAccessWhere({ userId: req.user.id, permissions: req.permission }) }] }, include });
    if (!extra) return res.status(404).json({ message: "Extra quotation not found" });
    if (extra.status !== "PENDING") throw badRequest(`This extra quotation has already been ${extra.status.toLowerCase()} and can no longer be changed.`);

    const actor = await actorFor(req.user.id);
    if (!actor.isSuperAdmin && extra.createdBy !== actor.userId) {
      return res.status(403).json({ message: "Only the person who raised this extra quotation can change it." });
    }

    // The project may move, and the shoot has to keep up with it: a shoot belonging to the project
    // being left would otherwise stay behind on the record.
    const projectId = input.projectId || extra.projectId;
    if (input.projectId && input.projectId !== extra.projectId) {
      const project = await prisma.salesProject.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true } });
      if (!project) throw badRequest("Select a valid project for this extra.");
    }
    const shootId = input.shootId === undefined ? extra.shootId : (input.shootId || null);
    if (shootId) {
      const shoot = await prisma.projectShoot.findFirst({ where: { id: shootId, deletedAt: null }, select: { projectId: true } });
      if (!shoot) throw badRequest("Select a valid shoot for this extra.");
      if (shoot.projectId !== projectId) throw badRequest("That shoot does not belong to the chosen project.");
    }

    // The proof is only touched when the form sends one, so an edit that says nothing about it
    // leaves the files where they are rather than clearing them.
    let proof = extra.proof;
    if (input.proof !== undefined) {
      const attached = await attachFiles(input.proof, extra.proof, { folder: PROOF_FOLDER, userId: actor.userId });
      uploads = attached.uploads;
      proof = attached.files;
    }

    const updated = await prisma.projectExtraQuotation.update({
      where: { id: extra.id },
      data: {
        projectId,
        shootId,
        ...(input.service !== undefined ? { service: input.service } : {}),
        ...(input.amount !== undefined ? { amount: input.amount.toFixed(2) } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks ?? null } : {}),
        ...(input.addedById !== undefined ? await addedBy(input, actor) : {}),
        ...(input.addedAt !== undefined ? { addedAt: input.addedAt } : {}),
        proof,
      },
      include,
    });
    // Only once the row is written: until then the dropped files are still what the extra shows.
    if (input.proof !== undefined) await removeDroppedFiles(extra.proof, proof);
    return res.json({ data: toRow(updated) });
  } catch (error) {
    await discardUploads(uploads);
    return handleError(res, error, "Unable to update this extra quotation");
  }
}

/** Approving records the extra and nothing else — agreeing work moves no money. */
async function decide(req, res, status, fallback) {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    // Held to the same line as the list: an extra on a project this reader cannot see is not found.
    const extra = await prisma.projectExtraQuotation.findFirst({ where: { id: String(req.params.id), deletedAt: null, AND: [{ project: await projectAccessWhere({ userId: req.user.id, permissions: req.permission }) }] }, include });
    if (!extra) return res.status(404).json({ message: "Extra quotation not found" });
    if (extra.status !== "PENDING") throw badRequest(`This extra quotation has already been ${extra.status.toLowerCase()}.`);

    const actor = await actorFor(req.user.id);
    if (!canDecide(actor, extra)) {
      return res.status(403).json({ message: "Only this project's manager can decide an extra quotation." });
    }
    if (status === "REJECTED" && !parsed.data.remarks) throw badRequest("Say why this extra quotation is being rejected.");

    const decided = await prisma.projectExtraQuotation.update({
      where: { id: extra.id },
      data: { status, decisionRemarks: parsed.data.remarks ?? null, decidedById: actor.userId, decidedAt: new Date() },
      include,
    });
    return res.json({ data: toRow(decided) });
  } catch (error) { return handleError(res, error, fallback); }
}

const approveExtra = (req, res) => decide(req, res, "APPROVED", "Unable to approve this extra quotation");
const rejectExtra = (req, res) => decide(req, res, "REJECTED", "Unable to reject this extra quotation");

/** Withdrawn by whoever raised it, and only while nobody has decided it. */
async function withdrawExtra(req, res) {
  try {
    const extra = await prisma.projectExtraQuotation.findFirst({ where: { id: String(req.params.id), deletedAt: null, AND: [{ project: await projectAccessWhere({ userId: req.user.id, permissions: req.permission }) }] }, select: { id: true, status: true, createdBy: true, proof: true } });
    if (!extra) return res.status(404).json({ message: "Extra quotation not found" });
    if (extra.status !== "PENDING") throw badRequest("A decided extra quotation cannot be withdrawn.");
    const actor = await actorFor(req.user.id);
    if (!actor.isSuperAdmin && extra.createdBy !== actor.userId) {
      return res.status(403).json({ message: "Only the person who raised this extra quotation can withdraw it." });
    }
    await prisma.projectExtraQuotation.update({ where: { id: extra.id }, data: { deletedAt: new Date() } });
    return res.status(204).send();
  } catch (error) { return handleError(res, error, "Unable to withdraw this extra quotation"); }
}

/** The pickers the form is drawn from: the projects, their shoots, and the studio's services. */
async function options(req, res) {
  try {
    const [projects, shoots, services, employees] = await Promise.all([
      // Every project: an extra is raised against whatever project the work was agreed for, and
      // the person raising it is often not the one running that project. The list of extras is
      // what the rule narrows.
      prisma.salesProject.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, eventId: true, whatsappGroupName: true } }),
      prisma.projectShoot.findMany({ where: { deletedAt: null }, orderBy: { dateCreated: "desc" }, take: 200, select: { id: true, shootId: true, shoot: true, projectId: true } }),
      // Alphabetical, as Project Settings and the quotation calculator list them.
      prisma.projectServiceDefinition.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }], select: { name: true } }),
      prisma.employee.findMany({
        where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
        orderBy: { employeeName: "asc" },
        select: { id: true, employeeId: true, employeeName: true },
      }),
    ]);
    return res.json({ data: {
      projects: projects.map((project) => ({ id: project.id, eventId: project.eventId, name: project.whatsappGroupName })),
      shoots,
      services: services.map((service) => service.name),
      employees,
    } });
  } catch (error) { return handleError(res, error, "Unable to load extra quotation options"); }
}

module.exports = { listExtras, createExtra, updateExtra, approveExtra, rejectExtra, withdrawExtra, options };
