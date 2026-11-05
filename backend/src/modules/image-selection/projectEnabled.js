const prisma = require("../../config/db");

/*
 * A project disabled from Expand (`image_selection_project.disabled_at`) takes nothing new that
 * would reach its client: no photo upload or original registration, no publish, re-publish or new
 * PIN, no link prepared or sent, no photos sent on to Photo Selection. Its published link is paused
 * in `publication/service.authorize`. Everything it already holds stays as it is.
 *
 * Checked on the server, against the project in the URL, so a direct call is refused the same as a
 * click: the screens hide these controls too, but they are not what stops them. Unpublishing, reading
 * and the studio's own internal work (folders, culling decisions, edits) are not blocked.
 */
const DISABLED_MESSAGE = "This project is disabled. Enable it from Expand to upload photos or send the client link.";

function disabledError() {
  const error = new Error(DISABLED_MESSAGE);
  error.status = 409;
  error.code = "PROJECT_DISABLED";
  return error;
}

/** Throws the disabled-project refusal when `projectId` names a disabled project; otherwise nothing. */
async function assertProjectEnabled(projectId, client = prisma) {
  if (!projectId) return;
  const project = await client.imageSelectionProject.findFirst({ where: { id: String(projectId) }, select: { disabledAt: true } });
  if (project?.disabledAt) throw disabledError();
}

/**
 * Route guard: mounted after the permission guard on each route that would put something new in
 * front of the client. A route with no `:projectId` (a path that names none) is left alone; a
 * project that does not exist is the route's own 404 to give.
 */
function requireProjectEnabled(req, res, next) {
  assertProjectEnabled(req.params.projectId)
    .then(() => next())
    .catch((error) => (error.code === "PROJECT_DISABLED"
      ? res.status(409).json({ message: error.message, code: error.code })
      : next(error)));
}

module.exports = { DISABLED_MESSAGE, assertProjectEnabled, requireProjectEnabled, disabledError };
