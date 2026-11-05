/**
 * The production log, written in the same transaction as the change it records (WhatsApp results
 * are written right after the send). Read oldest first on the Activity tab.
 */
const ACTIONS = [
  "PLAN_SAVED", "PLAN_SUBMITTED", "STEP_COMPLETED", "SHOOT_STATUS_CHANGED",
  "FILE_ADDED", "FILE_REMOVED", "WHATSAPP_SENT", "WHATSAPP_FAILED", "WHATSAPP_RETRIED",
  // The plan set to Hold / Rejected by hand, or back to automatic (Plan → Status).
  "PLAN_STATUS_CHANGED",
  // File in filled in for some of the shoot's services, with the step left where it is.
  "FOOTAGE_SAVED",
];

function logActivity(client, productionId, action, detail, caller) {
  return client.projectProductionActivity.create({
    data: { productionId, action, detail: detail ?? null, userId: caller?.userId || null, userName: String(caller?.name || "Unknown").slice(0, 191) },
  });
}

module.exports = { ACTIONS, logActivity };
