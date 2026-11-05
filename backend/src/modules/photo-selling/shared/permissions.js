/**
 * Photo Selling answers to one permission of its own, under the module whose sidebar section it sits
 * in. The `module:feature` pair is identical in `prisma/seeds/permission-catalogue.js`, migration
 * 20261023130000_photo_selling and the web's `constants/modulePermissions.js`.
 */
const MODULE = "IMAGE_SELECTION";
const FEATURE = "Photo Selling";

module.exports = { MODULE, FEATURE };
