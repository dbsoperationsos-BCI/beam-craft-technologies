import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_ROWS,
  DASHBOARD_STAGES,
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  SUMMARY_CARDS,
  formatBytes,
  formatCompact,
  periodPhrase,
  previousLabel,
  previousPhrase,
  projectListFiltersFromParams,
  projectsHref,
  openProjectHref,
  relativeTime,
  rowsForView,
  sameView,
  selectionText,
  stageChip,
  trendOf,
  unitLabel,
  viewLabel,
} from "../src/lib/imageSelectionDashboard.mjs";
import { PROGRESS_COLORS } from "../src/lib/progressStatus.mjs";
import { buildProjectListQuery } from "../src/lib/imageSelectionProjectSidebar.mjs";
import { SIDEBAR_MODULES } from "../src/constants/navigation.mjs";
import { permissionForRoute } from "../src/constants/modulePermissions.js";

const NOW = new Date("2026-09-08T10:00:00.000Z");

test("the range picker offers the five ranges and opens on This Month — the page's only range control", () => {
  assert.deepEqual(RANGE_OPTIONS.map((option) => option.label), ["Lifetime", "This Month", "This Week", "3 Months", "6 Months"]);
  assert.deepEqual(RANGE_OPTIONS.map((option) => option.value), ["lifetime", "month", "week", "3m", "6m"]);
  assert.equal(DEFAULT_RANGE, "month");
  assert.ok(RANGE_OPTIONS.some((option) => option.value === DEFAULT_RANGE), "the default is one of the options");
});

test("each range but Lifetime names the point its arrows measure from", () => {
  assert.equal(previousPhrase("month"), "vs last month");
  assert.equal(previousPhrase("week"), "vs last week");
  assert.equal(previousPhrase("3m"), "vs 3 months ago");
  assert.equal(previousPhrase("6m"), "vs 6 months ago");
  assert.equal(previousPhrase("lifetime"), null);
  RANGE_OPTIONS.filter((option) => option.value !== "lifetime").forEach((option) => assert.ok(previousPhrase(option.value), option.value));
});

test("the same point again as the name a card prints under its own vs", () => {
  assert.equal(previousLabel("month"), "Last Month");
  assert.equal(previousLabel("week"), "Last Week");
  assert.equal(previousLabel("3m"), "3 Months Ago");
  assert.equal(previousLabel("6m"), "6 Months Ago");
  assert.equal(previousLabel("lifetime"), null);
  // The card supplies the "vs" on the line above, so no name may carry one of its own.
  RANGE_OPTIONS.filter((option) => option.value !== "lifetime").forEach((option) => {
    const label = previousLabel(option.value);
    assert.ok(label, option.value);
    assert.ok(!/^vs /i.test(label), label);
  });
});

test("an arrow points the way the number moved, with the change signed", () => {
  assert.deepEqual(trendOf(3), { direction: "up", text: "+3" });
  assert.deepEqual(trendOf(-2), { direction: "down", text: "-2" });
  assert.deepEqual(trendOf(0), { direction: "flat", text: "0" });
  assert.deepEqual(trendOf(undefined), { direction: "flat", text: "0" });
  assert.equal(trendOf(12500).text, "+12,500");
});

test("each range has words that finish the line under a card", () => {
  assert.equal(periodPhrase("month"), "this month");
  assert.equal(periodPhrase("week"), "this week");
  assert.equal(periodPhrase("lifetime"), "in total");
  assert.equal(periodPhrase("3m"), "in the last 3 months");
  assert.equal(periodPhrase("6m"), "in the last 6 months");
  // Every option has one, so no card can read "+2 created undefined".
  RANGE_OPTIONS.forEach((option) => assert.notEqual(periodPhrase(option.value), "in this range", option.value));
  assert.equal(periodPhrase(undefined), "in this range");
});

test("every stage is a sidebar rung or the Archived view, in the product-wide palette", () => {
  assert.deepEqual(DASHBOARD_STAGES.map((stage) => stage.key), ["uploaded", "linkSent", "selecting", "submitted", "completed"]);
  assert.deepEqual(DASHBOARD_STAGES.map((stage) => stage.progress), ["notStarted", "inProgress", "partiallyCompleted", "completed", "archived"]);
  assert.equal(stageChip("selecting").color, PROGRESS_COLORS.partiallyCompleted);
  assert.equal(stageChip("submitted").color, PROGRESS_COLORS.completed);
  assert.equal(stageChip("nonsense").label, "Uploaded");
});

test("a card opens the Projects page with the filter it counted", () => {
  assert.equal(projectsHref(), "/image-selection/projects");
  assert.equal(projectsHref({ stage: "selecting" }), "/image-selection/projects?status=partiallyCompleted");
  assert.equal(projectsHref({ stage: "uploaded" }), "/image-selection/projects?status=notStarted");
  assert.equal(projectsHref({ stage: "completed" }), "/image-selection/projects?archived=true");
  assert.equal(projectsHref({ attention: "overdue" }), "/image-selection/projects?attention=overdue");
  assert.equal(projectsHref({ projectId: "p1", at: 5 }), "/image-selection/projects?projectId=p1&at=5");
  assert.equal(projectsHref({ create: true }), "/image-selection/projects?new=1");
  // An unknown stage or row is no filter rather than a broken one.
  assert.equal(projectsHref({ stage: "nope", attention: "nope" }), "/image-selection/projects");
  // Every attention row still resolves to a Projects-page filter, for the sidebar chip and deep links.
  ATTENTION_ROWS.forEach((row) => assert.ok(projectsHref({ attention: row.key }).includes(`attention=${row.key}`)));
});

test("a card is a view of the table: the total is no view, every other card narrows it", () => {
  const rows = [
    { id: "a", stage: "uploaded", views: { yetToUpload: true, notPublished: false, downloaded: false } },
    { id: "b", stage: "uploaded", views: { yetToUpload: false, notPublished: true, downloaded: false } },
    { id: "c", stage: "linkSent", views: { yetToUpload: false, notPublished: false, downloaded: false } },
    { id: "d", stage: "submitted", views: { yetToUpload: false, notPublished: false, downloaded: true } },
    { id: "e", stage: "completed", views: { yetToUpload: false, notPublished: false, downloaded: false } },
  ];
  const ids = (view) => rowsForView(rows, view).map((row) => row.id);
  assert.equal(SUMMARY_CARDS[0].view, null);
  assert.deepEqual(ids(null), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids({ attention: "yetToUpload" }), ["a"]);
  assert.deepEqual(ids({ attention: "notPublished" }), ["b"]);
  assert.deepEqual(ids({ stage: "linkSent" }), ["c"]);
  assert.deepEqual(ids({ stage: "submitted" }), ["d"]);
  assert.deepEqual(ids({ attention: "downloaded" }), ["d"]);
  assert.deepEqual(ids({ stage: "completed" }), ["e"]);
  // A row from an older response with no flags simply matches no flag view.
  assert.deepEqual(rowsForView([{ id: "x", stage: "uploaded" }], { attention: "yetToUpload" }), []);
  // Every card but the total names a view that at least one of these rows can be on.
  SUMMARY_CARDS.filter((card) => card.view).forEach((card) => assert.ok(card.view.stage || card.view.attention, card.key));
});

test("views compare by meaning and read as the card that carries them", () => {
  assert.equal(sameView(null, undefined), true);
  assert.equal(sameView({ stage: "selecting" }, { stage: "selecting" }), true);
  assert.equal(sameView({ stage: "selecting" }, { attention: "downloaded" }), false);
  assert.equal(sameView({ stage: "selecting" }, null), false);
  assert.equal(viewLabel(null), "All projects");
  assert.equal(viewLabel({ stage: "selecting" }), "Client In Progress");
  assert.equal(viewLabel({ attention: "readyToDownload" }), "Yet to Download");
  // A stage no card carries falls back to the stage's own name; a panel-only row to its label.
  assert.equal(viewLabel({ stage: "uploaded" }), "Uploaded");
  assert.equal(viewLabel({ attention: "overdue" }), "Overdue");
  // A view no card carries still has a name, for the table chip and the Projects sidebar.
  assert.equal(viewLabel({ attention: "notOpened" }), "Haven't opened");
});

test("the noun beside a figure agrees with it", () => {
  assert.equal(unitLabel(1, "Project"), "Project");
  assert.equal(unitLabel(0, "Project"), "Projects");
  assert.equal(unitLabel(4, "Project"), "Projects");
  assert.equal(unitLabel(undefined, "Project"), "Projects");
  // Nothing to say where a card names no unit.
  assert.equal(unitLabel(1, ""), "");
  // Every card counts projects, so every card has the noun to say so.
  SUMMARY_CARDS.forEach((card) => assert.equal(card.unit, "Project", card.key));
});

test("the ten cards read in the order the studio works a job", () => {
  assert.deepEqual(SUMMARY_CARDS.map((card) => card.label), ["Total Projects", "Yet to Upload", "Client Sending Not Done", "Client Not Started", "Client In Progress", "Client Submitted", "Yet to Download", "Link Expiring Soon", "Expired Projects", "Downloaded"]);
  assert.deepEqual(ATTENTION_ROWS.map((row) => row.key), ["overdue", "notOpened", "inactive", "newSubmissions", "clientSubmitted", "readyToDownload", "yetToUpload", "notPublished", "expiringSoon", "expired", "downloaded"]);
  // A link about to stop and one that already has are the two ends of the same life, so they sit
  // beside each other and nothing counts a project on both.
  assert.deepEqual(SUMMARY_CARDS.slice(7, 9).map((card) => card.view.attention), ["expiringSoon", "expired"]);
});

test("the Projects page reads those filters back, and nothing else", () => {
  const get = (params) => (name) => params[name] ?? null;
  assert.deepEqual(projectListFiltersFromParams(get({})), { progress: "all", archived: false, attention: null, create: false });
  assert.deepEqual(projectListFiltersFromParams(get({ status: "inProgress", attention: "inactive", new: "1" })), { progress: "inProgress", archived: false, attention: "inactive", create: true });
  assert.deepEqual(projectListFiltersFromParams(get({ archived: "true", status: "bogus", attention: "bogus" })), { progress: "all", archived: true, attention: null, create: false });
});

test("the list query carries the attention filter and is otherwise unchanged", () => {
  assert.equal(buildProjectListQuery({ attention: "readyToDownload" }), "sort=dateAdded&order=desc&archived=false&attention=readyToDownload");
  assert.equal(buildProjectListQuery(), "sort=dateAdded&order=desc&archived=false");
});

test("headline numbers fit a card", () => {
  assert.equal(formatCompact(184), "184");
  assert.equal(formatCompact(2480), "2.5K");
  assert.equal(formatCompact(248000), "248K");
  assert.equal(formatCompact(1250000), "1.3M");
  assert.equal(formatCompact(undefined), "0");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(13 * 1024 ** 3), "13 GB");
});

test("times read as how long ago, or as a dash when nobody recorded one", () => {
  assert.equal(relativeTime(null, NOW), "—");
  assert.equal(relativeTime("2026-09-08T09:59:40.000Z", NOW), "just now");
  assert.equal(relativeTime("2026-09-08T09:48:00.000Z", NOW), "12 mins ago");
  assert.equal(relativeTime("2026-09-08T09:00:00.000Z", NOW), "1 hour ago");
  assert.equal(relativeTime("2026-09-05T10:00:00.000Z", NOW), "3 days ago");
  assert.equal(relativeTime("2026-08-20T10:00:00.000Z", NOW), "2 weeks ago");
});

test("a project without a limit says how many, never a percentage", () => {
  assert.equal(selectionText({ selectedCount: 187, selectionLimit: 250 }), "187 / 250 selected");
  assert.equal(selectionText({ selectedCount: 187, selectionLimit: null }), "187 selected");
});

test("the sidebar lands on the dashboard from one entry, with no screens listed beneath it", () => {
  const entry = SIDEBAR_MODULES.find((group) => group.id === "visual-curation").items.find((item) => item.id === "image-selection");
  assert.equal(entry.href, "/image-selection/dashboard");
  // Dashboard and Projects belong to the module's own header, not to the sidebar.
  assert.equal(entry.children, undefined);
  // The whole module lights the entry, so Projects does not leave the sidebar looking unvisited.
  assert.equal(entry.activePath, "/image-selection");
  for (const href of ["/image-selection/dashboard", "/image-selection/projects"]) {
    assert.deepEqual(permissionForRoute(href), { module: "IMAGE_SELECTION", feature: "Project Management" }, href);
  }
});

test("a Yet to Download row opens on its shoot folder, and nothing else does", () => {
  const row = { id: "p1", readyToDownloadFolderId: "f-wed" };
  const ready = { attention: "readyToDownload" };
  assert.equal(projectsHref({ projectId: "p1", folderId: "f-wed", at: 5 }), "/image-selection/projects?projectId=p1&folderId=f-wed&at=5");
  assert.equal(openProjectHref(row, ready, 5), "/image-selection/projects?projectId=p1&folderId=f-wed&at=5");
  // Every other view, and no view at all, opens the project as a click always has.
  for (const view of [null, { attention: "yetToUpload" }, { attention: "downloaded" }, { attention: "expiringSoon" }, { stage: "submitted" }, { stage: "linkSent" }]) {
    assert.equal(openProjectHref(row, view, 5), "/image-selection/projects?projectId=p1&at=5");
  }
  // No folder found for the shoot: the project, as it always opened.
  assert.equal(openProjectHref({ id: "p1", readyToDownloadFolderId: null }, ready, 5), "/image-selection/projects?projectId=p1&at=5");
});
