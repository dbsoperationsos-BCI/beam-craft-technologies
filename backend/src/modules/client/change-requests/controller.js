const requests = require("./service");

/*
 * Raised requests over HTTP (Client Management -> Client Requests -> Raised Requests). Who may do what
 * is the route's (`routes.js`); every handler passes the permission it was guarded with on to the
 * service, which narrows the projects it reaches to that permission's scope.
 */

const fail = (res, error, fallback) => {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
};
const invalid = (res, parsed, fallback) => res.status(400).json({ message: parsed.error.issues?.[0]?.message || fallback });
const who = (req) => ({ userId: Number(req.user.id), permission: req.permission });

async function list(req, res) {
  try {
    return res.json({ data: await requests.listRequests(who(req)) });
  } catch (error) { return fail(res, error, "Unable to load the raised requests."); }
}

async function show(req, res) {
  try {
    const found = await requests.getRequest(req.params.id, who(req));
    if (!found) return res.status(404).json({ message: "Request not found." });
    return res.json({ data: found });
  } catch (error) { return fail(res, error, "Unable to load the request."); }
}

async function projects(req, res) {
  try {
    return res.json({ data: await requests.searchProjects({ ...who(req), search: String(req.query.search || "").slice(0, 120) }) });
  } catch (error) { return fail(res, error, "Unable to search the projects."); }
}

async function shoots(req, res) {
  try {
    const found = await requests.projectShoots(req.params.projectId, who(req));
    if (!found) return res.status(404).json({ message: "Project not found." });
    return res.json({ data: found });
  } catch (error) { return fail(res, error, "Unable to load the project's shoots."); }
}

async function raise(req, res) {
  const parsed = requests.raiseSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed, "Please check the request.");
  try {
    const made = await requests.raiseRequest({ ...who(req), input: parsed.data });
    return res.status(201).json({ data: made, message: `Request ${made.requestCode} raised. It is waiting for a decision.` });
  } catch (error) { return fail(res, error, "The request could not be raised. Please try again."); }
}

async function review(req, res) {
  const parsed = requests.reviewSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed, "Please check the decisions.");
  try {
    await requests.saveReview(req.params.id, { ...who(req), input: parsed.data });
    return res.json({ data: await requests.getRequest(req.params.id, who(req)), message: "Review saved." });
  } catch (error) { return fail(res, error, "Unable to save the review."); }
}

async function decide(req, res) {
  const parsed = requests.reviewSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed, "Please check the decisions.");
  try {
    const done = await requests.decideRequest(req.params.id, { ...who(req), input: parsed.data });
    const label = { ACCEPTED: "accepted", PARTIALLY_ACCEPTED: "partly accepted", DECLINED: "declined" }[done.status];
    return res.json({ data: await requests.getRequest(req.params.id, who(req)), outcome: done, message: `Request ${label}.${done.extraQuotation ? ` Extra quotation ${done.extraQuotation} recorded.` : ""}${done.task ? ` Task ${done.task} created.` : ""}` });
  } catch (error) { return fail(res, error, "Unable to submit the decision."); }
}

async function ask(req, res) {
  const parsed = requests.messageSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed, "Write the message.");
  try {
    await requests.askForInformation(req.params.id, { ...who(req), message: parsed.data.message });
    return res.json({ data: await requests.getRequest(req.params.id, who(req)), message: "Sent to the person who raised it." });
  } catch (error) { return fail(res, error, "Unable to send the question."); }
}

async function reply(req, res) {
  const parsed = requests.messageSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed, "Write the reply.");
  try {
    await requests.giveInformation(req.params.id, { ...who(req), message: parsed.data.message });
    return res.json({ data: await requests.getRequest(req.params.id, who(req)), message: "Reply sent." });
  } catch (error) { return fail(res, error, "Unable to send the reply."); }
}

module.exports = { list, show, projects, shoots, raise, review, decide, ask, reply };
