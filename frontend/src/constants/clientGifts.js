/**
 * A client gift's statuses, in the order a gift moves through them. Keep this list in step with
 * `GIFT_STATUSES` in backend/src/modules/project-management/client-gifts/service.js — the server
 * refuses a status it does not list.
 */
export const CLIENT_GIFT_STATUSES = ["Yet To Sent", "Sent", "Received by Client"];
