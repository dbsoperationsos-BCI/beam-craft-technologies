import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { detectionRows } from "../src/lib/aiDashboard.mjs";
import { formatBytes, number, periodPhrase } from "../src/lib/dashboardRange.mjs";

const fmt = { formatBytes, number, periodPhrase, rangeKey: "month" };
const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

const STUDIO = { media: { total: 56, photos: 54, videos: 2, other: 2 }, faces: { detected: 70, people: 9, matches: 0, unmatched: 0 }, guests: { total: 4 }, storage: { bytes: 15400000, recentUploads: 54 }, period: { photosUploaded: 54 }, events: { archived: 1 } };
const EVENT = { eventId: "eA", media: { total: 54, photos: 54, other: 0 }, faces: { detected: 14, people: 2, matches: 1, unmatched: 3 }, guests: { total: 6 }, storage: { bytes: 2048, recentUploads: 5 } };
const labels = (rows) => rows.map((row) => row[0]);

test("Detection & Storage has no Videos row, for the studio or an event", () => {
  for (const [data, scope] of [[STUDIO, "studio"], [EVENT, "event"]]) {
    const rows = detectionRows(data, { ...fmt, scope });
    assert.equal(labels(rows).includes("Videos"), false, scope);
    assert.equal(rows.some((row) => /video/i.test(row.join(" "))), false, scope);
  }
});

test("the studio panel keeps its rows; an older non-photo file is named, never counted as a photo", () => {
  const rows = detectionRows(STUDIO, { ...fmt, scope: "studio" });
  assert.deepEqual(labels(rows), ["Storage used", "Faces detected", "People", "Face matches", "Unmatched faces", "Guests", "Recent uploads", "Archived events"]);
  assert.equal(rows[0][2], "54 photos · 2 other files in the store");
  assert.equal(rows[5][2], "across every event");
  assert.equal(rows[6][2], "last 24 hours · 54 photos this month");
});

test("an event's panel draws its own figures, says so, and leaves out the studio-only Archived events", () => {
  const rows = detectionRows(EVENT, { ...fmt, scope: "event" });
  assert.deepEqual(labels(rows), ["Storage used", "Faces detected", "People", "Face matches", "Unmatched faces", "Guests", "Recent uploads"]);
  assert.deepEqual(rows.map((row) => row[1]), ["2.0 KB", "14", "2", "1", "3", "6", "5"].map((value, index) => (index === 0 ? formatBytes(2048) : value)));
  assert.equal(rows[0][2], "54 photos in the store");
  assert.equal(rows[4][2], "review them in the People tab");
  assert.equal(rows[4][3], "text-amber-700");
  assert.equal(rows[5][2], "in this event");
  assert.equal(rows[6][2], "last 24 hours");
  assert.deepEqual(detectionRows(null, { ...fmt, scope: "event" }), []);
});

test("the Project Dashboard has no Videos tile, reads its own event's figures, and the labels say Dashboard / Project Dashboard", () => {
  const overview = read("components", "ai-feature", "event", "tabs", "OverviewTab.js");
  assert.doesNotMatch(overview, /label="Videos"|kind: "VIDEO"/);
  assert.match(overview, /getAiEventDetection\(eventId\)/);
  assert.match(overview, /<DetectionStorageCard scope="event"/);
  assert.match(overview, /detection\?\.eventId === eventId/, "another event's figures are never drawn under this one");
  assert.match(read("services", "ai-feature", "ai-feature.service.js"), /getAiEventDetection = \(id\) => apiRequest\(`\$\{eventPath\(id\)\}\/detection`\)/);
  assert.match(read("components", "ai-feature", "event", "AiEventWorkspacePage.js"), /\{ id: "overview", label: "Project Dashboard" \}/);
  assert.match(read("components", "ai-feature", "AiFeatureNavigation.js"), /\{ label: "Dashboard", value: "\/visual-curation\/ai\/overview" \}/);
});
