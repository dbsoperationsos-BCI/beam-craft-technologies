const prisma = require("../../../config/db");
const { missingRequired, SIDES } = require("./document");
const { documentSchemaFor, emptyDocumentFor, completionPercentFor } = require("./verticalDocument");

/**
 * What a project's CRD document has actually reached, read from the document itself.
 *
 * The sale carries a hand-set `crdDocumentStatus` ("Not yet received" / "Groom Side received" /
 * "Bride Side received" / "Not Applicable") which somebody has to remember to update. The document
 * record knows the truth: whether a link was issued, whether the client has started, whether they
 * have submitted, and — from the answers themselves — which side is actually complete.
 *
 * This derives that, so Pre Production can show what the CRD Documents page shows rather than a
 * note that may be weeks stale. The sale's own field is still carried alongside, because it is the
 * only one that can say "Not Applicable" — a document is never raised for a project that needs none.
 */

/**
 * Which shape the document was filled in against - the row's own vertical, else its project's -
 * read the same way the CRD Documents page reads it, so both screens score it alike.
 */
function verticalOf(row) {
  return row?.vertical || row?.project?.vertical || "";
}

/** The document as stored, falling back to an empty one so a half-written row still reads. */
function storedDocument(row, vertical) {
  const saved = row?.submission && typeof row.submission === "object" && !Array.isArray(row.submission) ? row.submission : {};
  const parsed = documentSchemaFor(vertical).safeParse(saved);
  return parsed.success ? parsed.data : emptyDocumentFor(vertical);
}

/** One side is "received" once none of its required answers are still missing. */
function sidesComplete(document) {
  const missing = missingRequired(document);
  return Object.fromEntries(SIDES.map((side) => [side, !missing.some((path) => path.startsWith(`${side}.`))]));
}

/**
 * A one-line state for a document row: what the CRD Documents page would say about it.
 *
 * "Not Issued" is the absence of a row rather than a status on one — nobody has sent the client a
 * link yet — so it is produced by the caller when the map has no entry, not here.
 */
function crdSummary(row) {
  const vertical = verticalOf(row);
  const document = storedDocument(row, vertical);
  const state = {
    crdDocumentState: row.submittedAt ? "Submitted" : row.status || "Sent",
    crdCompletion: completionPercentFor(vertical, document),
    crdSubmittedAt: row.submittedAt || null,
  };
  // A Qua Qua document asks about one child, not a groom and a bride, so it has no sides to report.
  if (vertical === "QQ") return { ...state, crdGroomReceived: false, crdBrideReceived: false, crdSidesReceived: null };
  const sides = sidesComplete(document);
  const received = SIDES.filter((side) => sides[side]);
  return {
    ...state,
    crdGroomReceived: sides.groom === true,
    crdBrideReceived: sides.bride === true,
    // The same sentence the sale's hand-set field tries to hold, worked out rather than remembered.
    crdSidesReceived: received.length === SIDES.length ? "Both Sides Received"
      : received.length ? `${received[0] === "groom" ? "Groom" : "Bride"} Side Received`
        : "Neither Side Received",
  };
}

/** Every listed project's CRD state, keyed by project id, in one query for the whole page. */
async function crdSummariesByProject(projectIds) {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.salesProjectCrdDocument.findMany({
    where: { projectId: { in: ids } },
    select: { projectId: true, status: true, vertical: true, submittedAt: true, submission: true, project: { select: { vertical: true } } },
  });
  return new Map(rows.map((row) => [row.projectId, crdSummary(row)]));
}

/** What a project with no document row reads as: the link has not been issued. */
const NO_CRD_DOCUMENT = {
  crdDocumentState: "Not Issued",
  crdCompletion: 0,
  crdSubmittedAt: null,
  crdGroomReceived: false,
  crdBrideReceived: false,
  crdSidesReceived: "Neither Side Received",
};

module.exports = { crdSummariesByProject, crdSummary, NO_CRD_DOCUMENT };
