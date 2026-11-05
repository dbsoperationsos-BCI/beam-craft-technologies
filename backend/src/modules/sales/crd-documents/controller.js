const {
  ensureLink,
  ensureResponseLink,
  createDocument,
  listDocuments,
  listAvailableEnquiryIds,
  readByToken,
  readResponse,
  readResponseByShareToken,
  saveDraftByToken,
  submitByToken,
} = require("./service");
const { projectAccessWhere } = require("../../../services/projectScope");

/** What this signed-in person may read of the register, resolved once per request (DATA-SCOPE.md D16). */
const accessFor = (req) => projectAccessWhere({ userId: Number(req.user.id) });

function sendError(res, error, fallback) {
  if (error.status) {
    // A submit refused for missing answers names them, so the page can mark the fields rather than
    // leaving the client to hunt for what is outstanding.
    return res.status(error.status).json({ message: error.message, ...(error.missing ? { missing: error.missing } : {}), ...(error.errors ? { errors: error.errors } : {}) });
  }
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

// Studio side. Issues the link for a project, or hands back the one already issued.
async function list(req, res) {
  try {
    return res.json({ data: await listDocuments({ access: await accessFor(req) }) });
  } catch (error) {
    return sendError(res, error, "Unable to load CRD documents.");
  }
}

// The Enquiry IDs Create CRD Document may be raised against — the projects marked "Not Applicable",
// which are the ones this screen otherwise never shows.
async function availableEnquiryIds(req, res) {
  try {
    return res.json({ data: await listAvailableEnquiryIds({ access: await accessFor(req) }) });
  } catch (error) {
    return sendError(res, error, "Unable to load the available Enquiry IDs.");
  }
}

// Issues a document, and its link, for a client whose project has not been started yet.
async function create(req, res) {
  try {
    return res.json({ data: await createDocument(req.body, req.user?.id, { access: await accessFor(req) }) });
  } catch (error) {
    return sendError(res, error, "Unable to create the CRD document.");
  }
}

// What the client sent back, for the row's own View.
async function response(req, res) {
  try {
    return res.json({ data: await readResponse(req.params.documentId, { access: await accessFor(req) }) });
  } catch (error) {
    return sendError(res, error, "Unable to load the CRD document response.");
  }
}

// The read-only link to that response, issued once and handed back unchanged afterwards.
async function createResponseLink(req, res) {
  try {
    return res.json({ data: await ensureResponseLink(req.params.documentId, { access: await accessFor(req) }) });
  } catch (error) {
    return sendError(res, error, "Unable to create the response link.");
  }
}

// Anyone holding the share link, with no account — the response and nothing else.
async function publicResponse(req, res) {
  try {
    return res.json({ data: await readResponseByShareToken(req.params.token) });
  } catch (error) {
    return sendError(res, error, "Unable to load this response.");
  }
}

async function createLink(req, res) {
  try {
    return res.json({ data: await ensureLink(req.params.projectId, req.user?.id, { access: await accessFor(req) }) });
  } catch (error) {
    return sendError(res, error, "Unable to create the CRD document link.");
  }
}

// Client side, unauthenticated: the token is the credential.
async function publicDocument(req, res) {
  try {
    return res.json({ data: await readByToken(req.params.token) });
  } catch (error) {
    return sendError(res, error, "Unable to load this CRD document.");
  }
}

async function savePublicDocument(req, res) {
  try {
    return res.json({ data: await saveDraftByToken(req.params.token, req.body) });
  } catch (error) {
    return sendError(res, error, "Unable to save this CRD document.");
  }
}

async function submitPublicDocument(req, res) {
  try {
    return res.json({ data: await submitByToken(req.params.token, req.body) });
  } catch (error) {
    return sendError(res, error, "Unable to submit this CRD document.");
  }
}

module.exports = { list, availableEnquiryIds, create, createLink, response, createResponseLink, publicResponse, publicDocument, savePublicDocument, submitPublicDocument };
