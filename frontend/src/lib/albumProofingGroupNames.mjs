/**
 * The saved WhatsApp group names the Album Proofing "New Project" form may offer.
 *
 * Pure helpers so the rule can be tested without rendering the form. The same statuses Project
 * Management's Projects page counts as its "In Progress" tab: only a project already being worked
 * on has album pages for the client to proof.
 */
export const IN_PROGRESS_PROJECT_STATUSES = new Set([
  "Work in Progress - Pre & Production",
  "Work in Progress - Post Production",
]);

/**
 * Sales Manager projects that can still become an Album Proofing project: in progress, carrying a
 * WhatsApp group name, not already used by an Album Proofing project, and listed once per name.
 */
export function availableGroupNames(salesProjects, usedSalesProjectIds = []) {
  const usedIds = new Set(usedSalesProjectIds);
  const seenNames = new Set();
  return (salesProjects || []).filter((project) => {
    if (!project || !IN_PROGRESS_PROJECT_STATUSES.has(project.projectStatus)) return false;
    if (usedIds.has(project.id)) return false;
    const name = project.whatsappGroupName?.trim();
    if (!name || seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  });
}

/** Case-insensitive substring match on the group name; an empty query keeps everything. */
export function filterGroupNames(groupNames, query) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return groupNames;
  return groupNames.filter((project) => project.whatsappGroupName.toLocaleLowerCase().includes(needle));
}
