const test = require("node:test");
const assert = require("node:assert/strict");
const publicationService = require("../src/modules/image-selection/publication/service");
const galleryService = require("../src/modules/image-selection/gallery/service");
const deliverableService = require("../src/modules/image-selection/deliverables/service");
const controller = require("../src/modules/image-selection/public-gallery/controller");

/*
 * The client gallery's People tab re-reads `/folders?personId=` on every press of a person. That
 * is browsing, not the client opening the gallery again, so only the unfiltered read records an
 * open; the dashboard's "last opened" stays what the client actually did.
 */
const fakeRes = () => { const res = { statusCode: 200, body: null }; res.status = (code) => { res.statusCode = code; return res; }; res.json = (body) => { res.body = body; return res; }; return res; };
const request = (query) => ({ params: { token: "ABCD1234" }, query, headers: { authorization: "Bearer session" } });

test("an unfiltered folder read records the gallery as opened; a People-filtered re-read does not", async () => {
  const original = { verifySession: publicationService.verifySession, authorize: publicationService.authorize, recordGalleryOpened: publicationService.recordGalleryOpened, selectionSummary: galleryService.selectionSummary, createDeliverableService: deliverableService.createDeliverableService };
  const opened = [];
  publicationService.verifySession = () => ({ projectId: "proj" });
  publicationService.authorize = async () => ({ projectId: "proj", project: { projectName: "Arun & Meena" } });
  publicationService.recordGalleryOpened = async (projectId) => { opened.push(projectId); };
  deliverableService.createDeliverableService = () => ({ list: async () => [] });
  galleryService.selectionSummary = async (projectId, options) => ({ folders: [{ folderId: "f1", name: "card 1", total: options.personId ? 3 : 52, selected: 0, selectedByDeliverable: {} }], overall: { total: 0, selected: 0 }, selectionCounts: {} });
  try {
    const plain = fakeRes(); await controller.listFolders(request({}), plain);
    assert.equal(plain.statusCode, 200); assert.equal(plain.body.data.folders[0].total, 52);
    assert.deepEqual(opened, ["proj"], "the gallery's own folders are the client opening it");
    const filtered = fakeRes(); await controller.listFolders(request({ personId: "p1,p2" }), filtered);
    assert.equal(filtered.statusCode, 200); assert.equal(filtered.body.data.folders[0].total, 3, "the summary is asked for the chosen people");
    assert.deepEqual(opened, ["proj"], "pressing people is not another open");
  } finally { Object.assign(publicationService, { verifySession: original.verifySession, authorize: original.authorize, recordGalleryOpened: original.recordGalleryOpened }); galleryService.selectionSummary = original.selectionSummary; deliverableService.createDeliverableService = original.createDeliverableService; }
});
