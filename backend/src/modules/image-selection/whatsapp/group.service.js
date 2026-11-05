const repository = require("./repository");
const { keyFor } = require("./service");
const { createPublishShareService } = require("../publish-share/service");
const { serialize } = require("../projects/service");

/*
 * The project's WhatsApp group, and the gallery invite sent into it.
 *
 * The studio runs every production project in a WhatsApp group with the client, and the project's
 * name here *is* that group's name - the list sync copies it from the Sales project. So the link is
 * made by matching names against the groups the coordinator's own paired WhatsApp is in, offered
 * for confirmation rather than assumed, and the invite then goes into that group from whoever
 * pressed Send: the pre-production coordinator's number when they did, the post-production
 * coordinator's when they did. The session is theirs, never the app's, exactly as the CRM chat's is.
 *
 * Three rules hold it honest. A jid from the browser is trusted for nothing: it is linked only if
 * the caller's WhatsApp actually answered for that group. One live project per group, because two
 * projects pointed at one group means an invite for one client landing in another's chat. And the
 * send is idempotent per publish version through the same notification table the Meta path uses -
 * two coordinators pressing Send on the same gallery is one message, not two.
 */

const GROUP_PROVIDER = "baileys-group";
const GROUP_TEMPLATE = "image_selection_gallery_group";

function httpError(status, message, details, code) { const error = new Error(message); error.status = status; if (details) error.details = details; if (code) error.code = code; return error; }
// How two names are the same name: case, surrounding space and doubled spaces do not make a
// difference a person would notice, and the group is named on a phone keyboard.
function nameKey(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }

function createGroupLinkService(repo = repository, dependencies = {}) {
  // Required lazily: the session manager opens no socket on require, but it is the one module
  // here that reaches WhatsApp, and every test hands in a stand-in instead.
  const sessions = () => dependencies.sessions || require("../../sales/whatsapp-chat/sessionManager");
  const publishShare = dependencies.publishShare || createPublishShareService();
  const now = dependencies.now || (() => new Date());

  async function requireProject(projectId) {
    const project = await repo.findProject(projectId);
    if (!project) throw httpError(404, "Image Selection project not found.");
    return project;
  }

  // The caller's groups, each saying whether some other live project already holds it, and which
  // one is named like this project - the picker pre-selects that one.
  async function listGroups(projectId, userId) {
    const project = await requireProject(projectId);
    const [groups, links] = await Promise.all([sessions().listGroups(userId), repo.listLiveProjectLinks()]);
    const holders = new Map(links.filter((link) => link.whatsappGroupJid && link.id !== project.id).map((link) => [link.whatsappGroupJid, link]));
    const wanted = nameKey(project.projectName);
    const listed = groups.map((group) => {
      const holder = holders.get(group.jid);
      return { ...group, linkedProjectId: holder?.id || null, linkedProjectName: holder?.projectName || null, matchesProject: Boolean(wanted) && nameKey(group.subject) === wanted };
    });
    const suggested = listed.find((group) => group.matchesProject && !group.linkedProjectId) || null;
    return { project: serialize(project), groups: listed, suggestedJid: suggested?.jid || null };
  }

  async function link(projectId, userId, jid) {
    const project = await requireProject(projectId);
    if (project.archivedAt) throw httpError(409, "An archived project cannot be linked to a WhatsApp group. Restore it first.");
    // Only a group this user's own WhatsApp is in. The jid came from the browser.
    const group = (await sessions().listGroups(userId)).find((item) => item.jid === jid);
    if (!group) throw httpError(400, "Your WhatsApp is not in that group.", undefined, "NOT_IN_GROUP");
    const holder = await repo.findLiveProjectByGroupJid(jid, project.id);
    if (holder) throw httpError(409, `That group is already linked to "${holder.projectName}". Unlink it there first.`, { linkedProjectId: holder.id, linkedProjectName: holder.projectName }, "GROUP_TAKEN");
    return serialize(await repo.linkGroup(project.id, { jid, subject: group.subject }));
  }

  async function unlink(projectId) {
    const project = await requireProject(projectId);
    return serialize(await repo.unlinkGroup(project.id));
  }

  // Every live project without a group, linked to the one group that carries its name - and left
  // alone when there is none, when there are two, or when the only one is already some other
  // project's. Nothing is sent; this only writes links, and says which projects it could not.
  async function linkAll(userId) {
    const [groups, links] = await Promise.all([sessions().listGroups(userId), repo.listLiveProjectLinks()]);
    const taken = new Set(links.map((link) => link.whatsappGroupJid).filter(Boolean));
    const byName = new Map();
    for (const group of groups) {
      const key = nameKey(group.subject);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(group);
    }
    const result = { linked: [], alreadyLinked: 0, unmatched: [], ambiguous: [] };
    for (const project of links) {
      if (project.whatsappGroupJid) { result.alreadyLinked += 1; continue; }
      const candidates = (byName.get(nameKey(project.projectName)) || []).filter((group) => !taken.has(group.jid));
      if (!candidates.length) { result.unmatched.push(project.projectName); continue; }
      if (candidates.length > 1) { result.ambiguous.push(project.projectName); continue; }
      const [group] = candidates;
      await repo.linkGroup(project.id, { jid: group.jid, subject: group.subject });
      taken.add(group.jid);
      result.linked.push(project.projectName);
    }
    return result;
  }

  /*
   * Publishes if need be, builds the invite, and sends it into the linked group from this user's
   * WhatsApp. Synchronous rather than queued: the socket lives in the API process, and the send
   * worker may not - so unlike the Meta path there is nothing a job could do from elsewhere.
   */
  async function sendInvite(projectId, userId, pending = {}) {
    const project = await requireProject(projectId);
    if (!project.whatsappGroupJid) throw httpError(422, "This project is not linked to a WhatsApp group yet.", { projectId: project.id, projectName: project.projectName, action: "link_whatsapp_group" });
    const prepared = await publishShare.prepareForNotification(project.id, userId, pending);
    // The client's own number rides along for the Meta path and has no business in a group send.
    delete prepared._recipient;
    const text = prepared.whatsappPreview.message;
    const idempotencyKey = keyFor({ imageSelectionProjectId: project.id, recipient: project.whatsappGroupJid, publishVersion: prepared.gallery.publishVersion, templateName: GROUP_TEMPLATE });
    const snapshot = JSON.stringify({ userId, jid: project.whatsappGroupJid, subject: project.whatsappGroupSubject, text });
    const existing = await repo.findByKey(idempotencyKey);
    if (existing?.status === "SENT") return { preview: prepared, notification: { ...existing, status: "ALREADY_SENT" } };
    let notification;
    if (existing) {
      // A failed earlier attempt for this same gallery version is tried again on the same row.
      notification = await repo.update(existing.id, { status: "SENDING", errorCode: null, errorMessage: null, messageSnapshot: snapshot });
    } else {
      try {
        notification = await repo.create({ salesProjectId: project.salesProjectId, imageSelectionProjectId: project.id, provider: GROUP_PROVIDER, template: GROUP_TEMPLATE, recipientMasked: String(project.whatsappGroupSubject || project.whatsappGroupJid).slice(0, 64), messageSnapshot: snapshot, idempotencyKey, status: "SENDING" });
      } catch (error) {
        // Two coordinators pressing Send in the same second: the second create loses on the unique
        // key, and the first press's message is the one that goes.
        if (error?.code !== "P2002") throw error;
        const winner = await repo.findByKey(idempotencyKey);
        return { preview: prepared, notification: { ...winner, status: winner?.status === "SENT" ? "ALREADY_SENT" : winner?.status || "SENDING" } };
      }
    }
    try {
      const sent = await sessions().sendMessageToGroup({ userId, jid: project.whatsappGroupJid, body: text });
      return { preview: prepared, notification: await repo.update(notification.id, { status: "SENT", providerMessageId: sent.waMessageId || null, sentAt: now() }) };
    } catch (error) {
      await repo.update(notification.id, { status: "FAILED", errorCode: error.code || "SEND_FAILED", errorMessage: String(error.message || "WhatsApp send failed.").slice(0, 2000) }).catch(() => {});
      throw error;
    }
  }

  return { listGroups, link, unlink, linkAll, sendInvite };
}

module.exports = { createGroupLinkService, nameKey, GROUP_PROVIDER, GROUP_TEMPLATE };
