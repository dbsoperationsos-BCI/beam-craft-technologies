const test = require("node:test"); const assert = require("node:assert/strict");
const { createPublishShareService, normalizeWhatsAppNumber } = require("../src/modules/image-selection/publish-share/service");
function setup({ project = { id: "image-1", projectName: "Wedding", salesProjectId: "sales-1", clientName: null, clientMainNumber: null, publishVersion: 1 }, salesProject = { id: "sales-1", eventId: "EVT-1", whatsappGroupName: "Client", clientMainNumber: "+91 9876543210" }, publication = { status: "PUBLISHED", clientPath: "/gallery/token", pin: "1234" }, before = { status: "UNPUBLISHED" }, deliverables = [{ name: "Edited Photos", enabled: true, inactiveAt: null, selectionLimit: 25, quantity: 25 }] } = {}) { const repo = { version: 1, findProject: async () => project, findSalesProject: async () => salesProject, incrementVersion: async () => ({ publishVersion: ++repo.version }) }; const dependencies = { publisher: { status: async () => before, publish: async () => publication }, deliverables: { list: async () => deliverables }, projects: { saveSettings: async () => ({}) } }; return { repo, service: createPublishShareService(repo, dependencies) }; }
// A project created with a manual name has no SalesProject, so it carries its own client.
const manualProject = (overrides = {}) => ({ id: "image-2", projectName: "Studio Walk-in", salesProjectId: null, clientName: "Anika", clientMainNumber: "+91 9000000000", publishVersion: 1, ...overrides });
test("returns client context when the linked client is missing", async () => { const { service } = setup({ salesProject: null }); await assert.rejects(() => service.prepare("image-1", 1), (error) => error.status === 422 && error.details.action === "link_project_management_project"); });
test("returns edit context when client number is missing", async () => { const { service } = setup({ salesProject: { id: "sales-1", eventId: "EVT-1", clientMainNumber: "" } }); await assert.rejects(() => service.prepare("image-1", 1), (error) => error.status === 422 && error.details.field === "clientMainNumber"); });
test("normalizes a real client WhatsApp number and rejects invalid country codes", () => { assert.equal(normalizeWhatsAppNumber("+91 (98765) 43210"), "+919876543210"); assert.equal(normalizeWhatsAppNumber("+0 9876543210"), null); });
test("rejects a publication response without secure gallery credentials", async () => { const { service } = setup({ publication: { status: "UNPUBLISHED", clientPath: null, pin: null } }); await assert.rejects(() => service.prepare("image-1", 1), { status: 409 }); });
test("returns generated URL, PIN, deliverable summary, and increments publish version", async () => { const { service } = setup(); const result = await service.prepare("image-1", 1); assert.equal(result.gallery.clientPath, "/gallery/token"); assert.equal(result.gallery.pin, "1234"); assert.equal(result.gallery.publishVersion, 2); assert.equal(result.deliverables[0].selectionLimit, 25); assert.match(result.whatsappPreview.variables.deliverableSummary, /Edited Photos: 25/); });
test("shares the gallery link expiry date with the WhatsApp template", async () => { const { service } = setup({ publication: { status: "PUBLISHED", clientPath: "/gallery/token", pin: "1234", expiresAt: new Date("2027-02-12T05:00:00.000Z") } }); const result = await service.prepare("image-1", 1); assert.equal(result.gallery.expiresAtLabel, "12 Feb 2027"); assert.equal(result.whatsappPreview.variables.linkExpiryLabel, "12 Feb 2027"); });
test("leaves the expiry blank when the gallery has no stored end date", async () => { const { service } = setup(); const result = await service.prepare("image-1", 1); assert.equal(result.gallery.expiresAt, null); assert.equal(result.whatsappPreview.variables.linkExpiryLabel, ""); });
test("keeps the existing publish version when gallery was already published", async () => { const { service } = setup({ before: { status: "PUBLISHED" } }); const result = await service.prepare("image-1", 1); assert.equal(result.gallery.publishVersion, 1); });
test("hands the WhatsApp template the short client URL when the publication carries one", async () => { const { service } = setup({ publication: { status: "PUBLISHED", clientPath: "/gallery/token", clientUrl: "https://gallery.dontblinkstudioz.com/A7K9C2", shortCode: "A7K9C2", pin: "1234" } }); const result = await service.prepare("image-1", 1); assert.equal(result.gallery.clientUrl, "https://gallery.dontblinkstudioz.com/A7K9C2"); assert.equal(result.whatsappPreview.variables.clientUrl, "https://gallery.dontblinkstudioz.com/A7K9C2"); });
test("falls back to the long tokenized path for a publication without a short code yet", async () => { const { service } = setup(); const result = await service.prepare("image-1", 1); assert.equal(result.gallery.clientUrl, "/gallery/token"); assert.equal(result.whatsappPreview.variables.clientUrl, "/gallery/token"); });

test("addresses the invite from a manual project's own client details", async () => {
  const { service } = setup({ project: manualProject(), salesProject: null, deliverables: [] });
  const result = await service.prepare("image-2", 1);
  assert.equal(result.client.salesProjectId, null);
  assert.equal(result.client.clientName, "Anika");
  assert.equal(result.client.eventId, null);
  assert.equal(result.gallery.pin, "1234");
  // No linked event to name, so the template falls back to the project name.
  assert.equal(result.whatsappPreview.variables.eventName, "Studio Walk-in");
  assert.equal(result.whatsappPreview.variables.deliverableSummary, "");
});

test("asks for the client number when a manual project has none", async () => {
  const { service } = setup({ project: manualProject({ clientMainNumber: null }), salesProject: null });
  await assert.rejects(() => service.prepare("image-2", 1), (error) => error.status === 422 && error.details.action === "edit_image_selection_client");
});

test("greets a manual project's client by the project name when no client name was entered", async () => {
  const { service } = setup({ project: manualProject({ clientName: null }), salesProject: null, deliverables: [] });
  assert.equal((await service.prepare("image-2", 1)).client.clientName, "Studio Walk-in");
});

test("carries the unmasked recipient to the sender without exposing it in the response", async () => {
  const { service } = setup({ project: manualProject(), salesProject: null, deliverables: [] });
  const prepared = await service.prepareForNotification("image-2", 1, {});
  assert.equal(prepared._recipient, "+919000000000");
  assert.equal(prepared.client.whatsappRecipientMasked.includes("9000000000"), false);
  assert.equal((await service.prepare("image-2", 1))._recipient, undefined);
});

test("builds the one invite message the panel, the group send and the wa.me link all use", async () => {
  const { service } = setup({ publication: { status: "PUBLISHED", clientPath: "/gallery/token", clientUrl: "https://gallery.dontblinkstudioz.com/A7K9C2", pin: "1234", expiresAt: new Date("2027-02-12T05:00:00.000Z") } });
  const result = await service.prepare("image-1", 1);
  assert.equal(result.whatsappPreview.message, ["Client Name : Client", "Link : https://gallery.dontblinkstudioz.com/A7K9C2", "PIN : 1234", "Link Valid Till : 12 Feb 2027", "", "Output: Edited Photos", "Selection Limit : 25"].join("\n"));
});

test("the invite names the event date as a day, not a timestamp", async () => {
  const { service } = setup({ salesProject: { id: "sales-1", eventId: "EVT-1", whatsappGroupName: "Client", clientMainNumber: "+91 9876543210", mainEventDate: new Date("2026-12-15T05:00:00.000Z") } });
  const result = await service.prepare("image-1", 1);
  assert.equal(result.whatsappPreview.message.split("\n")[1], "Event Date : 15 Dec 2026");
});

test("drops the optional invite lines a manual project cannot fill", async () => {
  const { service } = setup({ project: manualProject(), salesProject: null, deliverables: [] });
  const result = await service.prepare("image-2", 1);
  assert.equal(result.whatsappPreview.message, "Client Name : Anika\nLink : /gallery/token\nPIN : 1234");
});
