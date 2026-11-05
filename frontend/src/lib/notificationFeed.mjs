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

/*
 * ── Marked as read, and gone ─────────────────────────────────────────────────────────────────
 *
 * Every row on the bell leaves it once it has been read, which is opening it - there is no "Mark as
 * read", so a notice stays until the page it points at has been looked at. A
 * stored notice is marked on the server and simply stops being listed. A derived notice or a meeting
 * has no read state of its own, so the ids this reader has dismissed are kept in their browser and
 * filtered out here.
 */

/** The entries this reader has not dismissed. */
export function withoutDismissed(entries, dismissed) {
  const hidden = new Set((dismissed || []).map(String));
  return (entries || []).filter((entry) => !hidden.has(String(entry.id)));
}

/**
 * The dismissed ids still worth remembering: only those the bell is still being sent. A notice that
 * has gone from the reply - the follow-up was made, the meeting is over - needs no hiding, so the
 * list can never grow past what is outstanding.
 */
export function pruneDismissed(dismissed, entries) {
  const live = new Set((entries || []).map((entry) => String(entry.id)));
  return (dismissed || []).map(String).filter((id) => live.has(id));
}
