const prisma = require("../../../config/db");
const { publishedSaleExtrasTotal } = require("../../sales/sale-extras/totals");
const { createSettingsService } = require("../../image-selection/settings/service");
const { postalLines } = require("../../../services/payslipHeading");

/*
 * The facts of one cash received entry's payment receipt (`services/paymentReceiptPdf.js` prints
 * them).
 *
 * - **Studio** - the name and logo from Organization → Branding, and the address, phone, email and
 *   GSTIN of the branch the money was received at; Head Office when the entry has no branch.
 * - **Bill to** - the enquiry's name, from the project's CRM lead: a Dum Dum lead's groom and bride
 *   ("Kavin and Thangamani", or the one given), any other lead's single name. Without a lead, the
 *   names the group name generator recorded; the WhatsApp group name staff read only when neither has
 *   one. Then the project's main number; and an email from the CRM lead (Official Email ID), or the client's
 *   login, whichever is there.
 * - **Balance due** - what the project still owes just after this payment: its signed value (the
 *   converted value plus approved extras, the Payments tab's arithmetic) less this payment and every
 *   one received before it - not the ones recorded since, so an older invoice keeps its own figure.
 *   Floored at zero, as the Payments tab reads an overpaid project. None when the entry is filed
 *   against no project.
 */

const branding = createSettingsService();
const BRANCH_SELECT = { name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, gstNumber: true, phone: true, email: true };

const trimmed = (value) => String(value || "").trim();
/** "Groom and Bride", or whichever of the two is given. */
const couple = (groom, bride) => [trimmed(groom), trimmed(bride)].filter(Boolean).join(" and ");

/**
 * The client's own name for the invoice: the enquiry's - a Dum Dum lead's groom and bride, or any
 * other lead's one name (a Corp lead without one, its company or decision maker) - then the names the
 * group name generator recorded. "" when neither holds one.
 */
function clientOwnName(project, lead) {
  const fromLead = couple(lead?.groomName, lead?.brideName)
    || trimmed(lead?.name) || trimmed(lead?.companyName) || trimmed(lead?.primaryDecisionMaker) || trimmed(lead?.babyOrMotherName);
  if (fromLead) return fromLead;
  const snapshot = project?.groupNameGeneratorJson && typeof project.groupNameGeneratorJson === "object" ? project.groupNameGeneratorJson : {};
  return couple(snapshot.groomName, snapshot.brideName) || trimmed(snapshot.clientName);
}

async function branchFor(entry, client) {
  const own = entry.branchId ? await client.branch.findUnique({ where: { id: entry.branchId }, select: BRANCH_SELECT }) : null;
  return own || client.branch.findFirst({ where: { isHeadOffice: true }, select: BRANCH_SELECT });
}

async function balanceDueFor(entry, project, client) {
  if (!project) return null;
  const [extras, received] = await Promise.all([
    client.projectExtraQuotation.aggregate({ where: { projectId: project.id, status: "APPROVED", deletedAt: null }, _sum: { amount: true } }),
    // This payment and every one before it: an earlier day, or the same day and recorded no later.
    client.cashEntry.aggregate({
      where: {
        projectId: project.id, entryType: "Received", deletedAt: null,
        OR: [{ entryDate: { lt: entry.entryDate } }, { entryDate: entry.entryDate, createdAt: { lte: entry.createdAt } }],
      },
      _sum: { amount: true },
    }),
  ]);
  // Plus the project's published Sale Extras (Edit Sale Details), counted once.
  const signed = Number(project.initialConvertedValue || 0) + Number(extras._sum.amount || 0) + await publishedSaleExtrasTotal(project.id, client);
  return Math.max(0, signed - Number(received._sum.amount || 0));
}

/** The receipt for a Received entry the caller has already scoped, or null for money spent. */
async function receiptFor(entry, { client = prisma, reader = branding } = {}) {
  if (!entry || entry.entryType !== "Received") return null;
  const [settings, branch, project] = await Promise.all([
    reader.read(),
    branchFor(entry, client),
    entry.projectId ? client.salesProject.findUnique({
      where: { id: entry.projectId },
      select: { id: true, eventId: true, enquiryId: true, whatsappGroupName: true, groupNameGeneratorJson: true, clientMainNumber: true, initialConvertedValue: true, clientLogin: { select: { email: true } } },
    }) : null,
  ]);
  const lead = project?.enquiryId
    ? await client.salesCrmLead.findFirst({ where: { enquiryId: project.enquiryId, deletedAt: null }, select: { officialEmailId: true, name: true, groomName: true, brideName: true, companyName: true, primaryDecisionMaker: true, babyOrMotherName: true } })
    : null;
  return {
    studio: {
      name: String(settings?.studioName || "").trim(),
      logoUrl: settings?.galleryLogoUrl || "",
      addressLines: postalLines(branch ? { ...branch, addressLine1: [branch.addressLine1, branch.addressLine2].filter(Boolean).join(", ") } : null),
      gstNumber: branch?.gstNumber || "",
      phone: branch?.phone || "",
      email: branch?.email || "",
    },
    payment: {
      number: entry.entryId,
      date: entry.entryDate,
      amount: Number(entry.amount),
      category: entry.category,
      mode: entry.paymentMode === "Other" && entry.paymentModeOther ? entry.paymentModeOther : entry.paymentMode,
      transactionId: entry.transactionId || "",
      receivedBy: entry.handler?.employeeName || entry.handlerName || "",
      balanceDue: await balanceDueFor(entry, project, client),
    },
    client: {
      name: clientOwnName(project, lead) || entry.clientName || project?.whatsappGroupName || "",
      phone: project?.clientMainNumber || "",
      email: String(lead?.officialEmailId || "").trim() || project?.clientLogin?.email || "",
      projectId: project?.eventId || "",
    },
  };
}

module.exports = { receiptFor, clientOwnName };
