const certificates = require("../../../services/experienceCertificate");
const offerDocument = require("../../../services/offerLetterDocument");

/*
 * My Profile → Offer Letter: the signed-in employee's own letter, as Settings → Employee → Certificate
 * → Offer Letter sets it up and filled from their record - once the days Settings names have passed
 * since their date of joining. Before then, or with nothing to count from, it says so and offers no
 * letter.
 */

const NO_EMPLOYEE = "This login has no employee record, so there is no offer letter to show.";

/** The signed-in employee's letter and where it stands: `{ status, availableOn, fileName, html }`. */
async function myOfferLetter(userId) {
  const employee = await offerDocument.offerEmployeeOfUser(userId);
  if (!employee) return null;
  const availability = offerDocument.offerAvailability(employee.dateOfJoining, await offerDocument.offerLetterAfterDays());
  return {
    employee,
    ...availability,
    fileName: offerDocument.offerLetterFileName(employee),
    html: availability.status === "READY" ? await offerDocument.employeeOfferLetterHtml(employee) : null,
  };
}

async function getMyOfferLetter(req, res) {
  try {
    const letter = await myOfferLetter(req.user?.id);
    if (!letter) return res.status(404).json({ message: NO_EMPLOYEE });
    const { status, availableOn, fileName, html } = letter;
    return res.json({ data: { status, availableOn, fileName, html } });
  } catch (error) {
    console.error("Unable to load the offer letter", error);
    return res.status(500).json({ message: "Unable to load your offer letter." });
  }
}

async function downloadMyOfferLetter(req, res) {
  try {
    const letter = await myOfferLetter(req.user?.id);
    if (!letter) return res.status(404).json({ message: NO_EMPLOYEE });
    if (letter.status !== "READY") return res.status(409).json({ message: "Your offer letter is not ready yet." });
    let pdf;
    try {
      pdf = await certificates.renderCertificatePdf(letter.html);
    } catch (error) {
      console.error("Unable to print the offer letter", error);
      return res.status(500).json({ message: "The PDF could not be prepared. Try again in a moment." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${letter.fileName}"`);
    res.setHeader("Content-Length", pdf.length);
    return res.end(pdf);
  } catch (error) {
    console.error("Unable to download the offer letter", error);
    return res.status(500).json({ message: "Unable to download your offer letter." });
  }
}

module.exports = { getMyOfferLetter, downloadMyOfferLetter };
