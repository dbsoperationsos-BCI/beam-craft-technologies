/** The Album Proofing vocabulary, defined once and shared by state machine, services and tests. */

const ALBUM_STATES = [
  "DRAFT", "PROCESSING", "PROCESSING_FAILED", "READY_FOR_QC",
  "QC_REVIEW", "QC_CHANGES_REQUESTED", "QC_REVISION_IN_PROGRESS", "QC_APPROVED",
  "READY_FOR_CLIENT", "CLIENT_REVIEW", "CLIENT_CHANGES_REQUESTED",
  "REVISION_IN_PROGRESS", "REVISION_READY_FOR_QC",
  "CLIENT_APPROVED", "COMPLETED", "ARCHIVED",
];

/**
 * Every transition the album may make, and by which flow. The services move status ONLY through
 * state.assertTransition against this map — a request naming an impossible jump (DRAFT →
 * CLIENT_APPROVED) is refused whatever the frontend sent.
 */
const ALBUM_TRANSITIONS = {
  DRAFT: ["PROCESSING", "READY_FOR_QC", "ARCHIVED"],
  PROCESSING: ["PROCESSING_FAILED", "READY_FOR_QC", "PROCESSING", "DRAFT"],
  PROCESSING_FAILED: ["PROCESSING", "DRAFT"],
  READY_FOR_QC: ["QC_REVIEW", "PROCESSING", "DRAFT", "ARCHIVED"],
  QC_REVIEW: ["QC_CHANGES_REQUESTED", "QC_APPROVED"],
  QC_CHANGES_REQUESTED: ["QC_REVISION_IN_PROGRESS"],
  // REVISION_READY_FOR_QC is where a fix round waits once the corrected spreads have been
  // uploaded and frozen as the next version, and before anyone resubmits it. Both rounds pass
  // through it — the QC one from here, the client one from REVISION_IN_PROGRESS — so "a version
  // exists and is waiting to be submitted" is one state rather than two.
  QC_REVISION_IN_PROGRESS: ["QC_REVIEW", "PROCESSING", "REVISION_READY_FOR_QC"],
  QC_APPROVED: ["READY_FOR_CLIENT", "CLIENT_REVIEW"],
  READY_FOR_CLIENT: ["CLIENT_REVIEW"],
  // Back to READY_FOR_CLIENT when the studio revokes the link: without it a revoked or expired
  // publication left the album in review with no client able to review it and no way to send it
  // again - publish refuses anything but an approved album, and nothing else moves this state.
  CLIENT_REVIEW: ["CLIENT_CHANGES_REQUESTED", "CLIENT_APPROVED", "READY_FOR_CLIENT"],
  CLIENT_CHANGES_REQUESTED: ["REVISION_IN_PROGRESS"],
  REVISION_IN_PROGRESS: ["REVISION_READY_FOR_QC", "PROCESSING"],
  REVISION_READY_FOR_QC: ["QC_REVIEW"],
  // The reopen path: an approved or completed album may go back into revision — audited, with a
  // written reason — never silently edited in place.
  CLIENT_APPROVED: ["COMPLETED", "REVISION_IN_PROGRESS"],
  COMPLETED: ["ARCHIVED", "REVISION_IN_PROGRESS"],
  ARCHIVED: ["DRAFT"],
};

const CORRECTION_SOURCES = ["QC", "CLIENT"];
const CORRECTION_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "REOPENED"];
const VIEWER_MODES = ["SPREAD", "PAGE"];
const CLIENT_SUBMISSION_TYPES = ["CORRECTIONS", "APPROVAL"];

const ACTIVITY_EVENTS = [
  "ALBUM_CREATED", "ALBUM_EDITED", "ALBUM_ARCHIVED", "ALBUM_RESTORED", "ALBUM_DELETED",
  "FOLDER_CREATED", "FOLDER_RENAMED", "FOLDER_DELETED",
  "PAGES_IMPORTED", "PROCESSING_STARTED", "PROCESSING_COMPLETED", "PROCESSING_FAILED", "PROCESSING_RETRIED",
  "VERSION_CREATED", "VERSION_FROZEN",
  "SENT_TO_QC", "QC_CORRECTION_ADDED", "QC_CORRECTION_EDITED", "QC_CORRECTION_REMOVED", "QC_CHANGES_REQUESTED", "QC_APPROVED",
  "CORRECTION_STARTED", "CORRECTION_RESOLVED", "CORRECTION_REOPENED",
  "RESUBMITTED_TO_QC",
  "PUBLISHED_TO_CLIENT", "CLIENT_OPENED", "CLIENT_PIN_VERIFIED", "CLIENT_PIN_RESET", "CLIENT_EXPIRY_CHANGED",
  "CLIENT_CORRECTION_ADDED", "CLIENT_CORRECTIONS_SUBMITTED", "CLIENT_APPROVED",
  "REVISION_CREATED", "REVISION_GRANTED",
  "ALBUM_COMPLETED", "ALBUM_REOPENED", "ORIGINALS_DOWNLOADED", "PUBLICATION_REVOKED",
];

module.exports = {
  ALBUM_STATES, ALBUM_TRANSITIONS, CORRECTION_SOURCES, CORRECTION_STATUSES,
  VIEWER_MODES, CLIENT_SUBMISSION_TYPES, ACTIVITY_EVENTS,
};
