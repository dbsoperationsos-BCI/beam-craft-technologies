const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkAnyPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();

router.use(protect);

/*
 * Two readers, two guards.
 *
 * The configuration - which services a brand offers, its packages, its terms - is what the
 * Quotation Generator loads the moment a brand is picked, so anyone who may *read* quotations may
 * read it; and the administrator configuring it from Settings reads the same answer, so the
 * System Settings read opens it too. Neither read hands out anything a quotation itself would not
 * print.
 *
 * Changing it is administration. The `/admin` routes answer for `ADMIN / System Settings`, the
 * same permission that owns the Global Logo and the studio's other application-wide settings, and
 * `requireModule` reads GET at READ and everything else at READ_WRITE - a route added under it
 * later is guarded the moment it is written. A quotation writer without that permission can raise
 * quotations from the configuration and cannot touch it.
 */
const readsConfiguration = checkAnyPermission([
  { module: "SALES", feature: "Quotation Management", level: "READ" },
  { module: "SETTINGS", feature: "Quotation Settings", level: "READ" },
]);

router.get("/", readsConfiguration, controller.listBrands);
router.get("/:code/configuration", readsConfiguration, controller.getConfiguration);

const admin = express.Router();
admin.use(requireModule("SETTINGS", "Quotation Settings"));
// The studio's shared content, ahead of `/:code` so "general" is never read as a brand.
admin.get("/general", controller.getGeneral);
admin.patch("/general", controller.updateGeneral);
admin.get("/:code", controller.getAdminConfiguration);
admin.patch("/:code", controller.updateBrand);
/*
 * There are no write routes for a brand's services, deliverables or packages, and that is
 * deliberate: the screens that managed them were removed at the studio's request, and the routes
 * outlived them with nothing calling them. What is left is a brand's terms and the shared general
 * content, which Settings → Quotation Settings does still manage.
 *
 * The masters are still *read* - `GET /:code/configuration` returns them, and the generator prices
 * off them where a brand has any - so a row already in those tables goes on working. Nothing here
 * can create or change one.
 */
/*
 * The shoots a brand quotes for, edited in Settings → Field Settings → Quotation → Shoot Type.
 *
 * Under `/admin` with the terms, so it answers to `ADMIN / System Settings` - the permission that
 * owns Quotation Settings. Changing which shoots a brand quotes for changes what every quotation
 * raised under it may contain, which is administration rather than day-to-day sales.
 */
admin.post("/:code/shoots", controller.createShoot);
admin.put("/:code/shoots/order", controller.reorderShoots);
admin.patch("/:code/shoots/:id", controller.updateShoot);
admin.delete("/:code/shoots/:id", controller.deleteShoot);
admin.post("/:code/terms", controller.createTerm);
admin.put("/:code/terms/order", controller.reorderTerms);
admin.patch("/:code/terms/:id", controller.updateTerm);
admin.delete("/:code/terms/:id", controller.deleteTerm);
router.use("/admin", admin);

module.exports = router;
