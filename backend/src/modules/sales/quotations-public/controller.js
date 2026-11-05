const prisma = require("../../../config/db");
const quotationBrands = require("../quotation-brands/service");
const { quotationLinkState, sendQuotationExpired, isDraftQuotation } = require("../projects/controller");

/**
 * The payment page behind a quotation's public link: `GET /api/public/quotations/:token/payment`.
 *
 * Reached by the same token as the quotation and held to the same three answers - 404 for a token
 * that is not one or a quotation that is gone, 410 for a link that has lapsed - so a client cannot
 * read where to pay a quotation they can no longer open. What comes back is
 * `quotationBrands.paymentDetailsForQuotation`: the Assigned Branch's account, UPI ID and QR as the
 * register holds them today, in the one shape the page is given, or null where the branch has no
 * way to be paid. Nothing of the branch row beyond that leaves the server - not its id, its phone,
 * its email or its registration - and the admin register at `/api/admin/branches` is not what this
 * reads, so nothing about who may manage a branch changes.
 */
async function publicQuotationPayment(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    if (!/^[A-Za-z0-9_-]{8}$/.test(token)) return res.status(404).json({ message: "Quotation not found." });
    const quotation = await prisma.salesQuotation.findUnique({ where: { publicToken: token } });
    // A draft has no link to pay against - it is not there at all, as on the quotation page.
    if (!quotation || quotation.deletedAt || isDraftQuotation(quotation)) return res.status(404).json({ message: "Quotation not found." });
    if (quotationLinkState(quotation).linkExpired) {
      return sendQuotationExpired(res);
    }
    // Never cached: a bank account is not something a shared proxy may hand to the next reader of
    // the same path. The same header every other public tokenized route sends.
    res.set("Cache-Control", "private, no-store");
    return res.json({ data: await quotationBrands.paymentDetailsForQuotation(quotation) });
  } catch (error) {
    console.error("Unable to load public quotation payment details:", error);
    return res.status(500).json({ message: "Unable to load payment details." });
  }
}

module.exports = { publicQuotationPayment };
