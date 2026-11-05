const test = require("node:test");
const assert = require("node:assert/strict");
const repository = require("../src/modules/image-selection/publication/repository");
const settingsRepository = require("../src/modules/image-selection/settings/repository");
const service = require("../src/modules/image-selection/publication/service");

/*
 * The client gallery's heading names the client. A linked project reads them from its Sales Manager
 * WhatsApp group; a manually named project has no group, and its client is the name typed on the
 * Create New Project form — which the gallery used to ignore, heading every manual project
 * "Your gallery".
 */

function monthsFromNow(months) { const date = new Date(); date.setMonth(date.getMonth() + months); return date; }
let projectSeq = 0;
function publication(project) {
  projectSeq += 1;
  return { projectId: `project-${projectSeq}`, status: "PUBLISHED", shortCode: "A7K9C2", publishedAt: monthsFromNow(-1), expiresAt: monthsFromNow(5), pinHash: null, project: { deletedAt: null, ...project } };
}

function serve(row, group = null) {
  repository.findByShortCode = async () => row;
  repository.markGalleryOpened = async () => {};
  repository.countReadyImages = async () => 0;
  repository.findWhatsappGroupName = async (id) => (id ? group : null);
  settingsRepository.find = async () => null;
}

test("a manually named project is headed with the client typed on its form", async () => {
  serve(publication({ projectName: "Wedding Album", clientName: "Anita Rao", salesProject: null }));
  const meta = await service.meta("A7K9C2");
  assert.equal(meta.clientName, "Anita Rao");
  assert.equal(meta.projectName, "Wedding Album");
});

test("a linked project still reads its client from the WhatsApp group", async () => {
  serve(publication({ projectName: "Ravi & Priya", clientName: null, salesProject: { whatsappGroupNameId: "g1", groupType: "Dum Dum" } }), { groomName: "Ravi", brideName: "Priya", clientName: "Ravi Kumar" });
  const meta = await service.meta("A7K9C2");
  assert.equal(meta.clientName, "Ravi Kumar");
  assert.equal(meta.groomName, "Ravi");
  assert.equal(meta.brideName, "Priya");
});

test("a project that knows no client says null, not an empty name", async () => {
  serve(publication({ projectName: "Old Gallery", clientName: null, salesProject: null }));
  assert.equal((await service.meta("A7K9C2")).clientName, null);
});
