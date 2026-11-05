const { test } = require("node:test");
const assert = require("node:assert/strict");
const { clientItems } = require("../src/modules/sales/sale-extras/totals");

/*
 * The client's EXTRA section: each item once, where it stands now - added (or changed) or removed - in
 * the order they happened. An extra added and later removed is under Removed only, and put back again
 * under Added only. No amount, no correction, and a change said in the studio's words.
 */

const day = (date) => new Date(`2026-11-0${date}T10:00:00Z`);

test("published lines split into added and removed, dated, unpriced", () => {
  const lines = [
    { extraId: "a", kind: "ADDED", category: "SERVICE", itemName: "360 Video Booth (Full Session)", shootName: "Bride Haldi", amount: 2000 },
    { extraId: "b", kind: "REMOVED", category: "SERVICE", itemName: "360 Video Booth (Half Session)", shootName: "Bride Haldi", amount: -1500 },
    { extraId: "c", kind: "REMOVED", category: "SERVICE", itemName: "360 Video Booth (Full Session)", shootName: "Bride Haldi", amount: -2000 },
    { extraId: "d", kind: "MODIFIED", category: "DELIVERABLE", itemName: "Album 01 · A4", shootName: "Wedding", amount: 500 },
    { extraId: "e", kind: "ADDED", category: "SHOOT", itemName: "Reception", shootName: "Reception", amount: 15000, included: [
      { extraId: "f", kind: "ADDED", category: "SERVICE", itemName: "Candid Video", shootName: "Reception" },
    ] },
    { extraId: "g", kind: "CORRECTION", category: "SERVICE", itemName: "360 Video Booth (Full Session)", amount: -100 },
  ];
  const rows = new Map([
    ["a", { changedAt: day(1), details: { after: { quantity: 1 } } }],
    ["b", { changedAt: day(2), details: { before: { quantity: 1 } } }],
    ["c", { changedAt: day(3), details: { before: { quantity: 1 } } }],
    ["d", { changedAt: day(2), details: { before: { quantity: 1, sizeOptionValueId: "x" }, after: { quantity: 2, sizeOptionValueId: "y" } } }],
    ["e", { changedAt: day(4), details: { after: {} } }],
    ["f", { changedAt: day(4), details: { after: { quantity: 3 } } }],
  ]);
  const { added, removed } = clientItems(lines, rows);
  // Grouped by shoot, the shoot first and then what is under it, each group in the order it began.
  // The Full Session booth was added (day 1) and removed (day 3): it is under Removed only.
  assert.deepEqual(added.map((item) => [item.item, item.detail]), [
    ["Album 01 · A4", "Quantity 1 → 2"],
    ["Reception", null],
    ["Candid Video", "Quantity 3"],
  ]);
  const grouped = clientItems([
    { extraId: "s1", kind: "ADDED", category: "SERVICE", itemName: "Drone", shootName: "Reception" },
    { extraId: "h1", kind: "ADDED", category: "SERVICE", itemName: "Candid", shootName: "Haldi" },
    { extraId: "r0", kind: "ADDED", category: "SHOOT", itemName: "Reception", shootName: "Reception" },
    { extraId: "d1", kind: "ADDED", category: "DELIVERABLE", itemName: "Album", shootName: "Reception" },
  ], new Map([["s1", { changedAt: day(1) }], ["h1", { changedAt: day(2) }], ["r0", { changedAt: day(3) }], ["d1", { changedAt: day(4) }]]));
  assert.deepEqual(grouped.added.map((item) => item.item), ["Reception", "Drone", "Album", "Candid"]);
  assert.deepEqual(removed.map((item) => item.item), ["360 Video Booth (Half Session)", "360 Video Booth (Full Session)"]);
  assert.deepEqual(removed[1], { item: "360 Video Booth (Full Session)", detail: "Quantity 1", category: "SERVICE", relatedShoot: "Bride Haldi", createdDate: day(3) });
  // Put back after that: under Added only, at its latest line.
  const back = clientItems([...lines, { extraId: "z", kind: "ADDED", category: "SERVICE", itemName: "360 Video Booth (Full Session)", shootName: "Bride Haldi" }], new Map([...rows, ["z", { changedAt: day(5), details: { after: { quantity: 1 } } }]]));
  assert.ok(back.added.some((item) => item.item === "360 Video Booth (Full Session)"));
  assert.ok(!back.removed.some((item) => item.item === "360 Video Booth (Full Session)"));
  assert.ok(!JSON.stringify({ added, removed }).includes("amount"));
});

test("nothing published that the client can read leaves both lists empty", () => {
  assert.deepEqual(clientItems([{ extraId: "g", kind: "CORRECTION", category: "SERVICE", itemName: "x" }]), { added: [], removed: [] });
});

test("the latest change is the one published last, even when it carries an earlier date", () => {
  // Added in R1, removed in R2, added back in R3 - the add-back dated by the row's first creation.
  const lines = [
    { extraId: "a", kind: "ADDED", category: "SERVICE", itemName: "Booth", shootName: "Haldi" },
    { extraId: "r", kind: "REMOVED", category: "SERVICE", itemName: "Booth", shootName: "Haldi" },
    { extraId: "b", kind: "ADDED", category: "SERVICE", itemName: "Booth", shootName: "Haldi" },
  ];
  const rows = new Map([
    ["a", { changedAt: day(1), createdAt: day(1), publishedRevision: { revisionNumber: 1 } }],
    ["r", { changedAt: day(3), createdAt: day(3), publishedRevision: { revisionNumber: 2 } }],
    ["b", { changedAt: day(1), createdAt: day(4), publishedRevision: { revisionNumber: 3 } }],
  ]);
  const { added, removed } = clientItems(lines, rows);
  assert.deepEqual([added.map((item) => item.item), removed.length], [["Booth"], 0]);
  assert.ok(!("order" in added[0]), "nothing internal reaches the client");
});
