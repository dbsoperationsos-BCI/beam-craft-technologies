/**
 * Photos and tickets on their way to the server, kept in the browser until each one lands.
 *
 * The coordinator uploads from a phone at the venue, where the network is slow and drops. So every
 * file is its own item and its own request - one failure loses nothing else - and an item whose
 * upload fails **stays here** with its reason until the person retries or discards it. Photos are
 * already compressed by `MultiImageField` before they reach the queue. Successful items are dropped:
 * they are on the shoot now.
 */
let sequence = 0;

export function enqueueUploads(queue, kind, files, meta = {}) {
  return [...queue, ...(files || []).map((file) => {
    sequence += 1;
    const isPhoto = typeof file === "string";
    return {
      id: `upload-${Date.now()}-${sequence}`,
      kind,
      // A camera photo has no name of its own; its place in the queue tells it apart from the others.
      name: isPhoto ? `Photo ${sequence}.jpg` : String(file?.name || "File"),
      data: isPhoto ? file : file?.data,
      // Only a ticket upload carries this: the travel mode being picked, so the server can set it
      // without the plan having been saved first (`production/execution.js`'s `addFiles`).
      travelMode: meta?.travelMode || null,
      status: "waiting",
      error: "",
    };
  })];
}

export const markUpload = (queue, id, status, error = "") => queue.map((item) => (item.id === id ? { ...item, status, error } : item));
export const dropUpload = (queue, id) => queue.filter((item) => item.id !== id);
export const retryUploads = (queue, kind) => queue.map((item) => (item.kind === kind && item.status === "failed" ? { ...item, status: "waiting", error: "" } : item));
export const nextWaiting = (queue) => queue.find((item) => item.status === "waiting") || null;

/** One kind's items, how many are still to go, and how many failed. */
export function uploadsOf(queue, kind) {
  const items = queue.filter((item) => item.kind === kind);
  return { items, left: items.filter((item) => item.status !== "failed").length, failed: items.filter((item) => item.status === "failed").length };
}
