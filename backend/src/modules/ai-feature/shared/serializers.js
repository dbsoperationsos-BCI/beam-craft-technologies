const storage = require("./storage");

/** Numbers and URLs the browser can use; never a key of a private object, never a vector. */
const toNumber = (value) => (typeof value === "bigint" ? Number(value) : value);

function serializeMedia(row) {
  if (!row) return null;
  return {
    id: row.id, eventId: row.eventId, folderId: row.folderId, kind: row.kind, fileName: row.fileName, mimeType: row.mimeType,
    sizeBytes: toNumber(row.sizeBytes), width: row.width, height: row.height, capturedAt: row.capturedAt,
    previewUrl: row.kind === "VIDEO" ? storage.publicUrl(row.originalKey) : storage.publicUrl(row.previewKey),
    thumbnailUrl: storage.publicUrl(row.thumbnailKey),
    originalUrl: row.originalKey ? storage.publicUrl(row.originalKey) : null,
    aiStatus: row.aiStatus, aiAttempts: row.aiAttempts, aiError: row.aiError, faceCount: row.faceCount,
    uploadedByGuestId: row.uploadedByGuestId ?? null, createdAt: row.createdAt,
    ...(row.faces ? { faces: row.faces.map(serializeFace) } : {}),
  };
}

function serializeFace(row) {
  if (!row) return null;
  return { id: row.id, mediaId: row.mediaId, personId: row.personId, box: row.box, quality: row.quality, detScore: row.detScore, hasThumbnail: Boolean(row.thumbnailKey) };
}

function serializeEvent(row) {
  if (!row) return null;
  const counts = row._count || {};
  return {
    id: row.id, name: row.name, eventType: row.eventType, startDate: row.startDate, endDate: row.endDate, timezone: row.timezone, location: row.location, description: row.description,
    coverUrl: storage.publicUrl(row.coverKey), status: row.status, branch: row.branch, branchId: row.branchId,
    archivedAt: row.archivedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, createdByUserId: row.createdByUserId,
    guestCount: counts.guests ?? row.guestCount ?? 0, mediaCount: counts.media ?? row.mediaCount ?? 0, faceCount: counts.faces ?? row.faceCount ?? 0,
    ...(row.subEvents ? { subEvents: row.subEvents.map(serializeSubEvent) } : {}),
    ...(row.setting ? { settings: { guestAccess: row.setting.guestAccess, ai: row.setting.ai, media: row.setting.media, gallery: row.setting.gallery, privacy: row.setting.privacy, notifications: row.setting.notifications } } : {}),
    ...(row.share ? { share: serializeShareSummary(row.share) } : {}),
    ...(row.processing ? { processing: row.processing } : {}),
  };
}

const serializeSubEvent = (row) => row && ({ id: row.id, eventId: row.eventId, name: row.name, date: row.date, startTime: row.startTime, endTime: row.endTime, location: row.location, description: row.description, sortOrder: row.sortOrder });

const serializeGuest = (row) => row && ({ id: row.id, eventId: row.eventId, groupId: row.groupId, name: row.name, phone: row.phone, email: row.email, rsvp: row.rsvp, selfieStatus: row.selfieStatus, matchedCount: row.matchedCount, source: row.source, joinedAt: row.joinedAt, lastSeenAt: row.lastSeenAt, notes: row.notes, createdAt: row.createdAt, ...(row.group ? { group: { id: row.group.id, name: row.group.name } } : {}) });

const serializeGroup = (row) => row && ({ id: row.id, eventId: row.eventId, name: row.name, subEventIds: Array.isArray(row.subEventIds) ? row.subEventIds : [], sortOrder: row.sortOrder, guestCount: row._count?.guests ?? undefined });

const serializeFolder = (row) => row && ({ id: row.id, eventId: row.eventId, subEventId: row.subEventId, name: row.name, sortOrder: row.sortOrder, mediaCount: row._count?.media ?? undefined });

const serializePerson = (row) => row && ({ id: row.id, eventId: row.eventId, label: row.label, guestId: row.guestId, faceCount: row.faceCount, mediaCount: row.mediaCount, coverFaceId: row.coverFaceId, hidden: row.hidden, createdAt: row.createdAt, ...(row.guest ? { guest: { id: row.guest.id, name: row.guest.name } } : {}) });

const serializeMatch = (row) => row && ({ id: row.id, eventId: row.eventId, guestId: row.guestId, mediaId: row.mediaId, faceId: row.faceId, personId: row.personId, band: row.band, status: row.status, source: row.source, createdAt: row.createdAt, updatedAt: row.updatedAt, ...(row.media ? { media: serializeMedia(row.media) } : {}), ...(row.guest ? { guest: { id: row.guest.id, name: row.guest.name } } : {}) });

const serializeShareSummary = (row) => row && ({ id: row.id, status: row.status, shortCode: row.shortCode, hasPin: Boolean(row.pinHash), expiresAt: row.expiresAt, revokedAt: row.revokedAt, accessCount: row.accessCount, lastAccessAt: row.lastAccessAt, createdAt: row.createdAt });

const serializeActivity = (row) => row && ({ id: row.id, eventId: row.eventId, actorType: row.actorType, actorLabel: row.actorLabel, actorUserId: row.actorUserId, event: row.event, detail: row.detail, createdAt: row.createdAt, ...(row.aiEvent ? { eventName: row.aiEvent.name } : {}) });

module.exports = { toNumber, serializeEvent, serializeSubEvent, serializeGuest, serializeGroup, serializeFolder, serializeMedia, serializeFace, serializePerson, serializeMatch, serializeShareSummary, serializeActivity };
