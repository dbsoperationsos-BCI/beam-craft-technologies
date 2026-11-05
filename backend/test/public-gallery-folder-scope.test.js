const test = require("node:test");
const assert = require("node:assert/strict");
const { folderScope } = require("../src/modules/image-selection/public-gallery/controller");

/*
 * The client gallery lists photos by folder; the People tab lists a person's photos across every
 * folder through the same route. The folder parameter decides which, and this pins its three
 * readings so `all` can never be mistaken for a folder called "all" or for the unfiled photos.
 */
test("a folder parameter means that folder, `unfiled` the photos in none, and `all` the whole gallery", () => {
  assert.equal(folderScope("ckfolder123"), "ckfolder123");
  assert.equal(folderScope("unfiled"), null, "unfiled is a null folder id in the query");
  assert.equal(folderScope("all"), undefined, "all leaves the query unfiltered by folder");
});
