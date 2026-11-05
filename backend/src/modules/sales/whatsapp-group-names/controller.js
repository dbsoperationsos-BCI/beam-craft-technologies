const { z } = require("zod");
const prisma = require("../../../config/db");
const dataScope = require("../../../services/dataScope.service");
const { REGISTER_READERS } = require("../../../services/projectScope");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const iamService = require("../../../services/iam.service");

const groupTypes = ["Dum Dum", "Qua Qua", "Corp"];
const requiredText = z.string().trim().min(1).max(200);
const optionalText = (maxLength) => z.string().trim().max(maxLength).nullable().optional();

const groupNameSchema = z.object({
  groupType: z.enum(groupTypes),
  // A full branch name from the locations master data, no longer one of a hardcoded code list;
  // createGroupName checks it against the table and the caller's branch reach below.
  branch: requiredText.max(120),
  // The lead this name is being prepared for, picked from the CRM's enquiries.
  enquiryId: requiredText.max(100),
  tier: optionalText(100),
  offerName: optionalText(200),
  clientName: optionalText(200),
  groomName: optionalText(150),
  brideName: optionalText(150),
  eventName: optionalText(200),
  socialMediaPosting: z.enum(["NSM", "SM"]).nullable().optional(),
  houseType: z.enum(["IH", "OH"]).nullable().optional(),
  gou: z.boolean().nullable().optional(),
  place: requiredText.max(200),
  /*
   * Optional, because a group is often opened before the couple have fixed the day. The generator
   * asks "Event Date Known" first and sends no date when the answer is no; the generated name then
   * carries none rather than a guessed one.
   */
  mainEventDate: z.coerce.date().nullable().optional(),
}).superRefine((data, context) => {
  const requireField = (field, label) => {
    if (!String(data[field] || "").trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${label} is required.` });
  };
  if (data.groupType === "Dum Dum") {
    requireField("tier", "Tier");
    requireField("groomName", "Groom Name");
    requireField("brideName", "Bride Name");
    requireField("socialMediaPosting", "Social Media Posting");
    return;
  }
  if (data.groupType === "Qua Qua") {
    requireField("clientName", "Client Name");
    requireField("eventName", "Event");
    requireField("socialMediaPosting", "Social Media Posting");
    requireField("houseType", "House Type");
    if (typeof data.gou !== "boolean") context.addIssue({ code: z.ZodIssueCode.custom, path: ["gou"], message: "GOU is required." });
    return;
  }
  requireField("clientName", "Client Name");
});

// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.

function cleanData(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === "" ? null : value]));
}

function formatDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(date).replaceAll(" ", "-");
}

function derivedVertical(groupType) {
  return groupType === "Dum Dum" ? "WED" : groupType === "Qua Qua" ? "QQ" : "CORP";
}

/*
 * Must stay in step with `buildGroupName` in the browser, which previews the same string: the name
 * the server writes is the one the generator showed. A name with no date drops the segment rather
 * than leaving an empty one, so it never ends in a dangling separator.
 */
function buildGeneratedName(data) {
  const date = formatDate(data.mainEventDate);
  if (data.groupType === "Dum Dum") {
    const head = ["WED", data.tier, data.branch, data.offerName, `${data.groomName} & ${data.brideName}`].filter(Boolean).join(" ");
    return [head, data.socialMediaPosting, data.place, date].filter(Boolean).join(" | ");
  }
  if (data.groupType === "Qua Qua") {
    // "QQ ERD", not "QQERD": a segment of its own, as the branch already is on the other two verticals.
    const details = ["QQ", data.branch, data.offerName, data.clientName].filter(Boolean).join(" ");
    return [details, data.eventName, data.socialMediaPosting, data.houseType, data.gou ? "GOU" : null, data.place, date].filter(Boolean).join(" | ");
  }
  return [["CORP", data.branch, data.offerName, data.clientName].filter(Boolean).join(" "), data.place, date].filter(Boolean).join(" | ");
}

async function listGroupNames(req, res) {
  const includeUsed = String(req.query.includeUsed || "").toLowerCase() === "true";
  try {
    const now = new Date();
    // Retain expired records for history/viewing, but make their lifecycle explicit.
    await prisma.salesWhatsappGroupName.updateMany({
      where: { status: "Available", usedAt: null, expiresAt: { lte: now } },
      data: { status: "Expired" },
    });
    // A saved name belongs to the branch it was generated for, so it is offered to the people who
    // reach that branch. Resolved against the register's permissions, which is what this list is
    // read from; a name has no owner, so TEAM and SELF answer as Their branches does.
    const scope = await dataScope.resolve({ userId: Number(req.user.id), permissions: REGISTER_READERS, columns: { branch: "branchId", user: "createdByUserId" } });
    const data = await prisma.salesWhatsappGroupName.findMany({
      where: { AND: [scope.where], ...(includeUsed ? {} : { status: "Available", usedAt: null, expiresAt: { gt: now } }) },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to load WhatsApp group names:", error);
    return res.status(500).json({ message: "Unable to load WhatsApp group names." });
  }
}

async function createGroupName(req, res) {
  const parsed = groupNameSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  const data = parsed.data;

  /*
   * The branch is a row in the locations master data, and the caller must actually reach it.
   * The picker in the dialog is already narrowed the same way, but the browser is never the
   * guard - without this, any branch name at all could be posted straight to the API.
   */
  const location = await prisma.branch.findFirst({ where: { name: data.branch, isActive: true }, select: { id: true } });
  if (!location) return res.status(400).json({ message: `"${data.branch}" is not an active branch.` });
  /*
   * The **same pair the route's guard names** - Sales Manager or Projects - and not the CRM's
   * permission, which this route does not ask for at all. Scoped to something the guard does not
   * require, a Sales Manager holder without CRM Leads reached no branch and was refused every save.
   */
  const reachable = await iamService.reachableBranchIds(req.user.id, {
    permissions: [{ module: "SALES", feature: "Sales Manager" }, { module: "PROJECT", feature: "Projects" }],
    // At **write** level, because this handler saves. Asked at READ, a role that only ever let
    // somebody look at a branch would hand them that branch to file a group name against.
    level: "READ_WRITE",
  });
  if (reachable !== null && !reachable.includes(location.id)) {
    return res.status(403).json({ message: "You do not have access to this branch." });
  }

  const payload = { ...data, vertical: derivedVertical(data.groupType) };
  const generatedName = buildGeneratedName(payload);
  const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  try {
    const created = await prisma.salesWhatsappGroupName.create({
      data: {
        groupType: data.groupType,
        branch: data.branch,
        // Resolved above against the branch table, so the reference is that row rather than a re-match.
        branchId: location.id,
        verticalId: (await referenceLookups()).verticalId(payload.vertical),
        enquiryId: data.enquiryId,
        offerName: data.offerName,
        clientName: data.clientName,
        groomName: data.groomName,
        brideName: data.brideName,
        eventName: data.eventName,
        socialMediaPosting: data.socialMediaPosting,
        houseType: data.houseType,
        gou: data.gou,
        place: data.place,
        mainEventDate: data.mainEventDate,
        vertical: payload.vertical,
        generatedName,
        generatorPayload: payload,
        expiresAt,
        createdByUserId: req.user.id,
      },
    });
    return res.status(201).json({ data: created });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This WhatsApp group name already exists." });
    console.error("Unable to save WhatsApp group name:", error);
    return res.status(500).json({ message: "Unable to save WhatsApp group name." });
  }
}

module.exports = { listGroupNames, createGroupName, buildGeneratedName, groupNameSchema };
