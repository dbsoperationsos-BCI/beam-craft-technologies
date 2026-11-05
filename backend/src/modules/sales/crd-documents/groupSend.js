const prisma = require("../../../config/db");
const { nameKey } = require("../../image-selection/whatsapp/group.service");

/*
 * CRD Link Ready → Send WhatsApp: the link's message, into the project's own WhatsApp group.
 *
 * The studio runs each project in a WhatsApp group with the client, named as the project is. The
 * project keeps which group that is (`SalesProject.whatsappGroupJid`, linked on Pre Production →
 * General, where Production's messages go too); failing that, Image Selection's link for the sale.
 * Where neither is linked, the group is found the way both link it: the one group in the sender's
 * own WhatsApp named like the project and held by no other project. That match is **not written
 * back** - linking is Pre Production's and Image Selection's, under their own permissions, and
 * somebody with CRD Documents alone must not re-point where a project's messages go.
 *
 * Nothing is sent to a group the sender has not been shown: CRD Link Ready asks `resolveProjectGroup`
 * first and names the group on its button. And only from the sender's own paired WhatsApp, as every
 * WhatsApp send in the app is - a jid is trusted only if their WhatsApp answered for it.
 */

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

/**
 * The group this sale is linked to: its own (Pre Production → General), else Image Selection's for
 * it, as `{ jid, subject }` - or null when neither is linked.
 */
async function findLinkedGroup(salesProjectId) {
  const project = await prisma.salesProject.findUnique({ where: { id: salesProjectId }, select: { whatsappGroupJid: true, whatsappGroupSubject: true } });
  if (project?.whatsappGroupJid) return { jid: project.whatsappGroupJid, subject: project.whatsappGroupSubject };
  const selection = await prisma.imageSelectionProject.findFirst({
    where: { salesProjectId, albumProofing: false, deletedAt: null, whatsappGroupJid: { not: null } },
    select: { whatsappGroupJid: true, whatsappGroupSubject: true },
  });
  return selection ? { jid: selection.whatsappGroupJid, subject: selection.whatsappGroupSubject } : null;
}

/**
 * Whether some other project holds this group. Archived projects count: a past client's group is
 * still a past client's chat, and a name that matches it is no reason to message them.
 */
const groupHeldElsewhere = async (jid, salesProjectId) => Boolean(
  await prisma.salesProject.findFirst({ where: { whatsappGroupJid: jid, deletedAt: null, id: { not: salesProjectId } }, select: { id: true } })
  || await prisma.imageSelectionProject.findFirst({ where: { whatsappGroupJid: jid, deletedAt: null, NOT: { salesProjectId } }, select: { id: true } }),
);

/** The group this sale's messages go to, from the groups the sender's WhatsApp is in. */
async function projectGroup(project, userId, { sessions, findLinked = findLinkedGroup, heldElsewhere = groupHeldElsewhere }) {
  const memberOf = await sessions.listGroups(userId);
  const linked = await findLinked(project.id);

  if (linked?.jid) {
    const group = memberOf.find((item) => item.jid === linked.jid);
    if (!group) throw httpError(409, `Your WhatsApp is not in this project's group${linked.subject ? ` "${linked.subject}"` : ""}.`, "NOT_IN_GROUP");
    return { ...group, linked: true };
  }

  const wanted = nameKey(project.whatsappGroupName);
  if (!wanted) throw httpError(422, "This project has no WhatsApp group name to find its group by.", "NO_GROUP_NAME");
  const free = [];
  for (const group of memberOf.filter((item) => nameKey(item.subject) === wanted)) {
    if (!(await heldElsewhere(group.jid, project.id))) free.push(group);
  }
  if (!free.length) throw httpError(422, `No WhatsApp group named "${project.whatsappGroupName}" in your WhatsApp. Create it, or join it, and try again.`, "NO_GROUP");
  if (free.length > 1) throw httpError(409, `More than one WhatsApp group is named "${project.whatsappGroupName}". Link the right one on Pre Production → General.`, "AMBIGUOUS_GROUP");
  return { ...free[0], linked: false };
}

function dependenciesOf(dependencies) {
  return {
    sessions: dependencies.sessions || require("../whatsapp-chat/sessionManager"),
    switches: dependencies.chatSwitches || require("../whatsapp-chat/repository"),
    findLinked: dependencies.findLinked,
    heldElsewhere: dependencies.heldElsewhere,
    activity: dependencies.activity || require("../../../services/whatsappActivity"),
  };
}

async function requireChatOn(switches, userId) {
  if (!(await switches.isChatEnabled())) throw httpError(403, "WhatsApp chat is switched off for the studio. An administrator has to switch it back on before you can message.");
  if (!(await switches.isChatEnabledForUser(userId))) throw httpError(403, "Your WhatsApp chat has been switched off by an administrator.");
}

/** Which group Send WhatsApp would use, for the dialog to name before anything is sent. */
async function resolveProjectGroup(project, userId, dependencies = {}) {
  const { sessions, switches, findLinked, heldElsewhere } = dependenciesOf(dependencies);
  await requireChatOn(switches, userId);
  const group = await projectGroup(project, userId, { sessions, findLinked, heldElsewhere });
  return { groupSubject: group.subject || null, linked: group.linked };
}

/**
 * Sends the message, as the dialog's box holds it, into the project's group from this person's
 * WhatsApp. `project` is one the caller reaches (`findLiveProject`).
 */
async function sendToProjectGroup(project, userId, message, dependencies = {}) {
  const { sessions, switches, findLinked, heldElsewhere, activity } = dependenciesOf(dependencies);
  // What the send is, for the Activity Log - CRD Link Ready's unless the caller says otherwise
  // (a payment receipt from Accounts).
  const { trigger = "CRD_DOCUMENT_LINK", eventRef = `crd-link:${project.id}`, logTag = "crd-link", what = "CRD link" } = dependencies.purpose || {};
  await requireChatOn(switches, userId);
  const group = await projectGroup(project, userId, { sessions, findLinked, heldElsewhere });
  // Recorded in Settings → WhatsApp Activity Log, where a failed one can be sent again into this group.
  const sent = await activity.track({
    mode: "MANUAL", provider: "baileys", trigger, eventRef,
    initiatedByUserId: userId, senderUserId: userId, links: { salesProjectId: project.id },
    recipient: { kind: "GROUP", address: group.jid, name: group.subject || project.whatsappGroupName || null },
    body: message, resendable: true,
  }, () => sessions.sendMessageToGroup({ userId, jid: group.jid, body: message }));
  // Who sent into which group, for the record - never the message itself.
  console.info(`[${logTag}] user ${userId} sent project ${project.id}'s ${what} to WhatsApp group ${group.jid}`);
  return { sent: true, groupSubject: group.subject || null, providerMessageId: sent?.waMessageId || null };
}

module.exports = { sendToProjectGroup, resolveProjectGroup, projectGroup };
