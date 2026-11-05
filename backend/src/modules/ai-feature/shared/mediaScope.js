/**
 * Which media rows an event "has" - the one predicate All Photos, the event's media count and the
 * guest gallery all read, so no two of them can ever disagree about a photo.
 *
 * A row is listed when it is live (`deletedAt` null) and either sits in a folder or is a guest's
 * upload from the event page (which names no folder by design). Staff media belongs to a folder,
 * and deleting a folder deletes its photos; a staff row in no folder is therefore a leftover from
 * before that rule, listed nowhere even while it still exists (`scripts/cleanupOrphanAiMedia.js`
 * retires it).
 *
 * "A guest's upload" is read from the staff side - `uploadedByUserId` null - and never from
 * `uploadedByGuestId`: the guest relation is SetNull, so removing a guest wipes that column while
 * the photo stays the event's. Every staff upload records its user, so "no user" is exactly "a
 * guest's", whether or not the guest still exists. (The user relation is SetNull too: a leftover
 * of a staff member since deleted would be listed rather than retired - the harmless way round.)
 */
const LISTED_MEDIA = Object.freeze({ deletedAt: null, OR: [{ folderId: { not: null } }, { uploadedByUserId: null }] });

module.exports = { LISTED_MEDIA };
