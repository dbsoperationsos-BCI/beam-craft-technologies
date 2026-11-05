export const projectSortOptions = [
  ["name", "Name"], ["dateLastOpened", "Date Last Opened"], ["dateAdded", "Date Added"],
  ["dateModified", "Date Modified"], ["dateCreated", "Date Created"], ["size", "Size"],
];

// One query shape for both sidebars: the Projects page sends it to Image Selection's list and
// the Album Proofing page to its own — which list answers is decided by the route, not a flag.
export function buildProjectListQuery({ search = "", sort = "dateAdded", order = "desc", archived = false, attention = null } = {}) {
  const query = new URLSearchParams({ sort, order, archived: String(archived) });
  if (search.trim()) query.set("search", search.trim());
  // One of the dashboard's Needs Attention rows; the API narrows the list to the projects on it.
  if (attention) query.set("attention", attention);
  return query.toString();
}

export function toWorkspaceProject(project) {
  return { ...project, name: project.projectName };
}
