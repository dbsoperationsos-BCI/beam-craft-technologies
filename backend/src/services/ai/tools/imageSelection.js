const repository = require("../../../modules/image-selection/projects/repository");
const { boundedLimit } = require("./sales");

/**
 * Read-only tools for IMAGE_SELECTION / Project Management.
 *
 * Only two, and only metadata. The module's whole purpose is thousands of photographs sitting in
 * local and NAS storage, and none of that is reachable from here: there is no tool that takes a
 * path, opens a file, lists a directory or copies anything. The assistant can say how a selection is
 * going; it cannot see a single image.
 *
 * The module's own repository is reused, so a project the screens would not show is not shown here
 * either - including soft-deleted ones, which `listProjects` already excludes.
 */

/** A project as the assistant needs it. Never the raw row - it carries storage paths. */
function summariseProject(row) {
  return {
    id: row.id,
    name: row.projectName || null,
    status: row.status || null,
    archived: Boolean(row.archivedAt),
    createdAt: row.createdAt || null,
  };
}

const TOOLS = [
  {
    name: "imageselection.getProjectSummary",
    module: "IMAGE_SELECTION",
    risk: "READ",
    /*
     * The module's standing figures.
     *
     * Marked `summary` so the orchestrator gathers it before the model is asked anything. Without
     * one this was the only scope where nothing was prefetched, and a small model left to work out
     * for itself that it should look something up generally does not.
     */
    summary: true,
    description: "How many image selection projects there are, by status, and how many are archived.",
    schema: { type: "object", properties: {} },
    execute: async () => {
      /*
       * Both lists come from the module's own repository, so a project the screens would not show
       * is not counted here either - `listProjects` already excludes soft-deleted rows.
       */
      const [active, archived] = await Promise.all([
        repository.listProjects({ archived: false, orderBy: { createdAt: "desc" } }),
        repository.listProjects({ archived: true, orderBy: { createdAt: "desc" } }),
      ]);

      const byStatus = {};
      for (const row of active) {
        const status = row.status || "Not set";
        byStatus[status] = (byStatus[status] || 0) + 1;
      }

      return {
        activeProjects: active.length,
        archivedProjects: archived.length,
        byStatus,
        // The most recent few, so "what is going on" has something concrete in it.
        recent: active.slice(0, 5).map(summariseProject),
      };
    },
    // One fact per line, for the reason recorded in `crmContext.js` and again in `project.js`.
    renderSummary: (result) => {
      const statuses = Object.entries(result.byStatus || {});
      return [
        "## Image selection",
        `Active projects: ${result.activeProjects}`,
        `Archived projects: ${result.archivedProjects}`,
        statuses.length ? `\nBy status:\n${statuses.map(([status, count]) => `- ${status}: ${count}`).join("\n")}` : "",
        result.recent?.length ? `\nMost recent: ${result.recent.map((project) => project.name).filter(Boolean).join(", ")}` : "",
      ].filter(Boolean).join("\n");
    },
    renderBrief: (result) => `Image selection: ${result.activeProjects} active, ${result.archivedProjects} archived.`,
  },
  {
    name: "imageselection.searchProjects",
    module: "IMAGE_SELECTION",
    risk: "READ",
    description: "Find image selection projects by name. Returns a bounded list of project summaries.",
    schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of a project name." },
        archived: { type: "boolean", description: "Include archived projects. Defaults to false." },
        limit: { type: "integer", description: "Up to 50; defaults to 20." },
      },
    },
    execute: async (args) => {
      const limit = boundedLimit(args.limit);
      const rows = await repository.listProjects({
        search: String(args.search || "").trim() || undefined,
        archived: Boolean(args.archived),
        orderBy: undefined,
      });
      const items = (Array.isArray(rows) ? rows : []).slice(0, limit);
      return {
        count: items.length,
        limit,
        // The repository has no limit of its own, so the cap is applied here and reported honestly.
        truncated: Array.isArray(rows) && rows.length > limit,
        items: items.map(summariseProject),
      };
    },
  },

  {
    name: "imageselection.getProject",
    module: "IMAGE_SELECTION",
    risk: "READ",
    description: "One image selection project: its name, status and whether it is archived.",
    schema: {
      type: "object",
      properties: { id: { type: "string", description: "The project's id." } },
      required: ["id"],
    },
    execute: async (args) => {
      const id = String(args.id || "").trim();
      if (!id) throw new Error("A project id is required.");
      const row = await repository.findProject(id, {});
      return row ? { found: true, project: summariseProject(row) } : { found: false };
    },
  },
];

module.exports = { TOOLS, summariseProject };
