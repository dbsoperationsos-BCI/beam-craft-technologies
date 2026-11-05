import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lineSessionTimingMode, pricingForSave, pricingFormLines, pricingLineDeliverables, serviceDeliverables, servicePriceForShoot, servicePricingRowForLine, servicePricingRowForShoot } from "../src/lib/servicePricing.mjs";

/*
 * A service brings its own deliverables.
 *
 * A studio that has said once that a service is sold *with* an acrylic print should not add it to
 * every quotation by hand. The list is the service's own now - brought in whenever the service is
 * added to a shoot, whatever its session - since Settings no longer splits a service into
 * per-booking pricing lines. A service saved while the mapping rode on those lines reads as every
 * variant they named. The pricing-line helpers below still stand for what those lines store.
 */

const SERVICE = {
  name: "Demo Spot Framing",
  sizeEnabled: true,
  deliverableAdded: true,
  pricing: [
    { shootType: "STUDIO", timingMode: "FULL_SESSION", duration: "8-10 Hours (Full)", size: "8x12", price: 700,
      deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v8" }] },
    { shootType: "STUDIO", timingMode: "FULL_SESSION", duration: "8-10 Hours (Full)", size: "12x18", price: 1400,
      deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v12" }, { deliverableId: "d2", brandId: "b2", variantId: "v20" }] },
  ],
};
const SHOOT = { shootTypes: ["Studio / In-House"], sessionTimings: ["Full Session"] };

test("the booking decides which deliverables follow, not the service", () => {
  const small = servicePricingRowForShoot(SERVICE, SHOOT, { size: "8x12" });
  const large = servicePricingRowForShoot(SERVICE, SHOOT, { size: "12x18" });
  assert.deepEqual(small.deliverables.map((entry) => entry.variantId), ["v8"]);
  assert.deepEqual(large.deliverables.map((entry) => entry.variantId), ["v12", "v20"]);
  // One booking may bring several; there is no limit beyond the schema's own.
  assert.equal(large.deliverables.length, 2);
});

test("a service sold by size names no booking until its size is chosen", () => {
  // Which is why the quotation can only work out what follows once the size is picked.
  assert.equal(servicePricingRowForShoot(SERVICE, SHOOT, {}), null);
  assert.equal(servicePriceForShoot(SERVICE, SHOOT, {}), null);
  assert.equal(servicePriceForShoot(SERVICE, SHOOT, { size: "12x18" }), 1400);
});

test("the price this always worked out is unchanged by being read off the row", () => {
  assert.equal(servicePriceForShoot(SERVICE, SHOOT, { size: "8x12" }), 700);
  // A booking the service is not sold as answers nothing, exactly as before.
  assert.equal(servicePriceForShoot(SERVICE, { shootTypes: ["Outdoor / On-Location"], sessionTimings: ["Full Session"] }, { size: "8x12" }), null);
  // And a line with no figure is not the one it books under.
  const unpriced = { pricing: [{ shootType: "STUDIO", timingMode: "FULL_SESSION", price: null }] };
  assert.equal(servicePriceForShoot(unpriced, SHOOT, {}), null);
});

test("a mapping is three ids, and a half-written one is never stored", () => {
  assert.deepEqual(pricingLineDeliverables({ deliverables: [
    { deliverableId: "d1", brandId: "b1", variantId: "v1" },
    { deliverableId: "d1", brandId: "b1" },
    { deliverableId: "", brandId: "b1", variantId: "v2" },
    { variantId: "v3" },
  ] }), [{ deliverableId: "d1", brandId: "b1", variantId: "v1" }]);
  assert.deepEqual(pricingLineDeliverables({}), []);
});

test("the mapping only survives a save where the service says it brings deliverables", () => {
  const lines = [{ id: "l1", shootType: "STUDIO", timingMode: "FULL_SESSION", duration: "8-10 Hours (Full)", size: "8x12", price: "700",
    deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v8" }] }];
  assert.deepEqual(pricingForSave(lines, true, true)[0].deliverables, [{ deliverableId: "d1", brandId: "b1", variantId: "v8" }]);
  // Answered No, the mapping is not stored at all rather than kept where no screen shows it.
  assert.equal("deliverables" in pricingForSave(lines, true, false)[0], false);
  // And a line carrying none does not gain an empty list.
  assert.equal("deliverables" in pricingForSave([{ ...lines[0], deliverables: [] }], true, true)[0], false);
});

test("edit preloads every mapping onto the line it belongs to", () => {
  const [first, second] = pricingFormLines(SERVICE.pricing);
  assert.deepEqual(first.deliverables, [{ deliverableId: "d1", brandId: "b1", variantId: "v8" }]);
  assert.equal(second.deliverables.length, 2);
  // A line saved before any of this existed preloads with none, rather than with undefined.
  assert.deepEqual(pricingFormLines([{ shootType: "STUDIO", timingMode: "FULL_SESSION", price: 100 }])[0].deliverables, []);
});

/*
 * The wiring, read off the source: there is no DOM in this suite.
 */
const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const DIALOG = src("components", "project-management", "ServiceDefinitionDialog.js");
const PANEL = src("components", "sales", "QuotationGeneratorPanel.js");

/*
 * The Services table says whether a service brings deliverables, and Remarks is a note.
 */
const SETTINGS = src("components", "project-management", "ProjectSettingsPanel.js");

test("the Services table reads in the dialog's own order, with Deliverable Added on it", () => {
  const start = SETTINGS.indexOf("const serviceColumns = useMemo(() => [");
  assert.ok(start > -1, "serviceColumns is not declared");
  const ids = [...SETTINGS.slice(start, SETTINGS.indexOf("], [", start)).matchAll(/\{ id: "([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["name", "price", "deliverableAdded", "complimentary", "remarks"]);
  assert.match(SETTINGS, /deliverableAdded: row\.deliverableAdded === true \? "Yes" : "No",/);
});

test("the deliverable picker is typed at, not scrolled through", () => {
  /*
   * It offers every deliverable the studio has configured, each named the way the Quotation
   * Generator names it - "Demo Album Designing - Studio Press - 16x24". A dozen of those differ
   * only in the last few words of a long line, so finding one by eye means reading the same prefix
   * over and over. `searchable` on the shared `Dropdown` is what this already had an answer for.
   */
  const start = DIALOG.indexOf('ariaLabel="Add a deliverable to this service"');
  assert.ok(start > -1, "the deliverable picker is no longer labelled the way this test finds it");
  const picker = DIALOG.slice(DIALOG.lastIndexOf("<Dropdown", start), start);
  assert.match(picker, /\bsearchable\b/, "the deliverable picker cannot be typed at");
  // `searchable` only draws the filter box on an input-mode dropdown; on a button trigger it does
  // nothing at all, so the two belong together.
  assert.match(picker, /mode="input"/);
});

test("one list per service; a service saved per booking reads as every variant its lines named", () => {
  const entry = (variantId) => ({ deliverableId: "d1", brandId: "b1", variantId });
  // The service's own list wins, whatever its pricing lines still carry.
  assert.deepEqual(serviceDeliverables({ deliverables: [entry("v1")], pricing: [{ deliverables: [entry("v9")] }] }), [entry("v1")]);
  // An empty list is an answer: the service brings nothing.
  assert.deepEqual(serviceDeliverables({ deliverables: [], pricing: [{ deliverables: [entry("v9")] }] }), []);
  // Never saved with a list: every variant its lines named, each once.
  assert.deepEqual(serviceDeliverables(SERVICE).map((item) => item.variantId), ["v8", "v12", "v20"]);
  assert.deepEqual(serviceDeliverables({ pricing: [{ deliverables: [entry("v1")] }, { deliverables: [entry("v1"), { variantId: "half" }] }] }), [entry("v1")]);
  assert.deepEqual(serviceDeliverables(null), []);
});

test("a service's Remarks is a note, written rather than chosen", () => {
  assert.match(DIALOG, /<TextAreaField\s*\n\s*label="Remarks"/);
  assert.doesNotMatch(DIALOG, /<Dropdown\s*\n\s*label="Remarks"/);
  assert.match(DIALOG, /remarksEnabled: form\.remarksEnabled\.trim\(\) \|\| null,/);
  assert.match(SETTINGS, /remarks: deliverableAnswerText\(row\.remarksEnabled\) \|\| "—",/);
});

test("a project's service line always keeps its remarks box", () => {
  const section = src("components", "project-management", "ProjectServiceCreationSection.js");
  assert.match(section, /function remarksEnabled\(\) \{\n\s*return true;\n\}/);
});

test("the service dialog asks the question beside Remarks and Size", () => {
  assert.match(DIALOG, /<Dropdown\s*\n\s*label="Deliverable Added"/);
  assert.match(DIALOG, /deliverableAdded: String\(source\?\.deliverableAdded === true\)/);
  assert.match(DIALOG, /deliverableAdded: bringsDeliverables,/);
  // The list appears only once the service says it brings any, and is sent only then.
  assert.match(DIALOG, /\{bringsDeliverables && <fieldset /);
  assert.match(DIALOG, /deliverables: bringsDeliverables \? form\.deliverables : \[\],/);
});

test("a service cannot be given the same variant twice", () => {
  assert.match(DIALOG, /const held = new Set\(form\.deliverables\.map\(pricingDeliverableKey\)\);/);
  assert.match(DIALOG, /const addableOptions = deliverableOptions\.filter\(\(option\) => !held\.has\(/);
});

/*
 * Which booking decides, and when.
 *
 * `servicePricingRowForShoot` answers from the *shoot's* sessions, so a shoot offering both Half
 * and Full answers with whichever the service is priced for first - before anybody has said which
 * session the line is. Right for a price, which is only a starting figure; wrong for what the
 * booking brings, because that adds the wrong deliverables the instant the service is chosen and
 * then never follows the Session Timing cell.
 */
test("nothing follows a service in until its Session Timing is chosen", () => {
  const SERVICE = {
    timingOptionSet: { values: [{ id: "half", code: "HALF_SESSION" }, { id: "full", code: "FULL_SESSION" }] },
    pricing: [
      { shootType: "STUDIO", timingMode: "HALF_SESSION", price: 7000, deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v1" }, { deliverableId: "d2", brandId: "b2", variantId: "v2" }] },
      { shootType: "STUDIO", timingMode: "FULL_SESSION", price: 12000, deliverables: [{ deliverableId: "d3", brandId: "b3", variantId: "v3" }] },
    ],
  };
  const shoot = { shootTypes: ["Studio / In-House"], sessionTimings: ["Half Session", "Full Session"] };

  // Added, nothing chosen: the price still stamps, and nothing follows it in.
  assert.equal(servicePricingRowForLine(SERVICE, shoot, {}), null);
  assert.equal(servicePriceForShoot(SERVICE, shoot, {}), 7000, "the price is unchanged by any of this");

  // Chosen: that row, and every deliverable on it.
  const half = servicePricingRowForLine(SERVICE, shoot, { sessionOptionId: "half" });
  assert.equal(half.price, 7000);
  assert.deepEqual(half.deliverables.map((entry) => entry.variantId), ["v1", "v2"], "all of them, not the first");

  // Changed: the other row's, and only its.
  const full = servicePricingRowForLine(SERVICE, shoot, { sessionOptionId: "full" });
  assert.equal(full.price, 12000);
  assert.deepEqual(full.deliverables.map((entry) => entry.variantId), ["v3"]);
});

test("a service priced under no session has no timing to wait for", () => {
  // Hourly or one flat figure: there is no Session Timing cell to answer, so it resolves as ever.
  const hourly = { pricing: [{ shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: 4, price: 5000, deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v1" }] }] };
  // "Hourly" is the label the studio's own timing set uses for it - see `TIMING_MODE_BY_LABEL`.
  const shoot = { shootTypes: ["Studio / In-House"], sessionTimings: ["Hourly"], sessionDurationHours: 4 };
  assert.equal(servicePricingRowForLine(hourly, shoot, {})?.price, 5000);
});

test("the line's session is read off the option it names", () => {
  const definition = { timingOptionSet: { values: [{ id: "half", code: "HALF_SESSION" }] } };
  assert.equal(lineSessionTimingMode(definition, { sessionOptionId: "half" }), "HALF_SESSION");
  assert.equal(lineSessionTimingMode(definition, {}), null);
  assert.equal(lineSessionTimingMode(definition, { sessionOptionId: "gone" }), null);
});

test("the quotation takes what the service brings, whatever its session", () => {
  assert.match(PANEL, /if \(definition\?\.deliverableAdded !== true\) continue;/);
  assert.match(PANEL, /for \(const entry of serviceDeliverables\(definition\)\) \{/);
  // No pricing line decides it any more.
  assert.doesNotMatch(PANEL, /servicePricingRowForShoot\(|servicePricingRowForLine\(/);
  // Through the same call a hand-picked variant makes, so both produce the same row.
  assert.match(PANEL, /rows\.push\(deliverableRowFor\(shoot, deliverable, \{/);
  // And it says where it came from, so a saved quotation names the booking that brought it.
  assert.match(PANEL, /autoFromService: service\.id,/);
  assert.match(PANEL, /autoSourceType: "SERVICE_PRICING",/);
  assert.match(PANEL, /autoServiceDefinitionId: definition\.id,/);
});

test("the sync is handed the services as they will be, not as they were", () => {
  /*
   * `setServices(fn)` does not run `fn` there and then - React runs it at the next render - so a
   * handler that set state through an updater and then read `serviceRowsRef.current` read the list
   * as it *was*. `addAutoDeliverables` would then have re-synced against the previous Session
   * Timing, and a booking's deliverables would have lagged one change behind every time.
   *
   * Every handler that syncs works the next list out first, assigns the ref, sets that value, and
   * hands the same list on - which is what `addService` has always done.
   */
  for (const handler of ["updateService", "deleteService", "clearServices"]) {
    const start = PANEL.indexOf(`async function ${handler}(`);
    assert.ok(start > -1, `${handler} is not declared`);
    const body = PANEL.slice(start, PANEL.indexOf("\n  }", start));
    assert.match(body, /serviceRowsRef\.current = next;\n\s*setServices\(next\);/, `${handler} does not set the list it just worked out`);
    assert.match(body, /addAutoDeliverables\(shoot, next\)/, `${handler} does not hand that list to the sync`);
    assert.doesNotMatch(body, /setServices\(\(current\)/, `${handler} sets state through an updater and then reads a ref that is still stale`);
    assert.doesNotMatch(body, /addAutoDeliverables\(shoot, serviceRowsRef\.current\)/, `${handler} syncs against the list as it was`);
  }
});

test("an automatic row is removable again, and a manual one is never touched", () => {
  assert.match(PANEL, /if \(row\.shootId === shoot\.id && row\.autoFromService\) return mappedIds\.has\(row\.id\);/);
  assert.match(PANEL, /return true;/);
  /*
   * Re-run when a service is added, when a package is applied, when a booking is chosen, when a
   * service goes, and when several go at once. Counting the call sites would only pin today's
   * number; what has to hold is that every one of them is handed the list it just worked out, and
   * none of them a ref React may not have written yet.
   */
  // The declaration names its own parameter, so only call sites count.
  const calls = [...PANEL.matchAll(/(?<!function )addAutoDeliverables\(shoot, ([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(calls.length >= 5, `only ${calls.length} sync call sites`);
  assert.deepEqual([...new Set(calls)], ["next"], "a sync was handed something other than the list just worked out");
});

test("a row already on the shoot is not added a second time", () => {
  assert.match(PANEL, /const heldIds = new Set\(nextRows\.map\(\(row\) => row\.id\)\);/);
  assert.match(PANEL, /mapped\.forEach\(\(row\) => \{ if \(!heldIds\.has\(row\.id\)\) \{ heldIds\.add\(row\.id\); nextRows\.push\(row\); \} \}\);/);
});

test("a brand's own deliverable list still carries its brands and variants", () => {
  /*
   * The brand configuration hands the generator the definitions it offers. Its include left out
   * `brands`, so a brand that configured its own deliverable list would have handed over
   * definitions with no brands at all: the picker would list each deliverable once under its bare
   * name instead of one entry per variant, and a variant mapped onto a service's pricing row could
   * never be resolved, so nothing would follow that service in. Invisible until the first brand
   * configured a list, because a brand that configures nothing is answered with the catalogue.
   */
  const brandService = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "sales", "quotation-brands", "service.js"), "utf8");
  const start = brandService.indexOf("const deliverableDefinitionInclude = {");
  const block = brandService.slice(start, brandService.indexOf("\n};", start));
  assert.match(block, /brands: \{/);
  assert.match(block, /include: \{ variants: \{ orderBy/);
});

test("a mapping whose variant has since gone quietly brings nothing", () => {
  assert.match(PANEL, /if \(!deliverable \|\| !brand \|\| !variant\) continue;/);
});

test("the quotation offers every service on every shoot, and starts a new line on the shoot's session", () => {
  const panel = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
  const section = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", "ProjectServiceCreationSection.js"), "utf8");
  // One rule in the shared section, so no screen can narrow services by shoot type again: Choose
  // Services lists the whole catalogue, and only Choose Deliverables follows the shoot's type.
  assert.match(section, /options=\{serviceDefinitions\}/);
  assert.match(section, /emptyMessage="No services available"/);
  assert.doesNotMatch(section, /servicesFollowShootType|servicesForShootType|for this shoot type/);
  assert.doesNotMatch(panel, /servicesFollowShootType/);
  assert.match(section, /deliverableVariantOptions\(deliverablesForShootType\(deliverableDefinitions, shoot\)/);
  // The starting session is set once, where the row is made, before a package's or the
  // calculator's own choice - never by an effect that could put it back over the person's.
  // The whole function, however long its comments grow.
  const rowFor = panel.slice(panel.indexOf("function serviceRowFor("), panel.indexOf("\n  }\n", panel.indexOf("function serviceRowFor(")));
  assert.match(rowFor, /const sessionOptionId = defaultSessionOptionId\(definition, shoot\);/);
  assert.ok(rowFor.indexOf("...(sessionOptionId ? { sessionOptionId } : {}),") < rowFor.indexOf("...extra,"));
  // Set where the row is made; the only other reading is a shoot being edited, which moves a line
  // still on its shoot's own session to the shoot's new one - never one changed by hand.
  assert.equal((panel.match(/defaultSessionOptionId\(/g) || []).length, 3);
  assert.match(panel, /const followed = \(row\.sessionOptionId \|\| ""\) === \(defaultSessionOptionId\(definition, before\) \|\| ""\);/);
  // The dropdown lists from the same helper the default is chosen from.
  assert.match(section, /const sessionOptions = serviceSessionOptions\(serviceDefinition\(row\)\);/);
});

test("Create Project and Edit Sale Details offer the quotation's services and start a line on the shoot's session", () => {
  const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", ...parts), "utf8");
  const create = read("sales", "CreateProjectFormPanel.js");
  const plan = read("project-management", "useProjectPlan.js");
  // The same catalogue the Quotation Generator reads, through the same service call.
  for (const source of [create, plan, read("sales", "QuotationGeneratorPanel.js")]) assert.match(source, /getProjectServiceDefinitions\(\)/);
  // Creating: the pending line carries the quotation's starting session, which the create payload sends.
  // The pending lines live in the shared hook Create Project (and Raise Request) hold them in.
  const lines = read("project-management", "usePendingShootLines.js");
  assert.match(create, /usePendingShootLines\(\{ serviceDefinitions, deliverableDefinitions \}\)/);
  assert.match(create, /onAddService=\{shootsFromQuotation \? undefined : pendingLines\.addService\}/);
  const pending = lines.slice(lines.indexOf("const addService = useCallback("), lines.indexOf("const addService = useCallback(") + 900);
  assert.match(pending, /const sessionOptionId = defaultSessionOptionId\(definition, shoot\);/);
  assert.match(pending, /\.\.\.\(sessionOptionId \? \{ sessionOptionId \} : \{\}\),/);
  assert.match(lines, /sessionOptionId: sessionOptionId \|\| null,/);
  assert.match(create, /services: \(servicesByShoot\[id\] \|\| \[\]\)\.map\(servicePayload\),/);
  // Editing: the new allocation is created with it, and the server validates it against the service.
  const add = plan.slice(plan.indexOf("async function addService("), plan.indexOf("async function addService(") + 900);
  assert.match(add, /const sessionOptionId = defaultSessionOptionId\(definition, shoot\);/);
  assert.match(add, /createProjectServiceAllocation\(projectId, shoot\.id, \{ serviceDefinitionId: definition\.id, \.\.\.\(sessionOptionId \? \{ sessionOptionId \} : \{\}\) \}\)/);
});

test("the Quotation Summary starts a new quotation at 0%, adds a Performance Cost, and takes up to three extra discounts", () => {
  const panel = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
  // An edit reopens on the exact percentage in its payload, the column only for older payloads.
  assert.match(panel, /savedDiscountOf\(initialPayload, initialQuotation \? finite\(initialPayload\.discount\) \?\? Number\(initialQuotation\.discount \|\| 0\) : draftDiscount \?\? 0\)/);
  assert.ok(!/setDiscount\(Number\((response\.data|config\.brand)\.defaultDiscountPercent/.test(panel), "the Default Discount setting no longer pre-fills a quotation");
  assert.match(panel, /aria-label="Discount amount in rupees"[^>]*prefix="₹"/, "the rupees are typed into too, beside the percentage");
  // Order on screen: Service Cost, Performance Cost, Discount, Extra Discounts, Total.
  const order = ["<span>Service Cost :</span>", ">Performance Cost +</Button>", /<span>Discount(?:<HelpTip text="[^"]*" \/>)?<\/span>/, ">Extra Discount +</Button>", "<span>Total Cost :</span>"].map((text) => (typeof text === "string" ? panel.indexOf(text) : panel.search(text)));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(panel, /current\.length >= MAX_EXTRA_DISCOUNTS \? current : \[\.\.\.current, \{ id, reason: "", amount: "" \}\]/);
  assert.match(panel, /\{extraDiscounts\.length < MAX_EXTRA_DISCOUNTS && <IconButton label="Add extra discount"/);
  // One heading and the column names once; each row's × takes only that row.
  assert.ok(!/Extra Discount \{index|>Remove<\/Button>/.test(panel), "no numbered titles and no Remove text");
  assert.equal((panel.match(/<span>Reason<\/span>/g) || []).length, 1);
  assert.match(panel, /<IconButton label="Remove extra discount"[^>]*onClick=\{\(\) => removeExtraDiscount\(entry\.id\)\}>/);
  assert.match(panel, /<IconButton label="Remove performance cost"[^>]*onClick=\{removePerformanceCost\}>/);
  assert.match(panel, /performanceCost: totals\.performanceCost,/);
  assert.match(panel, /extraDiscounts: extraDiscounts\.map\(\(entry\) => \(\{ reason: entry\.reason\.trim\(\), amount:/);
  assert.match(panel, /if \(extraDiscountError\) return `/, "too much is refused, not saved");
  assert.match(panel, /if \(discountError\) return `/, "a discount in rupees above the cost is refused, not saved");
});

test("a quotation saved with one extra discount opens with it as the first of the list", () => {
  const panel = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
  // The editor opens from the same reading the client's copy prints from.
  assert.match(panel, /return extraDiscountsOf\(payload\)\.map\(\(entry, index\) => \(\{ id: `saved-\$\{index\}`/);
});
