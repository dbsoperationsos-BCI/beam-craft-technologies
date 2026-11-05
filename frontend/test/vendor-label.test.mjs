import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { vendorLabel } from "../src/lib/vendorLabel.mjs";

const { vendorLabel: serverLabel } = createRequire(import.meta.url)("../../backend/src/services/vendorLabel.js");

test("a vendor reads as source-name (business registration name, city)", () => {
  assert.equal(vendorLabel({ sourceType: "EXT", vendorName: "Sudeep", businessRegistrationName: "DBS", city: "Erode" }), "EXT-Sudeep (DBS, Erode)");
});

test("a part the vendor lacks is left out, never an empty bracket", () => {
  assert.equal(vendorLabel({ sourceType: "EXT", vendorName: "Sudeep", city: "Erode" }), "EXT-Sudeep (Erode)");
  assert.equal(vendorLabel({ sourceType: "EXT", vendorName: "Sudeep", businessRegistrationName: "DBS", city: "  " }), "EXT-Sudeep (DBS)");
  assert.equal(vendorLabel({ vendorName: "Sudeep" }), "EXT-Sudeep");
  assert.equal(vendorLabel({ vendorName: "" }), "");
  assert.equal(vendorLabel(null), "");
});

test("the server names a vendor exactly as the screens do", () => {
  for (const vendor of [
    { sourceType: "EXT", vendorName: "Sudeep", businessRegistrationName: "DBS", city: "Erode" },
    { sourceType: "INT", vendorName: "Lens Co", city: "Coimbatore" },
    { vendorName: "Crew Co" },
  ]) assert.equal(serverLabel(vendor), vendorLabel(vendor));
  assert.equal(serverLabel({ vendorName: "" }), null);
});
