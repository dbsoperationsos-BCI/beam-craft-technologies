/**
 * The saved WhatsApp group names the Album Proofing "New Project" form may offer.
 *
 * Pure helpers so the rule can be tested without rendering the form. The same statuses Project
 * Management's Projects page counts as its "In Progress" tab: only a project already being worked
 * on has album pages for the client to proof.
 */
export { IN_PROGRESS_STATUSES as IN_PROGRESS_PROJECT_STATUSES } from "./projectStatuses.mjs";
import { isInProgressStatus } from "./projectStatuses.mjs";
import { matchesWordChunks } from "./wordChunks.mjs";

/**
 * Sales Manager projects that can still become an Album Proofing project: in progress, carrying a
 * WhatsApp group name, not already used by an Album Proofing project, and listed once per name.
 */
export function availableGroupNames(salesProjects, usedSalesProjectIds = []) {
  const usedIds = new Set(usedSalesProjectIds);
  const seenNames = new Set();
  return (salesProjects || []).filter((project) => {
    if (!project || !isInProgressStatus(project.projectStatus)) return false;
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
  return groupNames.filter((project) => matchesWordChunks(project.whatsappGroupName, needle));
}
