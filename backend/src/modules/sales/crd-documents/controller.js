const { z } = require("zod");
const {
  ensureLink,
  findLiveProject,
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
const { MAX_MESSAGE_LENGTH } = require("../whatsapp-chat/security");
const { resolveProjectGroup, sendToProjectGroup } = require("./groupSend");
const dataScope = require("../../../services/dataScope.service");
const clientPush = require("../../../services/clientPush");

/** What this signed-in person may read of the register, resolved once per request (DATA-SCOPE.md D16). */
const accessFor = (req) => projectAccessWhere({ userId: Number(req.user.id) });

/**
 * Who "mine" is, for the screen's **My Documents** switch - the same shape the CRM board's toggle uses.
 *
 * `seesUnassigned` is what decides whether a document with nobody staffed on it surfaces while the switch
 * is on: it does for a reader who sees everything, because they are the ones who staff projects, and not
 * for a coordinator reading their own work. See `mineWhere` in the service.
 */
const mineFor = async (req, wanted) => {
  if (!wanted) return null;
  const [self, seesUnassigned] = await Promise.all([
    dataScope.selfIds(Number(req.user.id)),
    dataScope.seesEverything(Number(req.user.id), { module: req.permission.module, feature: req.permission.feature }),
  ]);
  return { ...self, seesUnassigned };
};

/**
 * Whether this reader has anybody under them, which is the only case the switch means anything in.
 *
 * For everybody else the two states are the same list - they are the coordinator on their own documents
 * and on nobody else's - and a switch that changes nothing invites a reader to flip it, see no difference
 * and conclude the screen is broken. So the client is told and draws it only for the people it is for.
 *
 * The whole subtree rather than direct reports, matching what the scope actually widens by: a manager two
 * levels up still sees a coordinator's documents, so they still have something to narrow. Answered from
 * the org chart rather than from the caller's claim, and used only to decide whether to *offer* the
 * narrowing - it grants nothing, so a wrong answer can hide a switch and can never widen a list.
 */
async function readerManagesAnyone(req) {
  // Somebody the scope does not confine sees every document in the studio, so "only mine" is more use to
  // them than to anybody else - even though they have no team under them in the org chart sense.
  if (await dataScope.seesEverything(Number(req.user.id), { module: req.permission.module, feature: req.permission.feature })) return true;
  const { employeeId } = await dataScope.selfIds(Number(req.user.id));
  if (!employeeId) return false;
  return (await dataScope.subtreeEmployeeIds(employeeId)).length > 0;
}

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
    // The word rather than a flag's presence, which is how the CRM board sends it.
    const wantsMine = String(req.query.mine || "") === "true";
    const [access, mine, managesAnyone] = await Promise.all([accessFor(req), mineFor(req, wantsMine), readerManagesAnyone(req)]);
    return res.json({ data: await listDocuments({ access, mine }), managesAnyone });
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
    const document = await ensureLink(req.params.projectId, req.user?.id, { access: await accessFor(req) });
    // Send Link: the client's app is asked to fill it in (not once it is submitted).
    if (document?.status !== "Submitted") clientPush.notifyProjectRecorded(req.params.projectId, { title: "Please fill in your CRD document", body: "Tell us about your event - open Action Needed in the app", data: { type: "crd" } });
    return res.json({ data: document });
  } catch (error) {
    return sendError(res, error, "Unable to create the CRD document link.");
  }
}

const groupMessageSchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });

/** CRD Link Ready, before anything is sent: which WhatsApp group Send WhatsApp would use. */
async function linkGroup(req, res) {
  try {
    const project = await findLiveProject(req.params.projectId, await accessFor(req));
    return res.json({ data: await resolveProjectGroup(project, req.user.id) });
  } catch (error) {
    return sendError(res, error, "Unable to find the project's WhatsApp group.");
  }
}

/**
 * CRD Link Ready → Send WhatsApp: the message as the dialog's box holds it, into the project's own
 * WhatsApp group from the sender's WhatsApp (`groupSend.js`), for a project this caller reaches.
 */
async function sendLinkToGroup(req, res) {
  const parsed = groupMessageSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Write the message to send.", errors: parsed.error.flatten() });
  try {
    const project = await findLiveProject(req.params.projectId, await accessFor(req));
    const result = await sendToProjectGroup(project, req.user.id, parsed.data.message);
    return res.json({ data: result, message: result.groupSubject ? `Sent to the WhatsApp group "${result.groupSubject}".` : "Sent to the project's WhatsApp group." });
  } catch (error) {
    return sendError(res, error, "Unable to send the CRD link to the WhatsApp group.");
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

module.exports = { list, availableEnquiryIds, create, createLink, linkGroup, sendLinkToGroup, response, createResponseLink, publicResponse, publicDocument, savePublicDocument, submitPublicDocument };
