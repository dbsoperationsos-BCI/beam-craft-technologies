import { apiRequest } from "@/services/api/client";

/*
 * Settings → Wishes, behind `SETTINGS / Wishes` (`/api/settings/wishes`): Read to open the wishes,
 * Read / Write to reword one.
 */
const ROOT = "/api/settings/wishes";

/**
 * Both lists of ten: `{ data: { birthday: [{ key, name, body, placeholders }], weddingAnniversary: [...] },
 * delivery: { groupName, sendAt, lastAttemptAt, lastError } }` - `delivery` being where and when they are sent.
 */
export function getWishes() {
  return apiRequest(ROOT);
}

/** Rewords one wish by its key. */
export function saveWish(key, body) {
  return apiRequest(`${ROOT}/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ body }) });
}

/*
 * Settings → Wishes → Wishes Scheduler: the WhatsApp group the wishes go to, when, and Priority 1 -
 * each answering the scheduler as it now stands, in Attendance WhatsApp Report's shape.
 */
export function getWishesScheduler() {
  return apiRequest(`${ROOT}/scheduler`);
}

export function listWishesSenderCandidates() {
  return apiRequest(`${ROOT}/scheduler/senders/candidates`);
}

export function setWishesGroupName(groupName) {
  return apiRequest(`${ROOT}/scheduler/group`, { method: "PUT", body: JSON.stringify({ groupName }) });
}

/** Clearing the name is how the wishes stop: until a group is named again, none is sent. */
export function clearWishesGroupName() {
  return setWishesGroupName("");
}

export function setWishesSendAt(sendAt) {
  return apiRequest(`${ROOT}/scheduler/send-at`, { method: "PUT", body: JSON.stringify({ sendAt }) });
}

/** Who sends it: `{ mode, senderUserId, userIds }` - Sender or Rotation, the one sender, the rotation order. */
export function setWishesSenders(input) {
  return apiRequest(`${ROOT}/scheduler/senders`, { method: "PUT", body: JSON.stringify(input) });
}
