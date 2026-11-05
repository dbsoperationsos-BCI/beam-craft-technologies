const prisma = require("../../../config/db");
const { fail } = require("../production/access");

/*
 * The project's WhatsApp group, linked on Pre Production → General.
 *
 * Offered from the linker's own paired WhatsApp (`listGroups`), with the group named like the
 * project chosen by default. The jid from the browser is trusted for nothing: it is linked only if
 * the caller's WhatsApp actually answered for that group, and never to a group another live project
 * already holds - one client's messages must not land in another client's chat. Production then
 * sends into it from this linker's WhatsApp.
 */
const nameKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const defaultSessions = () => require("../../sales/whatsapp-chat/sessionManager");

async function liveProject(client, projectId) {
  const project = await client.salesProject.findFirst({
    where: { id: String(projectId || ""), deletedAt: null },
    select: { id: true, eventId: true, whatsappGroupName: true, whatsappGroupJid: true },
  });
  if (!project) throw fail(404, "Project not found.");
  return project;
}

async function projectGroupChoices(projectId, userId, { client = prisma, sessions = defaultSessions } = {}) {
  const project = await liveProject(client, projectId);
  const wanted = nameKey(project.whatsappGroupName);
  const groups = (await sessions().listGroups(userId)).map((group) => ({
    ...group,
    linked: group.jid === project.whatsappGroupJid,
    matchesProject: Boolean(wanted) && nameKey(group.subject) === wanted,
  }));
  const suggested = groups.find((group) => group.linked) || groups.find((group) => group.matchesProject) || null;
  return { groups, suggestedJid: suggested?.jid || null };
}

async function linkProjectGroup(projectId, userId, jid, { client = prisma, sessions = defaultSessions, now = () => new Date() } = {}) {
  const wanted = String(jid || "").trim();
  if (!wanted) throw fail(400, "Choose a WhatsApp group.");
  const project = await liveProject(client, projectId);
  const group = (await sessions().listGroups(userId)).find((entry) => entry.jid === wanted);
  if (!group) throw fail(400, "Your WhatsApp is not in that group. Refresh the list and choose again.", "NOT_IN_GROUP");
  const holder = await client.salesProject.findFirst({ where: { whatsappGroupJid: group.jid, deletedAt: null, id: { not: project.id } }, select: { eventId: true } });
  if (holder) throw fail(409, `That group is already linked to project ${holder.eventId}.`, "GROUP_TAKEN");
  const linkedAt = now();
  await client.salesProject.update({
    where: { id: project.id },
    data: {
      whatsappGroupJid: group.jid,
      whatsappGroupSubject: String(group.subject || "").slice(0, 500) || null,
      whatsappGroupLinkedByUserId: Number(userId) || null,
      whatsappGroupLinkedAt: linkedAt,
    },
  });
  return { projectId: project.id, jid: group.jid, subject: group.subject || null, linkedAt };
}

/**
 * Links the project's group without being asked, when that is not a guess: the caller's WhatsApp
 * holds exactly one group named like the project's WhatsApp group name. Anything else - no group by
 * that name, two of them, WhatsApp not connected, the group already linked elsewhere - links nothing
 * and says why, leaving the choice to the person. The connection is checked first: one already up is
 * used as it is, and a paired one that dropped is brought back (`resumeSession`) - never a new
 * pairing, which only the person can start. Only reads the group list; sends nothing.
 */
async function autoLinkProjectGroup(projectId, userId, deps = {}) {
  const { client = prisma, sessions = defaultSessions } = deps;
  const project = await liveProject(client, projectId);
  if (project.whatsappGroupJid) return { linked: true, alreadyLinked: true };
  const wanted = nameKey(project.whatsappGroupName);
  if (!wanted) return { linked: false, reason: "This project has no WhatsApp group name to match." };
  let groups;
  try {
    const state = await sessions().resumeSession(userId);
    if (state?.paired === false) return { linked: false, reason: "Link your WhatsApp first (WhatsApp → scan the QR) to link the group automatically." };
    groups = await sessions().listGroups(userId);
  } catch {
    return { linked: false, reason: "Connect your WhatsApp to link the group automatically." };
  }
  const matches = groups.filter((group) => nameKey(group.subject) === wanted);
  if (matches.length === 0) return { linked: false, reason: `None of your WhatsApp groups is named "${project.whatsappGroupName}".` };
  if (matches.length > 1) return { linked: false, reason: `More than one of your WhatsApp groups is named "${project.whatsappGroupName}". Choose the right one.` };
  try {
    const link = await linkProjectGroup(projectId, userId, matches[0].jid, deps);
    return { linked: true, ...link };
  } catch (error) {
    if (error?.status && error.status < 500) return { linked: false, reason: error.message };
    throw error;
  }
}

module.exports = { projectGroupChoices, linkProjectGroup, autoLinkProjectGroup };
