const service = require("./recycling-bin.service");

/*
 * Resource Management → Recycling Bin. The router's `requireModule("ASSET", "Recycling Bin")` decides
 * who may look (READ) and who may restore or delete permanently (READ_WRITE); the service narrows
 * every project to the caller's branch reach on that same permission.
 */

const ID = /^[A-Za-z0-9_-]{1,191}$/;

function fail(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

async function listProjects(req, res) {
  try {
    return res.json({ data: await service.listDeletedProjects(req.user.id) });
  } catch (error) {
    return fail(res, error, "Unable to load the Project Vault.");
  }
}

async function getProject(req, res) {
  if (!ID.test(String(req.params.id || ""))) return res.status(404).json({ message: "This project is not in the Project Vault." });
  try {
    return res.json({ data: await service.getDeletedProject(req.user.id, req.params.id) });
  } catch (error) {
    return fail(res, error, "Unable to load the project.");
  }
}

async function restoreProject(req, res) {
  if (!ID.test(String(req.params.id || ""))) return res.status(404).json({ message: "This project is not in the Project Vault." });
  try {
    const restored = await service.restoreDeletedProject(req.user.id, req.params.id);
    return res.json({ message: `Project ${restored.eventId} restored.`, data: restored });
  } catch (error) {
    return fail(res, error, "Unable to restore the project.");
  }
}

async function deleteProjectPermanently(req, res) {
  if (!ID.test(String(req.params.id || ""))) return res.status(404).json({ message: "This project is not in the Project Vault." });
  try {
    // The Event ID the person confirmed in the dialog: the service erases nothing unless it matches.
    const confirmEventId = typeof req.body?.confirmEventId === "string" ? req.body.confirmEventId.slice(0, 64) : "";
    const removed = await service.purgeDeletedProject(req.user.id, req.params.id, { confirmEventId });
    return res.json({ message: `Project ${removed.eventId} deleted permanently.`, data: removed });
  } catch (error) {
    return fail(res, error, "Unable to delete the project permanently.");
  }
}

module.exports = { listProjects, getProject, restoreProject, deleteProjectPermanently };
