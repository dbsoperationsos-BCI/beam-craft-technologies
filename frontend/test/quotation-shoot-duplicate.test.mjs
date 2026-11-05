import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copyShootLines, numberQuoteShoots, reorderLines } from "../src/lib/quotationLineOrder.mjs";
import { duplicateShootValues } from "../src/lib/shootDuplicate.mjs";

/*
 * The Quotation Generator's Shoot List ⋮ reads Edit, Duplicate, Delete. Duplicate opens the shoot
 * dialog filled from the shoot with Shoot left to choose (`test/shoot-duplicate.test.mjs`); Save
 * adds a new shoot on the same quotation - every value the dialog holds, its own key and its own
 * Shoot ID, the original's lines copied under it - and Edit and Delete are what they were.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", ...parts), "utf8");
const LIST = read("project-management", "ProjectShootList.js");
const SECTION = read("project-management", "ProjectServiceCreationSection.js");
const PANEL = read("sales", "QuotationGeneratorPanel.js");

test("the ⋮ reads Edit, Duplicate, Delete - Duplicate only where the screen can make one", () => {
  // Move up / Move down sit before Delete, on the phone cards only (they have no grip to drag).
  assert.match(LIST, /\{ label: "Edit", onSelect: \(\) => onEdit\(shoot, index\) \},\n\s*\.\.\.\(onDuplicate \? \[\{ label: "Duplicate", onSelect: \(\) => onDuplicate\(shoot, index\) \}\] : \[\]\),\n\s*\.\.\.\(onMove && count > 1 \? \[[\s\S]*?\] : \[\]\),\n\s*\{ label: "Delete", tone: "danger", onSelect: \(\) => onDelete\(shoot, index\) \},/);
  // The menu itself is the one it was: same component, same layer.
  assert.match(LIST, /\]\} menuZIndexClassName="z-\[140\]" \/><\/div>;/);
  // Both the table and the phone's cards carry it.
  assert.equal((LIST.match(/onDuplicate=\{onRequestDuplicate\}/g) || []).length, 2);
  assert.match(SECTION, /onRequestDuplicate=\{onDuplicateShoot\}/);
  // The Quotation Generator is the screen that makes one; Edit and Delete are wired as before.
  assert.match(PANEL, /onDeleteShoot: deleteShoot,\n\s*onRequestEditShoot: \(shoot, index\) => \{ setEditingShoot\(\{ shoot, index \}\); setShootDialogOpen\(true\); \},\n\s*onDuplicateShoot: duplicateShoot,/);
  // The project screens make one too, through the shoot dialog (`test/shoot-duplicate.test.mjs`).
  for (const host of [["sales", "CreateProjectFormPanel.js"], ["project-management", "useProjectPlan.js"]]) {
    assert.match(read(...host), /onDuplicateShoot/, `${host.join("/")} offers Duplicate`);
  }
});

/* The panel's own functions, lifted out and run against stand-ins - the real code, not a copy. */
function generator(initial, lines = { services: [], deliverables: [] }) {
  const take = (name) => PANEL.match(new RegExp(`  function ${name}\\([\\s\\S]*?\\n  \\}\\n`))[0];
  let shoots = initial;
  const undos = [];
  const repriced = [];
  const setShoots = (next) => { shoots = typeof next === "function" ? next(shoots) : next; };
  const showUndo = (message, undo) => undos.push({ message, undo });
  const shootDisplayName = (shoot, fallback) => shoot?.shoot || fallback;
  // Repricing is the panel's own, pinned by its own tests; here it only records what it was asked.
  const repriceShootLines = (before, after) => repriced.push([before, after]);
  // The panel's two line lists, held as it holds them: a ref the code reads, and a setter.
  const serviceRowsRef = { current: lines.services };
  const deliverableRowsRef = { current: lines.deliverables };
  const setServices = (next) => { serviceRowsRef.current = next; };
  const setDeliverables = (next) => { deliverableRowsRef.current = next; };
  const api = new Function("getShoots", "setShoots", "showUndo", "shootDisplayName", "repriceShootLines", "serviceRowsRef", "deliverableRowsRef", "setServices", "setDeliverables", "copyShootLines", "reorderLines", "numberQuoteShoots",
    `${take("withQuoteShootIds")}
     function addDuplicatedShoots(source, rows) { const shoots = getShoots(); ${take("addDuplicatedShoots").replace(/^  function addDuplicatedShoots\(source, rows\) \{/, "").replace(/\}\n$/, "")} }
     ${take("reorderServices")}
     ${take("reorderDeliverables")}
     return { withQuoteShootIds, addDuplicatedShoots, reorderServices, reorderDeliverables };`)(() => shoots, setShoots, showUndo, shootDisplayName, repriceShootLines, serviceRowsRef, deliverableRowsRef, setServices, setDeliverables, copyShootLines, reorderLines, numberQuoteShoots);
  // What the dialog hands Save for a Duplicate: the source's values, the Shoot the person chose.
  const duplicate = (source, shoot = source.shoot) => api.addDuplicatedShoots(source, [{ ...duplicateShootValues(source), shoot }]);
  return { ...api, duplicate, get: () => shoots, services: () => serviceRowsRef.current, deliverables: () => deliverableRowsRef.current, undos, repriced };
}

const shoot = (n, extra = {}) => ({ id: `quote-shoot-${n}`, shootId: `Q-SID-${String(n).padStart(4, "0")}`, shoot: "Wedding", shootTypes: ["Outdoor / On-Location"], dateCreated: "2026-11-01", shootPlace: "Erode", district: "Erode", state: "Tamil Nadu", sessionTimings: ["Full Session"], sessionDurationHours: 12, sessionDurationMinutes: 0, foodTakenCareBy: "Studio", accommodation: "Client", travel: "Studio", preference: "Both", isMainEvent: false, ...extra });

test("a duplicate is its own shoot on the same quotation: every value kept, a new key and Shoot ID", () => {
  const original = shoot(1, { shoot: "Bride Haldi" });
  const g = generator([original, shoot(2, { shoot: "Wedding", isMainEvent: true })]);
  g.duplicate(original, "Bride Making");
  const [first, second, copy] = g.get();
  assert.equal(first, original, "the original is the same object, untouched");
  assert.equal(second.isMainEvent, true);
  assert.equal(copy.shootId, "Q-SID-0003");
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.shoot, "Bride Making", "the Shoot the person chose");
  const { id, shootId, shoot: _shoot, ...copied } = copy;
  const { id: _id, shootId: _shootId, shoot: _original, ...kept } = original;
  assert.deepEqual(copied, kept, "every other value copied as it was");
  assert.notEqual(copy.shootTypes, original.shootTypes, "nothing shared between them");
  assert.equal(g.undos[0].message, "Bride Haldi duplicated as Q-SID-0003.");
  // Lines follow whatever was changed on the form, exactly as an Edit's would.
  assert.deepEqual(g.repriced, [[original, copy]]);
});

test("a copy of the Main Event is not the Main Event: the mark stays on the original", () => {
  const main = shoot(1, { isMainEvent: true });
  const g = generator([main]);
  g.duplicate(main);
  assert.deepEqual(g.get().map((row) => row.isMainEvent), [true, false]);
});

test("a copy switched to Main Event on the form takes the mark off the original, as an Edit does", () => {
  const main = shoot(1, { isMainEvent: true });
  const g = generator([main, shoot(2)]);
  g.addDuplicatedShoots(main, [{ ...duplicateShootValues(main), shoot: "Reception", isMainEvent: true }]);
  assert.deepEqual(g.get().map((row) => row.isMainEvent), [false, false, true], "one Main Event, the copy");
  assert.deepEqual(main, shoot(1, { isMainEvent: true }), "the original object is not written to");
  assert.match(PANEL, /const unmark = copies\.some\(\(copy\) => copy\.isMainEvent\);/);
});

test("Undo takes the copy back out and leaves the rest as they were", () => {
  const rows = [shoot(1), shoot(2)];
  const g = generator(rows);
  g.duplicate(rows[1]);
  assert.equal(g.get().length, 3);
  g.undos[0].undo();
  assert.deepEqual(g.get(), rows);
});

test("several shoots chosen for the copy each become a shoot of their own, and Undo takes them all", () => {
  const original = shoot(1, { shoot: "Bride Haldi" });
  const g = generator([original], { services: [{ id: "quote-service-quote-shoot-1-s1", shootId: original.id, quantity: 1 }], deliverables: [] });
  g.addDuplicatedShoots(original, [{ ...duplicateShootValues(original), shoot: "Mehendi" }, { ...duplicateShootValues(original), shoot: "Sangeet" }]);
  assert.deepEqual(g.get().map((row) => [row.shoot, row.shootId]), [["Bride Haldi", "Q-SID-0001"], ["Mehendi", "Q-SID-0002"], ["Sangeet", "Q-SID-0003"]]);
  assert.equal(g.services().length, 3, "each copy takes its own copy of the lines");
  assert.equal(g.undos[0].message, "Bride Haldi duplicated as Q-SID-0002, Q-SID-0003.");
  g.undos[0].undo();
  assert.deepEqual(g.get(), [original]);
  assert.equal(g.services().length, 1);
});

test("a new Shoot ID is never one the list still holds - after a delete, or a duplicate", () => {
  const g = generator([]);
  // Nothing deleted: the number every shoot has always been given, the list's length plus one.
  assert.deepEqual(g.withQuoteShootIds([shoot(1), shoot(2)], [{}, {}]).map((row) => row.shootId), ["Q-SID-0003", "Q-SID-0004"]);
  // Q-SID-0002 deleted from three: the old rule would have handed out Q-SID-0003 a second time.
  assert.deepEqual(g.withQuoteShootIds([shoot(1), shoot(3)], [{}]).map((row) => row.shootId), ["Q-SID-0004"]);
  // A list with no IDs yet still counts from its length.
  assert.deepEqual(g.withQuoteShootIds([{ id: "x" }], [{}]).map((row) => row.shootId), ["Q-SID-0002"]);
  // Add Shoot keys new shoots through the same helper, and the list is then numbered by position.
  assert.match(PANEL, /setShoots\(\(current\) => numberQuoteShoots\(\[\.\.\.current, \.\.\.withQuoteShootIds\(current, rows\)\]\)\);/);
});

test("a shoot that is no longer listed duplicates nothing", () => {
  // Duplicate looks the shoot up on the list before it opens the dialog.
  assert.match(PANEL, /function duplicateShoot\(shoot\) \{\n\s*const source = shoots\.find\(\(row\) => row\.id === shoot\.id\);\n\s*if \(!source\) return;/);
});

/* ── The shoot's lines go with it, and each list keeps the order it is given ─────────────────── */

const line = (id, shootId, extra = {}) => ({ id, shootId, quantity: 1, remarks: "", complimentary: false, ...extra });

test("a duplicate carries its shoot's services and deliverables, every field kept, with ids of its own", () => {
  const original = shoot(1, { shoot: "Bride Haldi" });
  const other = shoot(2);
  const services = [
    line("quote-service-quote-shoot-1-s1", original.id, { quantity: 2, remarks: "Two cameras", complimentary: true, unitPrice: 5000 }),
    line("quote-service-quote-shoot-2-s1", other.id),
  ];
  const deliverables = [
    line("quote-deliverable-quote-shoot-1-d1-v1", original.id, { numberOfPhotos: 40, size: "12x18", autoFromService: "quote-service-quote-shoot-1-s1" }),
  ];
  const g = generator([original, other], { services, deliverables });
  g.duplicate(original);
  const copy = g.get()[2];
  const copiedServices = g.services().filter((row) => row.shootId === copy.id);
  const copiedDeliverables = g.deliverables().filter((row) => row.shootId === copy.id);
  assert.equal(copiedServices.length, 1, "only that shoot's service, once");
  assert.equal(copiedDeliverables.length, 1);
  const [service] = copiedServices;
  assert.deepEqual({ quantity: service.quantity, remarks: service.remarks, complimentary: service.complimentary, unitPrice: service.unitPrice }, { quantity: 2, remarks: "Two cameras", complimentary: true, unitPrice: 5000 });
  assert.notEqual(service.id, services[0].id);
  assert.equal(new Set(g.services().map((row) => row.id)).size, g.services().length, "no two lines share an id");
  // A deliverable a service brought now belongs to that service's copy.
  assert.equal(copiedDeliverables[0].autoFromService, service.id);
  assert.equal(copiedDeliverables[0].numberOfPhotos, 40);
  // The originals are exactly as they were.
  assert.equal(g.services()[0], services[0]);
  assert.equal(g.deliverables()[0], deliverables[0]);
  // Editing the copy cannot reach the original: nothing is shared between them.
  service.remarks = "changed";
  assert.equal(services[0].remarks, "Two cameras");
  // Undo takes the copy's lines away with it.
  g.undos[0].undo();
  assert.deepEqual(g.services(), services);
  assert.deepEqual(g.deliverables(), deliverables);
});

test("one shoot's lines are put in the order given; every other shoot's stay where they were", () => {
  const rows = [line("a1", "A"), line("b1", "B"), line("a2", "A"), line("a3", "A"), line("b2", "B")];
  const next = reorderLines(rows, ["a3", "a1", "a2"]);
  assert.deepEqual(next.map((row) => row.id), ["a3", "b1", "a1", "a2", "b2"]);
  // The same rows, untouched - only the order moved - so nothing about the price changes.
  assert.equal(next[0], rows[3]);
  // An id that is not a line moves nothing, and a line the order does not name stays where it is.
  assert.deepEqual(reorderLines(rows, ["a1", "zz"]).map((row) => row.id), rows.map((row) => row.id));
});

test("services and deliverables are each reordered on their own", () => {
  const services = [line("s1", "A"), line("s2", "A")];
  const deliverables = [line("d1", "A"), line("d2", "A")];
  const g = generator([shoot(1)], { services, deliverables });
  g.reorderServices("A", ["s2", "s1"]);
  assert.deepEqual(g.services().map((row) => row.id), ["s2", "s1"]);
  assert.deepEqual(g.deliverables().map((row) => row.id), ["d1", "d2"], "deliverables untouched");
  g.reorderDeliverables("A", ["d2", "d1"]);
  assert.deepEqual(g.deliverables().map((row) => row.id), ["d2", "d1"]);
});

test("the card's ⋮ reads Edit, Duplicate, Delete, and each table has a grip to reorder by", () => {
  assert.match(SECTION, /\.\.\.\(!editing \? \[\{ label: "Edit", onSelect: onEdit \}\] : \[\]\),\n\s*\.\.\.\(onDuplicate \? \[\{ label: "Duplicate", onSelect: onDuplicate \}\] : \[\]\),\n\s*\{ label: "Delete", tone: "danger", onSelect: onDelete \},/);
  assert.match(SECTION, /onDuplicate=\{onDuplicateShoot \? \(\) => onDuplicateShoot\(shoot, shootIndex\) : undefined\}/);
  assert.match(SECTION, /servicesEditable && onReorderServices \? \[rowReorderColumn\(/);
  assert.match(SECTION, /deliverablesEditable && onReorderDeliverables \? \[rowReorderColumn\(/);
  assert.match(PANEL, /onReorderServices: reorderServices,\n\s*onReorderDeliverables: reorderDeliverables,/);
});

test("the shoots themselves can be put in order: a grip on the table, Move up / Move down on a phone", () => {
  assert.match(LIST, /\.\.\.\(reorderable \? \[rowReorderColumn\(\{[\s\S]*?idOf: shootKey,/);
  assert.match(LIST, /onMove=\{reorderable \? moveShoot : undefined\}/);
  assert.match(SECTION, /onReorder=\{onReorderShoots\}/);
  assert.match(PANEL, /onReorderShoots: reorderShoots,/);
  // The same shoots in the new order, then numbered by where they now stand.
  const rows = [shoot(1, { shoot: "Haldi" }), shoot(2, { shoot: "Mehendi" }), shoot(3, { shoot: "Wedding" })];
  const moved = numberQuoteShoots(reorderLines(rows, [rows[2].id, rows[0].id, rows[1].id]));
  assert.deepEqual(moved.map((row) => [row.shoot, row.shootId]), [["Wedding", "Q-SID-0001"], ["Haldi", "Q-SID-0002"], ["Mehendi", "Q-SID-0003"]]);
  // Its key - what its lines hang off - never changes.
  assert.equal(moved[0].id, rows[2].id);
  assert.match(PANEL, /setShoots\(\(current\) => numberQuoteShoots\(reorderLines\(current, ids\)\)\);/);
});

test("Shoot IDs follow the list: no gaps after a delete, in order after a drag", () => {
  // Q-SID-0002 and Q-SID-0005 deleted from five: what is left reads 0001, 0002, 0003.
  const left = [shoot(1), shoot(3), shoot(4)];
  const numbered = numberQuoteShoots(left);
  assert.deepEqual(numbered.map((row) => row.shootId), ["Q-SID-0001", "Q-SID-0002", "Q-SID-0003"]);
  assert.equal(numbered[0], left[0], "a shoot already holding its number is the same object");
  assert.deepEqual(numbered.map((row) => row.id), left.map((row) => row.id), "keys are untouched");
  // Every change to the list numbers it: add, duplicate, undo, reorder, delete.
  assert.match(PANEL, /setShoots\(\(current\) => numberQuoteShoots\(\[\.\.\.current, \.\.\.withQuoteShootIds\(current, rows\)\]\)\);/);
  assert.match(PANEL, /setShoots\(\(current\) => numberQuoteShoots\(current\.filter\(\(row\) => row\.id !== shoot\.id\)\)\);/);
  // A duplicate after a delete takes the next number, not one past the highest ever given.
  const g = generator([shoot(1), shoot(3)]);
  g.duplicate(g.get()[0]);
  assert.deepEqual(g.get().map((row) => row.shootId), ["Q-SID-0001", "Q-SID-0002", "Q-SID-0003"]);
  assert.equal(g.undos[0].message, "Wedding duplicated as Q-SID-0003.");
});
