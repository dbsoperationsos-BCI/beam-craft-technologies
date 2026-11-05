const repository = require("./repository");
const publication = require("../publication/service");
const { createDeliverableService } = require("../deliverables/service");
const { createImageSelectionProjectService } = require("../projects/service");
const { createSettingsService } = require("../settings/service");

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }
function normalizeWhatsAppNumber(value) { const compact = String(value || "").trim().replace(/[\s().-]/g, ""); const match = compact.match(/^\+([1-9]\d{0,2})(\d{6,14})$/); if (!match || match[1].length + match[2].length > 15) return null; return `+${match[1]}${match[2]}`; }
function maskNumber(value) { return `${value.slice(0, Math.min(4, value.length - 4))}${"•".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`; }
// The client sees the day their link stops working, not a timestamp, so the same
// wording is built once here and reused by the WhatsApp template and the preview.
function formatExpiry(value) { return value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : ""; }
// The invite as the client reads it: one message, built here so the panel, the group send and the
// wa.me link all say the same thing. A manual project has no linked event date and may have no
// selection items, so every optional line is dropped rather than left blank - the client should
// not receive a message with holes in it.
function inviteMessage(prepared) {
  return [
    `Client Name : ${prepared.client.clientName}`,
    prepared.client.eventDate ? `Event Date : ${formatExpiry(prepared.client.eventDate)}` : "",
    `Link : ${prepared.gallery.clientUrl || prepared.gallery.clientPath}`,
    `PIN : ${prepared.gallery.pin}`,
    prepared.gallery.expiresAtLabel ? `Link Valid Till : ${prepared.gallery.expiresAtLabel}` : "",
    prepared.deliverables.length ? `\n${prepared.deliverables.map((item) => `Output: ${item.name}\nSelection Limit : ${item.selectionLimit}`).join("\n\n")}` : "",
  ].filter(Boolean).join("\n");
}

function createPublishShareService(repo = repository, dependencies = {}) {
  const publisher = dependencies.publisher || publication; const deliverables = dependencies.deliverables || createDeliverableService(); const projects = dependencies.projects || createImageSelectionProjectService(); const settings = dependencies.settings || createSettingsService();
  // Who the gallery invite is addressed to. A project linked to Sales Manager always reads the
  // client from that SalesProject, so the two can never drift apart. A manual or duplicated
  // project has no SalesProject and carries its own client name and number on its row — no screen
  // asks for them since the fields left Selection Settings, so a manual project without a number
  // already stored cannot be shared until one is entered somewhere.
  async function resolveClient(project) {
    if (project.salesProjectId) {
      const salesProject = await repo.findSalesProject(project.salesProjectId);
      if (!salesProject) throw httpError(422, "This Image Selection project is not linked to a Project Management client.", { projectId: project.id, projectName: project.projectName, action: "link_project_management_project" });
      const recipient = normalizeWhatsAppNumber(salesProject.clientMainNumber);
      if (!recipient) throw httpError(422, "The linked client WhatsApp number is missing or invalid.", { projectId: project.id, projectName: project.projectName, salesProjectId: salesProject.id, eventId: salesProject.eventId, action: "edit_client_details", field: "clientMainNumber" });
      const details = salesProject.groupNameGeneratorJson || {};
      return { salesProjectId: salesProject.id, eventId: salesProject.eventId, clientName: typeof details.clientName === "string" ? details.clientName : salesProject.whatsappGroupName, eventDate: salesProject.mainEventDate || null, recipient };
    }
    const recipient = normalizeWhatsAppNumber(project.clientMainNumber);
    if (!recipient) throw httpError(422, "This project has no client WhatsApp number, so the gallery cannot be shared. Link it to a Project Management client, or record a number for it.", { projectId: project.id, projectName: project.projectName, action: "edit_image_selection_client", field: "clientMainNumber" });
    // The project name is the fallback greeting, which for a manual project is usually the
    // WhatsApp group name the studio typed anyway.
    return { salesProjectId: null, eventId: null, clientName: project.clientName || project.projectName, eventDate: null, recipient };
  }

  async function prepareInternal(projectId, userId, pending = {}) {
    const project = await repo.findProject(projectId); if (!project) throw httpError(404, "Active Image Selection project not found.");
    if (pending.settings) await projects.saveSettings(projectId, pending.settings);
    if (pending.deliverableOverrides?.length) await deliverables.saveOverrides(projectId, pending.deliverableOverrides);
    const client = await resolveClient(project);
    const before = await publisher.status(projectId); const published = await publisher.publish(projectId, userId); const version = before.status === "PUBLISHED" ? project.publishVersion : (await repo.incrementVersion(projectId)).publishVersion;
    if (published.status !== "PUBLISHED" || !published.clientPath || !published.pin) throw httpError(409, "Gallery could not be published with secure access credentials.");
    const enabledDeliverables = (await deliverables.list(projectId)).filter((item) => item.enabled && !item.inactiveAt).map((item) => ({ name: item.name, selectionLimit: item.selectionLimit, quantity: item.quantity ?? null }));
    const recipientMasked = maskNumber(client.recipient);
    // The studio's own name on the invite, from studio-wide settings rather than a literal, so
    // rebranding does not mean a code change.
    const { studioName } = await settings.read();
    // The link the client receives is the short public URL; the long tokenized path stays only as
    // a fallback for a publication row that has not picked up its short code yet.
    const clientUrl = published.clientUrl || published.clientPath;
    const prepared = { gallery: { status: published.status, clientPath: published.clientPath, clientUrl, shortCode: published.shortCode || null, pin: published.pin, publishVersion: version, expiresAt: published.expiresAt || null, expiresAtLabel: formatExpiry(published.expiresAt) }, client: { salesProjectId: client.salesProjectId, eventId: client.eventId, whatsappRecipientMasked: recipientMasked, clientName: client.clientName, eventDate: client.eventDate, whatsappShareUrl: `https://wa.me/${client.recipient.slice(1)}` }, deliverables: enabledDeliverables, whatsappPreview: { recipientMasked, template: "image_selection_gallery", variables: { clientName: client.clientName, projectName: project.projectName, eventName: client.eventId || project.projectName, eventDate: client.eventDate, clientUrl, accessPin: published.pin, publishVersion: version, organizationName: studioName, linkExpiresAt: published.expiresAt || null, linkExpiryLabel: formatExpiry(published.expiresAt), deliverableSummary: enabledDeliverables.map((item) => `${item.name}: ${item.selectionLimit}`).join(", ") } } };
    prepared.whatsappPreview.message = inviteMessage(prepared);
    return { prepared, recipient: client.recipient };
  }

  async function prepare(projectId, userId, pending = {}) { return (await prepareInternal(projectId, userId, pending)).prepared; }
  // The raw recipient field rides alongside rather than inside the prepared payload. The one
  // deliberate exception is client.whatsappShareUrl above: it carries the number as a wa.me link
  // so Review & Share can open the studio's own WhatsApp chat with the client.
  async function prepareForNotification(projectId, userId, pending) { const { prepared, recipient } = await prepareInternal(projectId, userId, pending); return { ...prepared, _recipient: recipient }; }
  return { prepare, prepareForNotification };
}
module.exports = { createPublishShareService, normalizeWhatsAppNumber, maskNumber, formatExpiry, inviteMessage };
