import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { eventCount, eventTypeNames, mainEventTypeSummary, remainingEvents } from "../src/lib/quotationEventTypes.mjs";

/*
 * The Event Type box on the client's quotation reads as the Main Event's type and how many other
 * events the quotation has - "Wedding +2 events" - never a list.
 */

const shoot = (name, isMainEvent = false) => ({ shoot: name, isMainEvent });
const summary = (shoots) => mainEventTypeSummary(eventTypeNames(shoots), eventCount(shoots));

test("one event is its own name; more add the count of the others", () => {
  assert.equal(summary([shoot("Wedding", true)]), "Wedding");
  assert.equal(summary([shoot("Wedding", true), shoot("Reception")]), "Wedding +1 event");
  assert.equal(summary([shoot("Wedding", true), shoot("Reception"), shoot("Engagement")]), "Wedding +2 events");
  assert.equal(summary([shoot("Wedding", true), shoot("Reception"), shoot("Engagement"), shoot("Mehendi")]), "Wedding +3 events");
  assert.equal(summary([shoot("Wedding", true), shoot("Reception"), shoot("Engagement"), shoot("Mehendi"), shoot("Haldi")]), "Wedding +4 events");
  const eleven = [shoot("Wedding", true), ...Array.from({ length: 10 }, (_, i) => shoot(`Event ${i}`))];
  assert.equal(summary(eleven), "Wedding +10 events");
});

test("the Main Event is named first wherever it sits, and is never counted itself", () => {
  assert.equal(summary([shoot("Reception"), shoot("Wedding", true), shoot("Engagement")]), "Wedding +2 events");
  assert.equal(summary([shoot("Engagement"), shoot("Reception"), shoot("Wedding", true)]), "Wedding +2 events");
  assert.deepEqual(eventTypeNames([shoot("Engagement"), shoot("Mehendi"), shoot("Wedding", true), shoot("Reception")]), ["Wedding", "Engagement", "Mehendi", "Reception"]);
});

test("each event is counted, a type repeated included", () => {
  assert.deepEqual(eventTypeNames([shoot("Wedding", true), shoot("Wedding"), shoot(" wedding "), shoot("Reception")]), ["Wedding", "Reception"]);
  // Bride Haldi twice and Bride Making: three events, so two besides the one named.
  assert.equal(summary([shoot("Bride Haldi", true), shoot("Bride Haldi"), shoot("Bride Making")]), "Bride Haldi +2 events");
  // Every event the same type: one name, the others counted.
  assert.equal(summary([shoot("Wedding"), shoot("Wedding"), shoot("Wedding")]), "Wedding +2 events");
  assert.equal(remainingEvents(["A", "B"], 1, 0), 1, "never below what the names stand for");
});

test("an older quotation with no Main Event starts with its first event; blanks are skipped", () => {
  assert.equal(summary([shoot("Engagement"), shoot("Wedding"), shoot("")]), "Engagement +1 event");
  assert.deepEqual(eventTypeNames(undefined), []);
  assert.equal(mainEventTypeSummary([]), "");
});

test("every card value is set in the one type the Client Name uses, and the Event Type is the summary", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "PublicQuotationPage.js"), "utf8");
  // One value style, no mono or italic variant left for a cell to ask for.
  assert.match(page, /function DetailCell\(\{ label, value \}\) \{/);
  assert.match(page, /<p className="mt-1 break-words text-\[14px\] font-semibold text-white">\{value\}<\/p>/);
  assert.doesNotMatch(page, /mono: true|italic: true|mono=\{|EventTypeLine/);
  // The label keeps its own small caps.
  assert.match(page, /<p className="q-label text-\[10px\] font-medium" style=\{\{ color: "#8f9bb0" \}\}>\{label\}<\/p>/);
  assert.match(page, /const eventType = eventTypes\.length \? mainEventTypeSummary\(eventTypes, eventCount\(shoots\)\) : payload\.offerType \|\| "";/);
  assert.match(page, /\["Event Type", eventType\],/);
});
