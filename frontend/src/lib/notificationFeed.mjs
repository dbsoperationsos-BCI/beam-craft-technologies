/**
 * Reading the bell's reply, kept out of the hook so it can be tested without rendering one — the
 * same split `lib/meetings.js` uses beside the meetings half of the same panel.
 *
 * There is one function here and it exists because getting it wrong is invisible. The badge counts
 * from `meta.unreadCount` and the list is drawn from the rows, so a reply read from the wrong place
 * leaves the bell saying "3" over a panel reading "No task notifications." — which is exactly what
 * shipped: the endpoint used to answer with the stored rows as `data`, then grew a second half
 * (`notices`, the derived ones the other hook draws) and became
 * `{ data: { notifications, notices, sources } }`. The hook went on asking `Array.isArray(data)`,
 * which is now false for every reply, and dropped every stored notice on the floor.
 */

/**
 * The stored notifications out of a bell reply, whatever shape it arrives in.
 *
 * The current `{ data: { notifications } }` first, then a bare `data` array for anything still
 * answering the old way — an older server behind a newly deployed browser is a real few minutes
 * during a release, and it costs one line to keep the bell working through it.
 */
export function storedNotifications(response) {
  const data = response?.data;
  if (Array.isArray(data?.notifications)) return data.notifications;
  if (Array.isArray(data)) return data;
  return [];
}

/** The derived half, read the same way and from the same reply. */
export function sourceNotices(response) {
  const notices = response?.data?.notices;
  return Array.isArray(notices) ? notices : [];
}
