const prisma = require("../../../config/db");

/**
 * The event timeline. Every service records through here, and only through here, so the two
 * things that must never be written - a face vector, a token or PIN - have no path in.
 */
const EVENTS = Object.freeze({
  EVENT_CREATED: "EVENT_CREATED", EVENT_UPDATED: "EVENT_UPDATED", EVENT_DUPLICATED: "EVENT_DUPLICATED", EVENT_ARCHIVED: "EVENT_ARCHIVED", EVENT_RESTORED: "EVENT_RESTORED", EVENT_DELETED: "EVENT_DELETED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED", SUB_EVENTS_UPDATED: "SUB_EVENTS_UPDATED",
  GUEST_ADDED: "GUEST_ADDED", GUESTS_IMPORTED: "GUESTS_IMPORTED", GUEST_UPDATED: "GUEST_UPDATED", GUEST_REMOVED: "GUEST_REMOVED", GUEST_JOINED: "GUEST_JOINED", GUEST_SELFIE_ADDED: "GUEST_SELFIE_ADDED",
  MEDIA_UPLOADED: "MEDIA_UPLOADED", MEDIA_DELETED: "MEDIA_DELETED",
  AI_PROCESSING_STARTED: "AI_PROCESSING_STARTED", AI_PROCESSING_COMPLETED: "AI_PROCESSING_COMPLETED", AI_PROCESSING_FAILED: "AI_PROCESSING_FAILED", AI_PROCESSING_RETRIED: "AI_PROCESSING_RETRIED",
  FACES_DETECTED: "FACES_DETECTED", MATCH_CREATED: "MATCH_CREATED", MATCH_CONFIRMED: "MATCH_CONFIRMED", MATCH_REJECTED: "MATCH_REJECTED",
  PERSON_RENAMED: "PERSON_RENAMED", PERSON_MERGED: "PERSON_MERGED", PERSON_SPLIT: "PERSON_SPLIT", PERSON_HIDDEN: "PERSON_HIDDEN", PERSON_LINKED: "PERSON_LINKED",
  EVENT_SHARED: "EVENT_SHARED", SHARE_REVOKED: "SHARE_REVOKED",
});

const staffActor = (user) => ({ actorType: "STAFF", actorUserId: user?.id ?? null, actorLabel: user?.name ?? user?.email ?? null });
const guestActor = (guest) => ({ actorType: "GUEST", actorUserId: null, actorLabel: guest?.name ?? "Guest" });
const systemActor = () => ({ actorType: "SYSTEM", actorUserId: null, actorLabel: "AI processing" });

/** Never throws: a timeline that cannot be written must not fail the action it describes. */
async function record(eventId, event, actor, detail = null, client = prisma) {
  try {
    await client.aiEventActivity.create({ data: { eventId, event, detail: detail == null ? null : String(detail).slice(0, 4000), ...actor }, select: { id: true } });
  } catch (error) {
    console.error("[ai-feature] Unable to record activity:", error.message);
  }
}

async function list(eventId, { limit = 50, before = null } = {}) {
  return prisma.aiEventActivity.findMany({ where: { eventId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 200) });
}

async function recent({ limit = 30 } = {}) {
  return prisma.aiEventActivity.findMany({ where: { aiEvent: { deletedAt: null } }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100), include: { aiEvent: { select: { id: true, name: true } } } });
}

module.exports = { EVENTS, staffActor, guestActor, systemActor, record, list, recent };
