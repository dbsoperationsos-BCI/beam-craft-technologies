import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_SUMMARY_CARDS, DASHBOARD_ROUTE, EVENTS_ROUTE, PROCESSING_EMPTY, createEventHref, eventHref, rowMatchesView, rowsForView, sameView, viewLabel,
} from "../src/lib/aiDashboard.mjs";
import { SIDEBAR_MODULES } from "../src/constants/navigation.mjs";
import { permissionForRoute } from "../src/constants/modulePermissions.js";

const rows = [
  { id: "a", status: "ACTIVE", processingCount: 2, failedCount: 0 },
  { id: "b", status: "COMPLETED", processingCount: 0, failedCount: 1 },
  { id: "c", status: "ARCHIVED", processingCount: 0, failedCount: 0 },
  { id: "d", status: "UPCOMING", processingCount: 0, failedCount: 0 },
];

test("ten cards, each over a figure the dashboard answers, events first and then the photos", () => {
  assert.deepEqual(AI_SUMMARY_CARDS.map((card) => card.key), [
    "totalEvents", "activeEvents", "upcomingEvents", "completedEvents", "processingPhotos",
    "totalPhotos", "processedPhotos", "failedPhotos", "peopleDetected", "archivedEvents",
  ]);
  assert.deepEqual(AI_SUMMARY_CARDS.map((card) => card.label), [
    "Total Events", "Active Events", "Upcoming Events", "Completed Events", "Processing",
    "Total Photos", "Processed Photos", "Failed", "People Detected", "Archived Events",
  ]);
  assert.equal(AI_SUMMARY_CARDS[0].view, null);
  assert.deepEqual(AI_SUMMARY_CARDS[1].view, { status: "ACTIVE" });
  assert.deepEqual(AI_SUMMARY_CARDS[4].view, { attention: "processing" });
  assert.deepEqual(AI_SUMMARY_CARDS[7].view, { attention: "failed" });
  assert.deepEqual(AI_SUMMARY_CARDS[8].unit, ["Person", "People"]);
  // The three figures counted across every event narrow no table of events: figures to read, not filters.
  assert.deepEqual(AI_SUMMARY_CARDS.filter((card) => card.static).map((card) => card.key), ["totalPhotos", "processedPhotos", "peopleDetected"]);
  assert.ok(AI_SUMMARY_CARDS.filter((card) => !card.static && card.view === null).length === 1, "only Total Events is the table unfiltered");
});

test("a card narrows the Recent Events table to the events it counted", () => {
  assert.deepEqual(rowsForView(rows, null).map((row) => row.id), ["a", "b", "c", "d"]);
  assert.deepEqual(rowsForView(rows, { status: "ARCHIVED" }).map((row) => row.id), ["c"]);
  assert.deepEqual(rowsForView(rows, { attention: "processing" }).map((row) => row.id), ["a"]);
  assert.deepEqual(rowsForView(rows, { attention: "failed" }).map((row) => row.id), ["b"]);
  assert.equal(rowMatchesView(rows[3], { status: "UPCOMING" }), true);
});

test("views compare by what they mean, and a view has the words of its card", () => {
  assert.equal(sameView(null, undefined), true);
  assert.equal(sameView({ status: "ACTIVE" }, { status: "ACTIVE" }), true);
  assert.equal(sameView({ status: "ACTIVE" }, { attention: "processing" }), false);
  assert.equal(viewLabel(null), "All events");
  assert.equal(viewLabel({ status: "ARCHIVED" }), "Archived Events");
  // The card counts photos; the table it narrows holds events, and the chip says which.
  assert.equal(viewLabel({ attention: "failed" }), "Events with failed photos");
  assert.equal(viewLabel({ attention: "processing" }), "Events with photos processing");
});

test("where a row and the create action go", () => {
  assert.equal(DASHBOARD_ROUTE, "/visual-curation/ai/overview");
  assert.equal(EVENTS_ROUTE, "/visual-curation/ai/events");
  assert.equal(eventHref("ev 1"), "/visual-curation/ai/events/ev%201");
  assert.equal(createEventHref(), "/visual-curation/ai/events?create=1");
  assert.equal(PROCESSING_EMPTY, "No AI processing currently running.");
});

test("the dashboard is the sidebar's landing for the AI Feature, under the AI Feature permission", () => {
  const entry = SIDEBAR_MODULES.flatMap((section) => section.items).find((item) => item.id === "ai-feature");
  assert.equal(entry.href, DASHBOARD_ROUTE);
  assert.deepEqual(permissionForRoute(DASHBOARD_ROUTE), { module: "IMAGE_SELECTION", feature: "AI Feature" });
});
