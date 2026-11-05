import assert from "node:assert/strict";
import test from "node:test";
import {
  ALBUM_SUMMARY_CARDS, CORRECTIONS_EMPTY, DASHBOARD_ROUTE, PROJECTS_ROUTE, albumHref, albumProofingSections, correctionsText, createProjectHref,
  linkLabel, rowMatchesView, rowsForView, sameView, versionText, viewLabel,
} from "../src/lib/albumProofingDashboard.mjs";
import { ALBUM_STATE_LABELS } from "../src/lib/albumProofingStates.mjs";
import { SIDEBAR_MODULES } from "../src/constants/navigation.mjs";
import { permissionForRoute } from "../src/constants/modulePermissions.js";

const rows = [
  { id: "a", projectId: "p1", workflowStatus: "QC_REVIEW", status: "QC_REVIEW", views: { correctionsOpen: false, readyForRevisedVersion: false, linkExpiringSoon: false, linkExpired: false } },
  { id: "b", projectId: "p1", workflowStatus: "REVISION_IN_PROGRESS", status: "REVISION_IN_PROGRESS", views: { correctionsOpen: false, readyForRevisedVersion: true, linkExpiringSoon: false, linkExpired: false } },
  { id: "c", projectId: "p2", workflowStatus: "READY_FOR_CLIENT", status: "READY_FOR_CLIENT", views: { correctionsOpen: false, readyForRevisedVersion: false, linkExpiringSoon: false, linkExpired: false } },
  { id: "d", projectId: "p2", workflowStatus: "COMPLETED", status: "ARCHIVED", views: { correctionsOpen: false, readyForRevisedVersion: false, linkExpiringSoon: false, linkExpired: true } },
];

test("ten cards over the figures the dashboard answers, named with the module's own state labels", () => {
  assert.deepEqual(ALBUM_SUMMARY_CARDS.map((card) => card.key), [
    "totalAlbums", "draft", "readyForQc", "qcReview", "correctionsOpen", "readyForRevisedVersion", "readyForClient", "clientReview", "linkExpiringSoon", "completed",
  ]);
  assert.deepEqual(ALBUM_SUMMARY_CARDS.map((card) => card.label), [
    "Total Albums", ALBUM_STATE_LABELS.DRAFT, ALBUM_STATE_LABELS.READY_FOR_QC, ALBUM_STATE_LABELS.QC_REVIEW, "Corrections Open", "Ready for Revised Version",
    ALBUM_STATE_LABELS.READY_FOR_CLIENT, ALBUM_STATE_LABELS.CLIENT_REVIEW, "Link Expiring Soon", ALBUM_STATE_LABELS.COMPLETED,
  ]);
  assert.ok(ALBUM_SUMMARY_CARDS.every((card) => card.unit === "Album"));
  assert.equal(ALBUM_SUMMARY_CARDS[0].view, null);
  assert.deepEqual(ALBUM_SUMMARY_CARDS[2].view, { status: ["READY_FOR_QC", "REVISION_READY_FOR_QC"] });
  assert.deepEqual(ALBUM_SUMMARY_CARDS[4].view, { attention: "correctionsOpen" });
});

test("a card narrows the Recent Albums table to the albums it counted, by workflow state or by flag", () => {
  assert.deepEqual(rowsForView(rows, null).map((row) => row.id), ["a", "b", "c", "d"]);
  assert.deepEqual(rowsForView(rows, { status: ["QC_APPROVED", "READY_FOR_CLIENT"] }).map((row) => row.id), ["c"]);
  assert.deepEqual(rowsForView(rows, { attention: "readyForRevisedVersion" }).map((row) => row.id), ["b"]);
  // An archived album still counts under the state it was archived in.
  assert.equal(rowMatchesView(rows[3], { status: ["COMPLETED"] }), true);
});

test("views compare by what they mean, and a view has the words of its card", () => {
  assert.equal(sameView(null, undefined), true);
  assert.equal(sameView({ status: ["QC_REVIEW"] }, { status: ["QC_REVIEW"] }), true);
  assert.equal(sameView({ status: ["QC_REVIEW"] }, { attention: "correctionsOpen" }), false);
  assert.equal(viewLabel(null), "All albums");
  assert.equal(viewLabel({ attention: "linkExpiringSoon" }), "Link Expiring Soon");
  assert.equal(viewLabel({ status: ["COMPLETED"] }), "Completed");
});

test("the words a row prints for its version, corrections and link", () => {
  assert.equal(versionText({ currentVersionNumber: 2 }), "V2");
  assert.equal(versionText({ currentVersionNumber: null }), "No proof yet");
  assert.equal(correctionsText({ openCorrections: 0 }), "0 open");
  assert.equal(correctionsText({ openCorrections: 1 }), "1 open");
  assert.equal(linkLabel(null), "Not sent");
  assert.equal(linkLabel({ state: "expiringSoon" }), "Expiring soon");
  assert.equal(linkLabel({ state: "revoked" }), "Revoked");
});

test("where a row and the create action go, and the header's two sections", () => {
  assert.equal(DASHBOARD_ROUTE, "/image-selection/album-proofing/dashboard");
  assert.equal(PROJECTS_ROUTE, "/image-selection/album-proofing");
  assert.equal(albumHref({ id: "al 1", projectId: "p1" }, 5), "/image-selection/album-proofing?projectId=p1&albumId=al+1&at=5");
  assert.equal(createProjectHref(), "/image-selection/album-proofing?new=1");
  assert.deepEqual(albumProofingSections.map((section) => section.label), ["Dashboard", "Projects"]);
  assert.equal(albumProofingSections[0].value, DASHBOARD_ROUTE);
  assert.equal(CORRECTIONS_EMPTY, "No open corrections.");
});

test("the dashboard is the sidebar's landing for Album Proofing, under the Album Proofing permission", () => {
  const entry = SIDEBAR_MODULES.flatMap((section) => section.items).find((item) => item.id === "album-proofing");
  assert.equal(entry.href, DASHBOARD_ROUTE);
  assert.equal(entry.activePath, PROJECTS_ROUTE);
  assert.deepEqual(permissionForRoute(DASHBOARD_ROUTE), { module: "IMAGE_SELECTION", feature: "Album Proofing" });
  assert.deepEqual(permissionForRoute(PROJECTS_ROUTE), { module: "IMAGE_SELECTION", feature: "Album Proofing" });
});
