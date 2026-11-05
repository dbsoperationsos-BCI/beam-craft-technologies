/**
 * Meta's delivery report (settings/whatsapp-activity/metaWebhook.js) applied to a guest photo-match
 * message - the AI Feature's `aiEventNotification` and Photo Selling's `photoSaleNotification` - by
 * the message id Meta answered the send with. Each feature names its own tables; the rules are one.
 *
 * Only forward: SENT → DELIVERED → READ, each a conditional update, so a webhook Meta sends twice or
 * out of order matches no row and changes nothing. FAILED is taken only by a message still SENT: one
 * Meta already reported delivered or read stays so, and its matches stay with it.
 *
 * A failure is Meta saying it accepted the message and could not deliver it - nothing reached the
 * guest. Its matches are given back for the next run only for a passing reason (`RETRYABLE`), and
 * only while the guest has had at most `MAX_RELEASES` such reports, so a number Meta keeps refusing
 * is not written to on every run. Any other code keeps them claimed: a bad number would only fail
 * again. The status and the release are one transaction, taken only by the update that moved the
 * row, so a duplicate failure report releases nothing. The limit is counted inside that transaction
 * without locking the guest, so two failures for one guest at the same instant may each pass it -
 * at most one extra release, accepted rather than locking every guest row.
 *
 * Rows the webhook never touches: QUEUED and SENDING (no id yet), MOCK_SENT (no Meta id), UNCERTAIN
 * (no id; never resent), FAILED and SKIPPED.
 */
const RANK = { SENT: 1, DELIVERED: 2, READ: 3 };

/**
 * Meta's delivery-failure codes for a passing condition: rate limits (not 131048, the number's own
 * spam limit, which a prompt resend would only worsen), Meta's own errors, maintenance.
 */
const RETRYABLE = new Set(["130429", "131056", "131000", "131016", "133004", "131057"]);

/** Failure reports per guest, this one included, after which matches stay claimed. */
const MAX_RELEASES = 3;

async function applyDeliveryStatus(db, { notification, match }, providerMessageId, status, { at = new Date(), errorCode = null, errorMessage = null } = {}) {
  const id = String(providerMessageId || "").trim();
  const wanted = String(status || "").toUpperCase();
  if (!id) return 0;

  if (wanted === "FAILED") {
    const rows = await db[notification].findMany({ where: { providerMessageId: id, status: "SENT" }, select: { id: true, guestId: true } });
    let applied = 0;
    for (const row of rows) {
      const code = errorCode != null && String(errorCode).trim() ? String(errorCode).trim() : null;
      applied += await db.$transaction(async (tx) => {
        const { count } = await tx[notification].updateMany({
          where: { id: row.id, status: "SENT" },
          data: { status: "FAILED", errorCode: (code ? `META_${code}` : "META_DELIVERY_FAILED").slice(0, 80), errorMessage: String(errorMessage || "Meta could not deliver the message.").slice(0, 500) },
        });
        if (!count) return 0;
        if (code && RETRYABLE.has(code)) {
          // Failures after Meta accepted the send carry its id; a refused send never got one.
          const reports = await tx[notification].count({ where: { guestId: row.guestId, status: "FAILED", providerMessageId: { not: null } } });
          if (reports <= MAX_RELEASES) {
            // By primary key, so the release takes no range lock a run claiming this guest's matches could wait on.
            const ids = (await tx[match].findMany({ where: { notificationId: row.id }, select: { id: true } })).map((item) => item.id);
            if (ids.length) await tx[match].updateMany({ where: { id: { in: ids }, notificationId: row.id }, data: { notificationId: null } });
          }
        }
        return 1;
      });
    }
    return applied;
  }

  if (wanted === "DELIVERED") {
    const { count } = await db[notification].updateMany({ where: { providerMessageId: id, status: "SENT" }, data: { status: "DELIVERED", deliveredAt: at } });
    return count;
  }
  if (wanted === "READ") {
    // A read message was delivered too: one whose delivered report never came gets that time as well.
    const fromSent = await db[notification].updateMany({ where: { providerMessageId: id, status: "SENT" }, data: { status: "READ", readAt: at, deliveredAt: at } });
    const fromDelivered = await db[notification].updateMany({ where: { providerMessageId: id, status: "DELIVERED" }, data: { status: "READ", readAt: at } });
    return fromSent.count + fromDelivered.count;
  }
  return 0;
}

module.exports = { RANK, RETRYABLE, MAX_RELEASES, applyDeliveryStatus };
