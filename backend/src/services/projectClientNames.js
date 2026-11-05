const prisma = require("../config/db");

/**
 * The client's name for a set of sales projects.
 *
 * It lives on the reserved WhatsApp group name rather than on the project, and
 * `whatsappGroupNameId` is a plain column with no relation, so it cannot be included and is
 * resolved in one extra query for a whole page of rows instead of one per row.
 *
 * Client Storage and Accounts both show a project by its client, which is why this sits here
 * rather than in either module.
 */
async function projectClientNames(projects) {
  const ids = [...new Set((projects || []).map((project) => project?.whatsappGroupNameId).filter(Boolean))];
  if (!ids.length) return new Map();
  const groups = await prisma.salesWhatsappGroupName.findMany({ where: { id: { in: ids } }, select: { id: true, clientName: true } });
  return new Map(groups.map((group) => [group.id, group.clientName]));
}

/** The one name to show for a project: the reserved client name, else the group name it was saved with. */
const clientNameOf = (project, names) => (project && (names.get(project.whatsappGroupNameId) || project.whatsappGroupName)) || null;

module.exports = { projectClientNames, clientNameOf };
