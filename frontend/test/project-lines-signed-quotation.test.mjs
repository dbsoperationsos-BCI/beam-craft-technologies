import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { projectDeliverableUnitPrice, projectLinesAmount, projectServiceUnitPrice } from "../src/lib/projectLinePricing.mjs";

/*
 * Create Project / Edit Sale Details: with no quotation linked, Signed Quotation follows what the
 * service and deliverable lines come to at their Settings prices. Project lines store no price, so
 * it used to sit at ₹0 whatever was selected.
 */

const DRONE = { id: "s-drone", name: "Drone", price: "5000.00" };
const CANDID = { id: "s-candid", name: "Candid", price: 12000 };
const BOOTH = { id: "s-booth", name: "360 PhotoBooth", price: null };
const ALBUM = { id: "d-album", name: "Album", price: "700", photoCountEnabled: null, brands: [
  { id: "b1", name: "Canvera", variants: [{ id: "v12", size: "12x18", frameInches: "", videoLength: "", price: "2200.00" }, { id: "v16", size: "16x24", frameInches: "", videoLength: "", price: null }] },
] };
const PRINTS = { id: "d-prints", name: "Prints", price: "40", photoCountEnabled: "Yes", brands: [] };
const catalogue = { serviceDefinitions: [DRONE, CANDID, BOOTH], deliverableDefinitions: [ALBUM, PRINTS] };
const svc = (definition, extra = {}) => ({ serviceDefinitionId: definition.id, shootId: "s1", quantity: 1, ...extra });
const del = (definition, extra = {}) => ({ deliverableDefinitionId: definition.id, shootId: "s1", quantity: 1, ...extra });

test("A-B: each service at its own Settings Price, times its quantity", () => {
  assert.equal(projectServiceUnitPrice({}, DRONE), 5000);
  assert.equal(projectLinesAmount({ ...catalogue, services: [svc(DRONE), svc(CANDID, { quantity: 2 })] }).amount, 5000 + 24000);
});

test("C: a deliverable at its variant's price - by id when pending, by its words when saved - else its own price", () => {
  assert.equal(projectDeliverableUnitPrice({ deliverableVariantId: "v12" }, ALBUM), 2200);
  assert.equal(projectDeliverableUnitPrice({ brandName: "Canvera", size: "12x18" }, ALBUM), 2200);
  // A chosen variant nobody priced is ₹0, the generator's rule; one that no longer exists is unpriced.
  assert.equal(projectDeliverableUnitPrice({ deliverableVariantId: "v16" }, ALBUM), 0);
  assert.equal(projectDeliverableUnitPrice({ brandName: "Canvera", size: "20x30" }, ALBUM), null);
  // Added as the deliverable alone: its own flat price.
  assert.equal(projectDeliverableUnitPrice({}, ALBUM), 700);
});

test("D-E: services and deliverables together, each counted once; No. of Count multiplies", () => {
  const { amount, unpriced } = projectLinesAmount({ ...catalogue,
    services: [svc(DRONE)],
    deliverables: [del(ALBUM, { deliverableVariantId: "v12", quantity: 2 }), del(PRINTS, { numberOfPhotos: 50 })] });
  assert.equal(amount, 5000 + 4400 + 2000);
  assert.equal(unpriced, 0);
});

test("J: a line Settings prices nothing for counts ₹0 and is counted as unpriced - never given a figure", () => {
  const { amount, unpriced } = projectLinesAmount({ ...catalogue, services: [svc(BOOTH), svc(DRONE)] });
  assert.equal(amount, 5000);
  assert.equal(unpriced, 1);
  // Read from the catalogue as it is now, not the copy a line carries.
  assert.equal(projectLinesAmount({ ...catalogue, services: [svc(DRONE, { serviceDefinition: { ...DRONE, price: 1 } })] }).amount, 5000);
  assert.deepEqual(projectLinesAmount(), { amount: 0, unpriced: 0 });
});

const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CreateProjectFormPanel.js"), "utf8");

test("F-I: it follows the lines only where nobody else answered it", () => {
  // Follows only a form that opened with no figure: a saved project's, a lead's, a duplicate's or a
  // draft's figure stands, and the note says what the lines come to instead.
  assert.match(PANEL, /const \[signedFollowsLines, setSignedFollowsLines\] = useState\(\(\) => !\(Number\(form\.initialConvertedValue\) > 0\)\);/);
  // Never while loading or after a failed load, never over a linked quotation, never a sum of nothing.
  assert.match(PANEL, /const followingLines = linesOpen && !quotationLinked && signedFollowsLines && \(linesPricing\.amount > 0 \|\| Number\(form\.initialConvertedValue\) > 0\);/);
  assert.match(PANEL, /!plan\.loading && !plan\.loadingMasterData && !plan\.sectionProps\.serviceDefinitionsError/);
  // Typing stops it; clearing the box hands it back.
  assert.match(PANEL, /onSignedQuotationChange=\{quotationLinked \? undefined : \(value\) => \{ setSignedFollowsLines\(value === ""\); update\("initialConvertedValue", value\); \}\}/);
  // What is shown is what is saved, and nothing writes it back from an effect.
  assert.match(PANEL, /signedQuotation=\{signedQuotation\}/);
  assert.match(PANEL, /const form = \{ \.\.\.formState, initialConvertedValue: signedQuotation \};/);
  assert.doesNotMatch(PANEL, /signedTypedRef|linesAmountRef/);
  // One calculation: the generator's totals, through the shared helper.
  assert.match(PANEL, /const linesPricing = useMemo\(\(\) => projectLinesAmount\(\{/);
});
