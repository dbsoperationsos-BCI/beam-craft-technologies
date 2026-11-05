const express = require("express");
const { protect } = require("../../middleware/authMiddleware");
const { requireModule } = require("../../middleware/permissionMiddleware");
const { MODULE, FEATURE } = require("./shared/permissions");
const c = require("./controller");

/**
 * Everything under /api/photo-selling that staff call. The whole router answers to
 * IMAGE_SELECTION / Photo Selling - a GET needs Read, anything else Read / Write - and that guard is
 * the only thing deciding access. Galleries are studio-wide - not narrowed by branch - so the
 * permission must not go to a branch-scoped role until they are (docs/project-state/PHOTO-SELLING.md).
 *
 * The guest store is `public/routes.js` and the Cashfree webhook `payments/webhook.js`; neither is here.
 */
const router = express.Router();
router.use(protect);
router.use(requireModule(MODULE, FEATURE));

router.get("/status", c.status);
router.get("/overview", c.overview);
router.get("/watermark-presets", c.watermarkPresets);
router.get("/settings", c.getSettings);
router.put("/settings", c.saveSettings);
router.get("/settings/qr-sample", c.qrSample);

router.get("/galleries", c.listGalleries);
router.post("/galleries", c.createGallery);
router.get("/galleries/:galleryId", c.getGallery);
router.patch("/galleries/:galleryId", c.updateGallery);
router.delete("/galleries/:galleryId", c.removeGallery);
router.get("/galleries/:galleryId/preview", c.previewGallery);
router.get("/galleries/:galleryId/qr-kit", c.qrKit);
router.post("/galleries/:galleryId/publish", c.publishGallery);
router.post("/galleries/:galleryId/unpublish", c.unpublishGallery);
router.post("/galleries/:galleryId/duplicate", c.duplicateGallery);
router.post("/galleries/:galleryId/archive", c.archiveGallery);
router.post("/galleries/:galleryId/restore", c.restoreGallery);
router.patch("/galleries/:galleryId/link", c.updateLink);
router.get("/galleries/:galleryId/photos", c.listPhotos);
router.post("/galleries/:galleryId/photos/upload", c.uploadPhoto);
router.post("/galleries/:galleryId/photos/remove", c.removePhotos);
router.post("/galleries/:galleryId/photos/reindex", c.reindexPhotos);
router.patch("/galleries/:galleryId/photos", c.updatePhotos);
router.put("/galleries/:galleryId/packages", c.savePackages);

router.get("/orders", c.listOrders);
router.get("/orders/:orderId", c.getOrder);
router.post("/orders/:orderId/verify", c.verifyOrder);
router.post("/orders/:orderId/reissue-link", c.reissueLink);

module.exports = router;
