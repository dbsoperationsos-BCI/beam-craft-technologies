const prisma = require("../../../config/db");

/*
 * Expand → a project's Enabled switch: one state for everyone, on the project itself
 * (`image_selection_project.disabled_at`, and who set it). Every project is enabled until somebody
 * with Project Management Read / Write disables it; while disabled it takes no uploads, is not
 * published or sent, and its link is paused (`../projectEnabled.js`, `publication/service.authorize`).
 * Nothing it holds - photos, folders, selections, submissions, URL, PIN, expiry - is touched, here
 * or by being disabled.
 */

const projectScope = { deletedAt: null, albumProofing: false };

const fail = (status, message) => Object.assign(new Error(message), { status });

function createExpand(client = prisma) {
  /**
   * Enables or disables one project. The project must be one the Projects page lists; the id in the
   * URL is never taken on trust. Written without `updated_at`: switching a project off is not work
   * on it, so its place in the sidebar and its Last Activity stay where they were.
   */
  async function setEnabled(userId, projectId, enabled) {
    const project = await client.imageSelectionProject.findFirst({ where: { id: String(projectId || ""), ...projectScope }, select: { id: true, disabledAt: true } });
    if (!project) throw fail(404, "Image Selection project not found.");
    if (enabled && project.disabledAt) {
      await client.$executeRaw`UPDATE image_selection_project SET disabled_at = NULL, disabled_by_user_id = NULL WHERE id = ${project.id}`;
    } else if (!enabled && !project.disabledAt) {
      await client.$executeRaw`UPDATE image_selection_project SET disabled_at = ${new Date()}, disabled_by_user_id = ${userId} WHERE id = ${project.id}`;
    }
    return { projectId: project.id, expandEnabled: enabled };
  }

  return { setEnabled };
}

module.exports = { ...createExpand(), createExpand };
