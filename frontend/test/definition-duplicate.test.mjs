import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { duplicateDeliverableValues } from "../src/lib/definitionDuplicate.mjs";
import { definitionNameKey, definitionNameTaken, takenDefinitionNameKeys } from "../src/lib/projectDefinitionNames.mjs";
import { pricingFormLines } from "../src/lib/servicePricing.mjs";
import { brandFormRows, brandsForSave } from "../src/lib/deliverableBrands.mjs";

/*
 * More → Duplicate on a service or a deliverable opens the Add dialog filled from the row, name left
 * empty. It is still adding: the draft has no id, so Add creates a new row and the source is never
 * written to.
 */

const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PANEL = src("components", "project-management", "ProjectSettingsPanel.js");
const SERVICE_DIALOG = src("components", "project-management", "ServiceDefinitionDialog.js");
const DELIVERABLE_DIALOG = src("components", "project-management", "DeliverableDefinitionDialog.js");

test("the menu reads Edit, Duplicate, Delete on both tables", () => {
  for (const [draft, confirm] of [["setServiceDraft", "setConfirmRemoveService"], ["setDeliverableDraft", "setConfirmRemoveDeliverable"]]) {
    const at = PANEL.indexOf(`{ label: "Edit", onSelect: () => { ${draft}(`);
    const dup = PANEL.indexOf(`{ label: "Duplicate", onSelect: () => { ${draft}({ copyOf: `);
    const del = PANEL.indexOf(`{ label: "Delete", tone: "danger", onSelect: () => ${confirm}(`);
    assert.ok(at > 0 && dup > at && del > dup, draft);
  }
});

test("a duplicate has no id, so Add creates and the dialog is in Add mode", () => {
  // The draft is `{ copyOf }`: no id, so the dialog gets no record to edit and the write is a create.
  assert.match(PANEL, /service=\{serviceDraft\.id \? serviceDraft : null\}/);
  assert.match(PANEL, /deliverable=\{deliverableDraft\.id \? deliverableDraft : null\}/);
  assert.match(PANEL, /copyOf=\{serviceDraft\.copyOf \|\| null\}/);
  assert.match(PANEL, /copyOf=\{deliverableDraft\.copyOf \|\| null\}/);
  assert.match(PANEL, /let id = draft\?\.id \|\| createdIdRef\.current;/);
  // Every other name is taken - the source's included, since the draft has no id to exempt.
  assert.match(PANEL, /takenNames=\{takenDefinitionNameKeys\(services, serviceDraft\.id \|\| null\)\}/);
  for (const dialog of [SERVICE_DIALOG, DELIVERABLE_DIALOG]) {
    // Edit is decided by the record being edited only; a copy never makes it an edit.
    assert.match(dialog, /const isEdit = Boolean\((service|deliverable)\?\.id\);/);
    assert.match(dialog, /const source = (service \|\| copyOf|deliverable \|\| copyOf);/);
    // The name never comes from the copy.
    assert.match(dialog, /name: (service|deliverable)\?\.name \|\| initialName \|\| "",/);
    assert.doesNotMatch(dialog, /name: source\?\.name/);
  }
  assert.match(SERVICE_DIALOG, /title=\{isEdit \? "Edit Service" : "Add Service"\}/);
  assert.match(DELIVERABLE_DIALOG, /title=\{isEdit \? "Edit Deliverable" : "Add Deliverable"\}/);
});

test("the source's name is refused, by the same rule the server uses, case and spacing ignored", () => {
  const taken = takenDefinitionNameKeys([{ id: "s1", name: "360 PhotoBooth" }], null);
  for (const name of ["360 PhotoBooth", " 360 photobooth ", "360 PHOTOBOOTH", "360-PhotoBooth"]) assert.equal(definitionNameTaken(name, taken), true, name);
  assert.equal(definitionNameTaken("360 PhotoBooth Premium", taken), false);
  assert.equal(definitionNameKey(" signature album "), definitionNameKey("SIGNATURE ALBUM"));
});

test("a service's pricing lines, with the deliverables each brings, are copied as new lines", () => {
  const pricing = [
    { shootType: "STUDIO", timingMode: "HALF_SESSION", duration: "4-5 Hours (Half)", price: 2000, deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v1" }, { deliverableId: "d2", brandId: "b2", variantId: "v2" }] },
    { shootType: "STUDIO", timingMode: "FULL_SESSION", duration: "8-10 Hours (Full)", price: 4000, deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v1" }] },
  ];
  const before = JSON.stringify(pricing);
  const lines = pricingFormLines(pricing);
  assert.deepEqual(lines.map((line) => [line.shootType, line.timingMode, line.duration, line.price, line.deliverables.length]), [
    ["STUDIO", "HALF_SESSION", "4-5 Hours (Half)", "2000", 2],
    ["STUDIO", "FULL_SESSION", "8-10 Hours (Full)", "4000", 1],
  ]);
  lines[0].price = "9999";
  lines[0].deliverables.pop();
  assert.equal(JSON.stringify(pricing), before, "editing the copy left the source alone");
});

test("a deliverable's brands and variants are copied, sent without their ids, so new ones are made", () => {
  const source = { brands: [
    { id: "b1", name: "Canvera", variants: [{ id: "v1", size: "12x18", frameInches: "1.5 inch", price: 2500 }, { id: "v2", size: "12x24", frameInches: "2 inch", price: 3200 }] },
    { id: "b2", name: "Textra", variants: [{ id: "v3", size: "12x18", frameInches: "1 inch", price: 2200 }] },
  ] };
  const before = JSON.stringify(source);
  const rows = brandFormRows(source.brands);
  const sent = brandsForSave(rows, "IMAGE");
  assert.deepEqual(sent, [
    { name: "Canvera", variants: [{ size: "12x18", frameInches: "1.5 inch", videoLength: null, price: 2500 }, { size: "12x24", frameInches: "2 inch", videoLength: null, price: 3200 }] },
    { name: "Textra", variants: [{ size: "12x18", frameInches: "1 inch", videoLength: null, price: 2200 }] },
  ]);
  assert.doesNotMatch(JSON.stringify(sent), /"id"/);
  rows[0].variants[0].size = "changed";
  assert.equal(JSON.stringify(source), before);
});

test("what the deliverable dialog does not ask is carried from the source, and the dialog wins", () => {
  const source = {
    id: "d1", code: "SIGNATURE_ALBUM", name: "Signature Album", createdAt: "x", updatedAt: "y", isActive: true, sortOrder: 4,
    price: 5000, sizeOptionSetId: "set-1", shootTypes: ["STUDIO"], timingModes: ["FULL_SESSION"], defaultDurationHours: 2, defaultDurationMinutes: 30,
    mediaType: "IMAGE", brandName: "Canvera", imageSize: "12x18", frameInches: "1.5 inch", videoLength: null, brands: [],
  };
  const values = { name: "Signature Album Premium", complimentary: true, remarksEnabled: "Premium finish", mediaType: "IMAGE", pricing: null, brands: [] };
  const staged = duplicateDeliverableValues(source, values);
  assert.deepEqual(staged, {
    price: 5000, sizeOptionSetId: "set-1", shootTypes: ["STUDIO"], timingModes: ["FULL_SESSION"], defaultDurationHours: 2, defaultDurationMinutes: 30,
    brandName: "Canvera", imageSize: "12x18", videoLength: null, frameInches: "1.5 inch",
    ...values,
  });
  // No system field crosses: not the id, the code, the order, the timestamps or the active flag.
  for (const field of ["id", "code", "createdAt", "updatedAt", "isActive", "sortOrder"]) assert.equal(field in staged, false, field);
  // A copy, not the source's own array.
  staged.shootTypes.push("OUTDOOR");
  assert.deepEqual(source.shootTypes, ["STUDIO"]);
  // Sold by brands: the four words are the server's to rewrite, so they are not carried.
  const branded = duplicateDeliverableValues({ ...source, brands: [{ name: "Canvera", variants: [{ size: "12x18" }] }] }, values);
  assert.equal("brandName" in branded, false);
  // A type never answered keeps the per-kind pricing it is priced under.
  const legacy = duplicateDeliverableValues({ ...source, mediaType: null, kind: "ALBUM", pricing: [{ kind: "ALBUM", size: "12x18", price: 900 }] }, { name: "X" });
  assert.deepEqual([legacy.kind, legacy.pricing], ["ALBUM", [{ kind: "ALBUM", size: "12x18", price: 900 }]]);
  // Only a duplicate is carried: Add and Edit write what the dialog sends, as they always did.
  assert.equal(duplicateDeliverableValues(null, values), values);
  assert.match(PANEL, /const written = deliverableDraft\?\.copyOf \? duplicateDeliverableValues\(deliverableDraft\.copyOf, values\) : values;/);
});
