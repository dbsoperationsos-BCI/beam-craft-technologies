const requests = require("./service");

/*
 * Client requests over HTTP: the client's (mounted on the client portal, their own booking only) and
 * the team's (Client Management -> Client Requests).
 */

const fail = (res, error, fallback) => {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
};
const invalid = (res, parsed, fallback) => res.status(400).json({ message: parsed.error.issues?.[0]?.message || fallback });

// ── The client's ── `ownProject(req)` is the client portal's: their project, or the event they name.
function clientRoutes(ownProject) {
  return {
    async list(req, res) {
      try {
        res.set("Cache-Control", "no-store");
        const project = await ownProject(req);
        if (!project) return res.status(404).json({ message: "Your booking could not be found." });
        const found = await requests.clientRequests(project.id);
        // Opened: the studio's answers here have been seen, and leave Action Needed.
        await requests.markAnswersSeen(project.id);
        return res.json({ data: found });
      } catch (error) { return fail(res, error, "Unable to load your requests."); }
    },
    async create(req, res) {
      const parsed = requests.requestSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed, "Please check your request.");
      try {
        const project = await ownProject(req);
        if (!project) return res.status(404).json({ message: "Your booking could not be found." });
        const made = await requests.createRequests({ projectId: project.id, userId: Number(req.user.id), input: parsed.data });
        return res.status(201).json({ data: made.request, requests: made.requests, message: "Sent - the studio will get back to you." });
      } catch (error) { return fail(res, error, "Your request could not be sent. Please try again."); }
    },
    async remove(req, res) {
      try {
        const project = await ownProject(req);
        if (!project || !(await requests.removeRequest(req.params.id, project.id))) return res.status(404).json({ message: "Request not found." });
        return res.json({ message: "Request deleted." });
      } catch (error) { return fail(res, error, "Your request could not be deleted. Please try again."); }
    },
  };
}

// ── The team's ──
async function teamList(_req, res) {
  try {
    return res.json({ data: await requests.teamRequests() });
  } catch (error) { return fail(res, error, "Unable to load client requests."); }
}

async function teamAnswer(req, res) {
  const parsed = requests.answerSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed, "Please check your answer.");
  try {
    const saved = await requests.answerRequest(req.params.id, Number(req.user.id) || null, parsed.data);
    if (!saved) return res.status(404).json({ message: "Request not found." });
    return res.json({ data: saved, message: "Sent to the client." });
  } catch (error) { return fail(res, error, "Unable to answer the request."); }
}

async function teamApprove(req, res) {
  const parsed = requests.approveSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed, "Choose the requests to approve.");
  try {
    const done = await requests.approveRequests(Number(req.user.id) || null, parsed.data);
    return res.json({ data: done, message: `${done.approved} request${done.approved === 1 ? "" : "s"} approved and added to the project.` });
  } catch (error) { return fail(res, error, "Unable to approve the requests."); }
}

async function teamRemove(req, res) {
  try {
    const deletedIds = await requests.teamRemoveRequests(Array.isArray(req.body?.ids) ? req.body.ids : []);
    return res.json({ data: { deletedIds }, message: `${deletedIds.length} request${deletedIds.length === 1 ? "" : "s"} deleted.` });
  } catch (error) { return fail(res, error, "Unable to delete the requests."); }
}

module.exports = { clientRoutes, teamList, teamAnswer, teamApprove, teamRemove };
