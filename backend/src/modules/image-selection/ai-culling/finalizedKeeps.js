/**
 * The one rule every send out of AI Culling follows: a run's photos go on only once the run is
 * FINALIZED. A run still analysing, waiting for review, cancelled, failed or reopened has no
 * verdict the photographer stands behind, so its Keeps are refused by name (409 `notFinalized`
 * with the run's status) rather than sent from the AI's suggestions. Used by AI Editing's add,
 * the Signature Album's import and AI Culling's own send to Photo Selection, so no destination
 * can be reached around it.
 *
 * Returns the run's upload ids for `decision` (KEEP unless said), the first `limit` in the run's
 * own order - or, given `uploadIds` (photos ticked in the run's review), those of them this run
 * analysed, whatever their verdict, in the order ticked; an id from outside the run is dropped.
 * 404 when the run is not this project's.
 */
const FINALIZED = "FINALIZED";

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

async function finalizedSessionUploadIds(cullingRepository, projectId, sessionId, decision = "KEEP", { limit = null, uploadIds = null } = {}) {
  const session = await cullingRepository.findSession(projectId, sessionId);
  if (!session) throw httpError(404, "That culling run is not in this project.");
  if (session.status !== FINALIZED) {
    throw httpError(409, "Finalize the run first - a run's photos are sent on only once it is finalized.", { notFinalized: true, status: session.status });
  }
  if (uploadIds) {
    const inRun = new Set((await cullingRepository.listSessionUploadIds(projectId, sessionId, null)) || []);
    return [...new Set(uploadIds)].filter((uploadId) => inRun.has(uploadId));
  }
  return (await cullingRepository.listSessionUploadIds(projectId, sessionId, decision, { limit })) || [];
}

module.exports = { finalizedSessionUploadIds, FINALIZED };
