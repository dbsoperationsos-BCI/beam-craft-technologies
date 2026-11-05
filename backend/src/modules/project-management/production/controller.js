const { z } = require("zod");
const read = require("./read");
const { savePlan, saveSeat, copyTeam, setPlanStatus } = require("./plan");
const { swapSeats } = require("./swap");
const { callerOf } = require("./access");
const { TRAVEL_MODES, TICKET_MODES, TICKET_STATUSES } = require("./travel");
const execution = require("./execution");
const { retryMessage } = require("./messages");
const { FILE_KINDS } = require("./steps");
const { CREW_ROLES, VENDOR_STATUSES } = require("./crew");
const { respond, invalid } = require("./http");

/*
 * The production board's HTTP edge: parse the body with zod (strict - an unknown key is refused,
 * so nothing a browser invents reaches Prisma), hand it to the service with the caller, and answer
 * with the shoot as it now stands. Who may change what is decided in the services by being named.
 */

const optionalText = z.string().trim().max(5000).nullable().optional();

const planSchema = z.object({
  submit: z.boolean().optional(),
  productionCoordinatorEmployeeId: z.coerce.number().int().positive().nullable().optional(),
  travelMode: z.enum(TRAVEL_MODES).nullable().optional(),
  travelModeOther: z.string().trim().max(191).nullable().optional(),
  ticketStatus: z.enum(TICKET_STATUSES).nullable().optional(),
  // Trimmed here and capped after trimming; upper-cased in plan.js.
  vehicleNumberPlate: z.string().trim().max(20).nullable().optional(),
  travelVehicleAssetId: z.coerce.number().int().positive().nullable().optional(),
  // When the crew leaves the studio: a YYYY-MM-DD day and an HH:MM time, each optional.
  studioStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the studio start date as YYYY-MM-DD.")
    // A real day: 2026-02-31 would roll over to March rather than be refused.
    .refine((day) => { const read = new Date(`${day}T00:00:00.000Z`); return !Number.isNaN(read.getTime()) && read.toISOString().startsWith(day); }, "Enter a real studio start date.").nullable().optional(),
  studioStartTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the studio start time as HH:MM.").nullable().optional(),
  /*
   * Who works each service: its own person and, on a candid service, two assistants. An employee on
   * the service's own seat is asked for its cameras; a vendor is asked where they stand instead
   * (`vendorStatus`), which is what `crewRefusal` and `saveCrew` hold to.
   */
  crew: z.array(z.object({
    serviceDefinitionId: z.string().trim().min(1).max(191),
    role: z.enum(CREW_ROLES),
    employeeId: z.number().int().positive().nullable(),
    vendorId: z.number().int().positive().nullable().optional(),
    // A seat may take several cameras - a photographer carrying two bodies.
    cameraAssetIds: z.array(z.number().int().positive()).max(10).optional(),
    vendorStatus: z.enum(VENDOR_STATUSES).nullable().optional(),
  }).strict()).max(90).optional(),
  // The shoot's Assist: who assists on the whole shoot, an employee or a vendor each - the shoot's
  // Production Team. Sent whole; what is not in it is no longer on the shoot.
  team: z.array(z.object({
    employeeId: z.number().int().positive().nullable().optional(),
    vendorId: z.number().int().positive().nullable().optional(),
  }).strict()).max(60).optional(),
  remarks: optionalText,
}).strict();

/*
 * File uploads: capped well under the server's JSON_BODY_LIMIT (50 MB, `server.js:150-151`) so a
 * batch that is too large gets this module's own clean 400 rather than the opaque 413 express's
 * body parser throws once the raw request exceeds its limit - by the time a request is that big,
 * refusing it here has already cost nothing extra to check.
 */
// ~5 MB decoded, the documentStorage ceiling, as base64 plus its data: prefix.
const MAX_DATA_URI_CHARS = 7_500_000;
const MAX_FILES_PER_REQUEST = 5;
// Comfortably below MAX_FILES_PER_REQUEST * MAX_DATA_URI_CHARS (37.5M) and the 50MB JSON limit -
// a batch that adds up to more than this is refused on its total, not just file-by-file.
const MAX_BATCH_CHARS = 20_000_000;
// A ticket upload may carry the travel mode it is picking, so the mode never has to be saved first
// (`travel.js`/`plan.js` `travelData` clears the rest of the detail for it) - only Bus, Train or
// Flight take tickets, and only a ticket upload (`kind: "TICKET"`) may say it.
const filesSchema = z.object({
  kind: z.enum(FILE_KINDS),
  files: z.array(z.object({ name: z.string().trim().max(255).optional(), data: z.string().min(1).max(MAX_DATA_URI_CHARS) }).strict()).min(1).max(MAX_FILES_PER_REQUEST),
  travelMode: z.enum(TICKET_MODES).optional(),
}).strict().superRefine((value, ctx) => {
  const total = (value.files || []).reduce((sum, file) => sum + (file.data?.length || 0), 0);
  if (total > MAX_BATCH_CHARS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: `These files add up to too much for one request; upload ${MAX_FILES_PER_REQUEST > 1 ? "fewer at a time" : "a smaller file"}.` });
  }
  if (value.travelMode !== undefined && value.kind !== "TICKET") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["travelMode"], message: "travelMode only applies to a ticket upload." });
  }
});

const required = (label, max) => z.string({ required_error: `Enter the ${label}.` }).trim().min(1, `Enter the ${label}.`).max(max);
// Photo copy, one per service of the shoot (`execution.photoCopyRows` checks every service is there).
const footageSchema = z.object({
  serviceDefinitionId: z.string().trim().min(1).max(191).nullable(),
  /*
   * Plain text, not a link. It was an http(s) URL until November 2026 - a scheme added for a link
   * pasted without one, anything else refused - which was right while every backup went to Drive or
   * the NAS. It is not: footage also goes onto a hard disk that lives on a shelf, and "Seagate 3,
   * Reception" is the true answer to where it is. The box takes whatever says where the footage is.
   */
  footageUrl: required("footage location", 2048),
  backedUpByEmployeeId: z.coerce.number({ invalid_type_error: "Choose who did the footage backup." }).int().positive("Choose who did the footage backup."),
  fileCount: z.coerce.number({ invalid_type_error: "Enter the number of files." }).int("Enter the number of files as a whole number.").min(1, "Enter the number of files.").max(10_000_000),
  size: required("size", 50),
  firstFileName: required("first file name", 255),
  lastFileName: required("last file name", 255),
  remarks: optionalText,
}).strict();
const stepSchema = z.object({
  remarks: optionalText,
  footage: z.array(footageSchema).max(50).optional(),
}).strict();
/*
 * The same answers, each one allowed to be missing: the Mark as pending save takes File in as it
 * stands. Blank is a real answer here, so every field but the service takes `""` and a figure is
 * only read when something was typed. What is complete is kept and what is not is left pending -
 * `execution.saveFootage` decides that, by `steps.FOOTAGE_ANSWERS`, so the two cannot disagree about
 * which answers make a service answered.
 */
const blankOr = (schema) => z.preprocess((value) => (value === null || value === undefined ? "" : value), z.union([z.literal(""), schema]));
const pendingFootageSchema = z.object({
  serviceDefinitionId: z.string().trim().min(1).max(191).nullable(),
  footageUrl: blankOr(footageSchema.shape.footageUrl).optional(),
  backedUpByEmployeeId: blankOr(z.coerce.number().int().positive()).optional(),
  fileCount: blankOr(z.coerce.number().int().min(1).max(10_000_000)).optional(),
  size: blankOr(z.string().trim().max(50)).optional(),
  firstFileName: blankOr(z.string().trim().max(255)).optional(),
  lastFileName: blankOr(z.string().trim().max(255)).optional(),
  remarks: optionalText,
}).strict();
const footageSaveSchema = z.object({ footage: z.array(pendingFootageSchema).max(50) }).strict();
/** Pausing the shoot, or resuming it: both say why, so the box is required either way. */
const pauseSchema = z.object({ paused: z.boolean(), remarks: z.string().trim().min(1, "Write why.").max(2000) }).strict();

// The Production Schedule's window, from the query: `from` / `to` (YYYY-MM-DD) or `undated=1`. Anything
// else is ignored, and with nothing the whole board is read, as the Production table reads it.
const shootsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  undated: z.enum(["1", "true"]).optional(),
});

async function listShoots(req, res) {
  const parsed = shootsQuerySchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ message: "Choose the days as YYYY-MM-DD." });
  const { from, to, undated } = parsed.data;
  const dates = undated ? { undated: true } : from || to ? { from, to } : null;
  try { return res.json({ data: await read.listShoots(req.user.id, { dates }) }); } catch (error) { return respond(res, error, "Unable to load production shoots."); }
}

async function getShoot(req, res) {
  try { return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) }); } catch (error) { return respond(res, error, "Unable to load this shoot."); }
}

async function listOptions(req, res) {
  try {
    return res.json({ data: await read.listOptions() });
  } catch (error) { return respond(res, error, "Unable to load the production form options."); }
}

// A file name a download header can carry: no quotes, slashes or control characters.
const safeFileName = (name) => String(name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "file";

async function downloadFile(req, res) {
  try {
    const { buffer, contentType, fileName } = await read.fileDownload(req.user.id, req.params.shootId, req.params.fileId);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(fileName)}"`);
    return res.send(buffer);
  } catch (error) { return respond(res, error, "Unable to download the file."); }
}

async function listActivity(req, res) {
  try { return res.json({ data: await read.listActivity(req.user.id, req.params.shootId) }); } catch (error) { return respond(res, error, "Unable to load the activity."); }
}

async function savePlanRoute(req, res) {
  const parsed = planSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    await savePlan(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to save the plan."); }
}

// One service's own person, from the Production Schedule: an employee, a vendor, or neither.
const seatSchema = z.object({
  serviceDefinitionId: z.string().trim().min(1).max(191),
  employeeId: z.number().int().positive().nullable(),
  vendorId: z.number().int().positive().nullable(),
  // A vendor's answer - Waiting or Confirmed - for the vendor already on the seat (`saveSeat`).
  vendorStatus: z.enum(["WAITING", "CONFIRMED"]).optional(),
}).strict()
  .refine((seat) => !(seat.employeeId && seat.vendorId), { message: "Choose an employee or a vendor, not both." })
  .refine((seat) => !seat.vendorStatus || seat.vendorId, { message: "Only a vendor on a service is Waiting or Confirmed." });

async function saveSeatRoute(req, res) {
  const parsed = seatSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    await saveSeat(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to save the service's person."); }
}

// "Use the same team as above": this shoot's services take another shoot of the project's people.
const copyTeamSchema = z.object({ fromShootId: z.string().trim().min(1).max(191) }).strict();

async function copyTeamRoute(req, res) {
  const parsed = copyTeamSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    await copyTeam(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to use that team."); }
}

// Two services' people swapped, from the Production Schedule's drag: each side a shoot and a service.
const seatRef = z.object({ shootId: z.string().trim().min(1).max(191), serviceDefinitionId: z.string().trim().min(1).max(191) }).strict();
const swapSchema = z.object({ from: seatRef, to: seatRef }).strict();

async function swapSeatsRoute(req, res) {
  const parsed = swapSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    return res.json({ data: await swapSeats(parsed.data.from, parsed.data.to, await callerOf(req.user.id)) });
  } catch (error) { return respond(res, error, "Unable to swap the people."); }
}

const planStatusSchema = z.object({
  status: z.enum(["WCR", "HOLD", "REJECTED"]).nullable(),
  remarks: z.string().trim().max(5000).optional().nullable(),
  // WCR's next follow-up with the client, YYYY-MM-DD.
  followupDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the Next Followup Date.").optional().nullable(),
}).strict();

async function setPlanStatusRoute(req, res) {
  const parsed = planStatusSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    await setPlanStatus(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to set the plan's status."); }
}

async function addFiles(req, res) {
  const parsed = filesSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    await execution.addFiles(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.status(201).json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to add the files."); }
}

async function removeFile(req, res) {
  try {
    await execution.removeFile(req.params.shootId, req.params.fileId, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to remove the file."); }
}

async function completeStep(req, res) {
  const parsed = stepSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    const { message } = await execution.completeStep(req.params.shootId, req.params.step, parsed.data, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId), message });
  } catch (error) { return respond(res, error, "Unable to complete this step."); }
}

async function pauseShoot(req, res) {
  const parsed = pauseSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    await execution.pauseShoot(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, parsed.data.paused ? "Unable to pause this shoot." : "Unable to resume this shoot."); }
}

async function saveFootage(req, res) {
  const parsed = footageSaveSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    const saved = await execution.saveFootage(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId), held: saved.held, saved: saved.saved, pending: saved.pending });
  } catch (error) { return respond(res, error, "Unable to save the File in."); }
}


async function retryMessageRoute(req, res) {
  try {
    const { message } = await retryMessage(req.params.shootId, req.params.step, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId), message });
  } catch (error) { return respond(res, error, "Unable to retry the message."); }
}

module.exports = { planStatusSchema, setPlanStatus: setPlanStatusRoute, planSchema, filesSchema, stepSchema, footageSaveSchema, pauseSchema, saveFootage, pauseShoot, listShoots, getShoot, listOptions, listActivity, downloadFile, savePlan: savePlanRoute, seatSchema, saveSeat: saveSeatRoute, copyTeamSchema, copyTeam: copyTeamRoute, swapSchema, swapSeats: swapSeatsRoute, addFiles, removeFile, completeStep, retryMessage: retryMessageRoute };
