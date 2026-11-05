const prisma = require("../config/db");

/**
 * The three businesses the studio runs, and the one name each of them answers to.
 *
 * A vertical is written down in two alphabets: a CRM lead calls it "Dum Dum", while the WhatsApp
 * group name generator and `sales_project.vertical` call the same thing "WED". Every screen that
 * had to line the two up did it with its own inline ternary, so a project whose group name was
 * typed by hand — and therefore never went through the generator — carried no vertical at all,
 * even though the lead behind it always knew which business it belonged to.
 *
 * `verticalCode` reads either alphabet and answers in the stored one; `verticalName` goes the
 * other way, for anything a person reads.
 */

const VERTICAL_CODES = ["WED", "QQ", "CORP"];

const NAME_BY_CODE = { WED: "Dum Dum", QQ: "Qua Qua", CORP: "Corp" };

// Both spellings of each vertical. The run-together forms are here because the CRM has been seen
// holding them, and a lead spelled "QuaQua" is not a lead without a vertical.
const CODE_BY_LABEL = {
  wed: "WED", wedding: "WED", "dum dum": "WED", dumdum: "WED",
  qq: "QQ", "qua qua": "QQ", quaqua: "QQ", ququa: "QQ",
  corp: "CORP", corporate: "CORP",
};

/** The stored code for a vertical written either way, or null when it is blank or unrecognised. */
function verticalCode(value) {
  const key = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return CODE_BY_LABEL[key] || null;
}

/** The name a person reads for a vertical written either way, or "" when there is none. */
function verticalName(value) {
  const code = verticalCode(value);
  return code ? NAME_BY_CODE[code] : "";
}

/**
 * Fills the vertical in on rows that were saved without one, from the lead behind the enquiry.
 *
 * Read-side rather than a one-off backfill, because a lead can be moved to another vertical after
 * the row exists, and because everything saved before this fallback existed would otherwise stay
 * blank for good. One query for all the enquiries that need it, not one per row.
 *
 * Each row needs a `vertical` and an `enquiryId`; rows that already have a vertical are returned
 * untouched, including their object identity.
 */
async function fillVerticalsFromLeads(rows) {
  const enquiryIds = [...new Set(rows.filter((row) => !row.vertical && row.enquiryId).map((row) => row.enquiryId))];
  if (!enquiryIds.length) return rows;
  const leads = await prisma.salesCrmLead.findMany({
    where: { enquiryId: { in: enquiryIds }, deletedAt: null },
    select: { enquiryId: true, verticalName: true },
  });
  const branchByEnquiryId = new Map(leads.map((lead) => [lead.enquiryId, lead.verticalName]));
  return rows.map((row) => row.vertical ? row : { ...row, vertical: verticalCode(branchByEnquiryId.get(row.enquiryId)) });
}

module.exports = { VERTICAL_CODES, NAME_BY_CODE, verticalCode, verticalName, fillVerticalsFromLeads };
