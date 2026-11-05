const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshotDocumentBranding, brandingForDocument } = require("../src/services/documentBranding");

test("a document answers with the logo on its own row, never anything else", () => {
  assert.deepEqual(brandingForDocument({ logoUrl: "https://cdn/old-logo.png" }), { logoUrl: "https://cdn/old-logo.png" });
});

test("a document written before the snapshot existed shows the default mark, not today's logo", () => {
  assert.deepEqual(brandingForDocument({ logoUrl: null }), { logoUrl: null });
  assert.deepEqual(brandingForDocument({}), { logoUrl: null });
  assert.deepEqual(brandingForDocument(null), { logoUrl: null });
});

test("a new document copies the Global Logo current at the moment it is created", async () => {
  const reader = { read: async () => ({ galleryLogoUrl: "https://cdn/new-logo.png" }) };
  assert.deepEqual(await snapshotDocumentBranding(reader), { logoUrl: "https://cdn/new-logo.png" });
});

test("no Global Logo configured snapshots as nothing, so the document shows the default mark", async () => {
  assert.deepEqual(await snapshotDocumentBranding({ read: async () => ({ galleryLogoUrl: null }) }), { logoUrl: null });
  assert.deepEqual(await snapshotDocumentBranding({ read: async () => ({ galleryLogoUrl: "" }) }), { logoUrl: null });
});
