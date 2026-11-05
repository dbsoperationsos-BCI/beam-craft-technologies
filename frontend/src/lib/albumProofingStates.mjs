/**
 * The Album Proofing status vocabulary as words: every album state and every correction state the
 * backend's `album-proofs/constants.js` defines, with the label the studio reads for it. Pure so
 * the dashboard's vocabulary and its tests can read it; `ProofingStatusChip` draws these same
 * words, so a chip, a card and a filter can never spell a state differently.
 */
export const ALBUM_STATE_LABELS = {
  DRAFT: "Draft",
  PROCESSING: "Processing",
  PROCESSING_FAILED: "Processing Failed",
  READY_FOR_QC: "Ready for QC",
  QC_REVIEW: "QC Review",
  QC_CHANGES_REQUESTED: "QC Corrections",
  QC_REVISION_IN_PROGRESS: "QC Fixes in Progress",
  QC_APPROVED: "QC Approved",
  READY_FOR_CLIENT: "Ready for Client",
  CLIENT_REVIEW: "Client Review",
  CLIENT_CHANGES_REQUESTED: "Client Corrections",
  REVISION_IN_PROGRESS: "Revision in Progress",
  REVISION_READY_FOR_QC: "Revision Ready for QC",
  CLIENT_APPROVED: "Client Approved",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const CORRECTION_STATE_LABELS = { OPEN: "Open", IN_PROGRESS: "In Progress", RESOLVED: "Resolved", REOPENED: "Reopened" };
