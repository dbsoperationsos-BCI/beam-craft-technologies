/**
 * Who hides a photo once a finalized run is reopened. The newest finalize owns a photo's stamp, so
 * undoing that finalize hands each photo it settled back to the newest OTHER finalized run that
 * analyzed it: hidden again when that run did not keep it, visible when it did (or when no other
 * finalized run covered it).
 *
 * @param {{ uploadId: string, sessionId: string, effectiveDecision: string, finalizedAt: Date }[]} rows
 *   results of the other FINALIZED runs on the photos being released
 * @returns {Map<string, string>} uploadId → the session whose stamp it gets back
 */
function olderVerdicts(rows) {
  const newest = new Map();
  for (const row of rows) {
    const current = newest.get(row.uploadId);
    if (!current || new Date(row.finalizedAt) > new Date(current.finalizedAt)) newest.set(row.uploadId, row);
  }
  const owners = new Map();
  for (const [uploadId, row] of newest) if (row.effectiveDecision !== "KEEP") owners.set(uploadId, row.sessionId);
  return owners;
}

module.exports = { olderVerdicts };
