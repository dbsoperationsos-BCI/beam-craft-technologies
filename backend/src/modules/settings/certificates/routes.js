const express = require("express");
const multer = require("multer");
const { MAX_FILE_BYTES } = require("../../../services/offerLetterImport");
const { protect } = require("../../../middleware/authMiddleware");
const controller = require("./controller");

/*
 * Settings → Employee → Certificate, mounted at /api/settings/certificates. Signed in, then an
 * administrator - the whole Certificate group is an administrator's, as the screen offers it only to
 * one (`isAdministrator`), so no permission is granted role by role here.
 */
const router = express.Router();
router.use(protect);
router.use(controller.requireAdministrator);

// When each employee's offer letter is generated - days after joining.
router.get("/offer-letter/timing", controller.getOfferLetterTiming);
router.put("/offer-letter/timing", controller.saveOfferLetterTiming);
// The letter's own sections after Employment Details and Compensation.
router.get("/offer-letter/sections", controller.getOfferLetterSections);
router.put("/offer-letter/sections", controller.saveOfferLetterSections);
// The letter drawn with sections still being edited - nothing saved.
router.post("/offer-letter/sections/preview", controller.previewOfferLetterSections);
// A .docx read into sections for review - one file, 5 MB at most, held in memory and never stored.
const docxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } }).single("file");
router.post("/offer-letter/sections/import", (req, res, next) => docxUpload(req, res, (error) => {
  if (!error) return next();
  return res.status(400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Choose a .docx file of 5 MB or less." : "Choose one .docx file." });
}), controller.importOfferLetterSections);
// Which of Employment Details' and Compensation's lines print (and the Deductions summary).
router.put("/offer-letter/employment", controller.saveOfferLetterEmployment);
router.put("/offer-letter/compensation", controller.saveOfferLetterCompensation);
// `:kind` is `experience`, `employment` or `offer` (the Offer Letter's sign-off); any other answers 404.
router.get("/:kind", controller.getCertificate);
router.put("/:kind", controller.saveCertificate);
// The preview of unsaved edits - nothing is stored.
router.post("/:kind/preview", controller.previewCertificate);

module.exports = router;
