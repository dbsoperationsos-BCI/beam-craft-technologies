const { requireModule } = require("../../../middleware/permissionMiddleware");

/*
 * Who may do what with a Signature Album, mapped onto the application's own permission system
 * rather than a second one.
 *
 *   view_signature_album             IMAGE_SELECTION / Signature Album  READ
 *   edit_signature_album             IMAGE_SELECTION / Signature Album  READ_WRITE
 *   publish_signature_album          IMAGE_SELECTION / Signature Album  READ_WRITE
 *   share_signature_album            IMAGE_SELECTION / Signature Album  READ_WRITE
 *   manage_signature_album_settings  SETTINGS / Organization            READ_WRITE
 *
 * One row for the album because the same people do all of it, and the studio-wide defaults sit
 * behind the permission of the Settings panel they are edited in. A Super Admin passes every guard
 * exactly as elsewhere. The tab is only reachable inside a project the `Project Management` row
 * already opens; these guards are what the album's own API answers to.
 */
const ALBUM_PERMISSION = { module: "IMAGE_SELECTION", feature: "Signature Album" };
const SETTINGS_PERMISSION = { module: "SETTINGS", feature: "Organization" };

const requireAlbumAccess = () => requireModule(ALBUM_PERMISSION.module, ALBUM_PERMISSION.feature);
const requireSettingsAccess = () => requireModule(SETTINGS_PERMISSION.module, SETTINGS_PERMISSION.feature);

module.exports = { ALBUM_PERMISSION, SETTINGS_PERMISSION, requireAlbumAccess, requireSettingsAccess };
