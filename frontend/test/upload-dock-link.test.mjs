import assert from "node:assert/strict";
import test from "node:test";
import { uploadSectionPath, uploadSessionHref } from "../src/lib/uploadDockLink.mjs";

const albumSession = { projectId: "p1", folderId: "f1", uploadsBase: "/api/image-selection/album-proofs/projects/p1/uploads" };
const imageSelectionSession = { projectId: "p2", folderId: "f2" };

test("an upload started in Album Proofing goes back to Album Proofing", () => {
  assert.equal(uploadSectionPath(albumSession), "/image-selection/album-proofing");
  assert.equal(uploadSessionHref(albumSession, 7), "/image-selection/album-proofing?projectId=p1&folderId=f1&at=7");
});

test("an Image Selection upload still goes to the Projects page", () => {
  assert.equal(uploadSectionPath(imageSelectionSession), "/image-selection/projects");
  assert.equal(uploadSessionHref(imageSelectionSession, 7), "/image-selection/projects?projectId=p2&folderId=f2&at=7");
  // Its dock posts under the project itself, which names no section of its own.
  assert.equal(uploadSectionPath({ uploadsBase: "/api/image-selection/projects/p2/uploads" }), "/image-selection/projects");
});

test("the two sections are never confused, whatever the session is missing", () => {
  assert.equal(uploadSectionPath({}), "/image-selection/projects");
  assert.equal(uploadSectionPath(null), "/image-selection/projects");
  assert.equal(uploadSectionPath({ uploadsBase: null }), "/image-selection/projects");
});

test("a session with no folder links to the project alone", () => {
  assert.equal(uploadSessionHref({ projectId: "p1", uploadsBase: albumSession.uploadsBase }, 7), "/image-selection/album-proofing?projectId=p1&at=7");
});

test("every click is a distinct URL, so clicking again still navigates", () => {
  assert.notEqual(uploadSessionHref(albumSession, 1), uploadSessionHref(albumSession, 2));
});
