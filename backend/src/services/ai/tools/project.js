const readService = require("../../../modules/sales/projects/read.service");
const { projectAccessWhere } = require("../../../services/projectScope");
const { boundedLimit } = require("./sales");

// The same rows the register shows this person: the register's own rule and the grant's data scope,
// resolved for the session's login. The session's reachable branches are no longer read on their
// own - they are one of the answers inside this, not the answer.
const accessFor = (session) => projectAccessWhere({ userId: session?.userId });

/**
 * Read-only tools for PROJECT / Project Management.
 *
 * The project pipeline as the screens show it: how many projects there are, where they have got to,
 * and who is running them. The module's own read service is reused, so a project the screens would
 * not show - a soft-deleted one - is not shown here either.
 *
 * What these deliberately cannot see: a project's converted value and the client's phone number.
 * The read service names the fields it will return rather than excluding the ones it will not, so
 * a column added to the table later stays private until somebody decides otherwise.
 */

const TOOLS = [
  {
    name: "project.getProjectSummary",
    module: "PROJECT",
    risk: "READ",
    // Gathered before the model is asked anything, so it answers from figures rather than guesses.
    summary: true,
    description:
      "How many projects there are, by status, vertical and branch, and how many have no project "
      + "manager assigned. Use this for any question about how many or how things are going.",
    schema: { type: "object", properties: {} },
    execute: async (_args, session) => readService.projectSummary({ access: await accessFor(session) }),
    /*
     * One fact per line, and never two numbers in a sentence.
     *
     * The same lesson `crmContext.js` records: given "3 projects, by status Yet to Start 3, 3 have
     * no manager" this model picks the wrong 3 out of it - it answered "2" to "how many have no
     * manager" from a line that said 3 twice. A label and a number on its own line is not something
     * to misread.
     */
    renderSummary: (result) => [
      "## Projects",
      `Total projects: ${result.total}`,
      `Without a project manager: ${result.unassigned}`,
      result.byStatus?.length ? `\nBy status:\n${result.byStatus.map((row) => `- ${row.status}: ${row.count}`).join("\n")}` : "",
      result.byVertical?.length ? `\nBy vertical:\n${result.byVertical.map((row) => `- ${row.vertical}: ${row.count}`).join("\n")}` : "",
      result.byBranch?.length ? `\nBy branch:\n${result.byBranch.map((row) => `- ${row.branch}: ${row.count}`).join("\n")}` : "",
      /*
       * Per project manager, each status on its own line under them - so "how many does Arun have"
       * is read, not worked out. Without it the model took the status total (2) for Arun's (1).
       */
      result.byManager?.length
        ? `\nBy project manager:\n${result.byManager.map((row) => [`- ${row.manager}: ${row.count}`, ...row.byStatus.map((entry) => `  - ${entry.status}: ${entry.count}`)].join("\n")).join("\n")}`
        : "",
    ].filter(Boolean).join("\n"),
    renderBrief: (result) => `Projects: ${result.total} in the pipeline, ${result.unassigned} without a manager.`,
  },
  {
    name: "project.searchProjects",
    module: "PROJECT",
    risk: "READ",
    description:
      "Find projects by event id, enquiry id, WhatsApp group name or project manager, optionally "
      + "narrowed by status or vertical. Returns a bounded list.",
    schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of an event id, enquiry id, group name or manager's name." },
        status: { type: "string", description: "Project status, for example Yet to Start." },
        vertical: { type: "string", description: "The vertical, for example WED." },
        limit: { type: "integer", description: "Up to 50; defaults to 20." },
      },
    },
    execute: async (args, session) => ({
      projects: await readService.searchProjects({
        search: args.search,
        status: args.status,
        vertical: args.vertical,
        limit: boundedLimit(args.limit),
        access: await accessFor(session),
      }),
    }),
  },
];

module.exports = { TOOLS };
