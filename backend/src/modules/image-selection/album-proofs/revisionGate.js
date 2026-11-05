/**
 * When the corrected spreads may be uploaded — the one rule, written once.
 *
 * A correction being resolved does not make a version. It unlocks the **upload** of the corrected
 * spreads, and only that upload landing creates the next version. Resolve, upload, create, submit
 * are four separate acts and this is the gate between the first and the second.
 *
 * Two conditions, and the second one is the one that is easy to miss: this round's source must
 * have raised corrections at all. Counting only what is unresolved makes zero corrections look
 * exactly like every correction resolved, which would offer a revised upload to an album that has
 * never been corrected.
 *
 * Both counts are the **album's** for that source, not the current version's, and deliberately so.
 * A correction reopened on a version the album has moved past is still outstanding and must lock
 * the upload again — counted per version it would block nothing, which is what once made Reopen a
 * button that silently did nothing. The same reasoning applies to the total: after V2 is submitted,
 * QC reopening a correction it raised on V1 is a real round of work, and a version-scoped total
 * would read it as "no corrections here" and refuse the upload that fixes it.
 */

const UNRESOLVED_STATUSES = ["OPEN", "IN_PROGRESS", "REOPENED"];

/**
 * Which corrections gate the round the album is in. The stage decides the source: a QC fix round
 * is gated by QC's corrections and a client revision by the client's, never by both together.
 */
const ROUND_SOURCE = {
  QC_CHANGES_REQUESTED: "QC",
  QC_REVISION_IN_PROGRESS: "QC",
  CLIENT_CHANGES_REQUESTED: "CLIENT",
  REVISION_IN_PROGRESS: "CLIENT",
};

/** The stages from which a revised upload can create the next version. */
const REVISING_STATES = ["QC_REVISION_IN_PROGRESS", "REVISION_IN_PROGRESS"];

const sourceLabel = (source) => (source === "QC" ? "QC" : "client");

/**
 * @param {{ status: string, roundTotal: number, unresolved: number }} input
 *   `roundTotal` counts every correction this round's source has raised on the album; `unresolved`
 *   counts the outstanding ones among them.
 * @returns {{ source: string|null, unlocked: boolean, reason: string }}
 */
function revisedUploadGate({ status, roundTotal = 0, unresolved = 0 } = {}) {
  const source = ROUND_SOURCE[status] || null;
  if (!source || !REVISING_STATES.includes(status)) return { source, unlocked: false, reason: "" };
  if (roundTotal === 0) return { source, unlocked: false, reason: `No ${sourceLabel(source)} corrections have been raised on this album.` };
  if (unresolved > 0) return { source, unlocked: false, reason: `${unresolved} ${sourceLabel(source)} correction${unresolved === 1 ? "" : "s"} still to resolve` };
  return { source, unlocked: true, reason: "" };
}

module.exports = { UNRESOLVED_STATUSES, ROUND_SOURCE, REVISING_STATES, revisedUploadGate, sourceLabel };
