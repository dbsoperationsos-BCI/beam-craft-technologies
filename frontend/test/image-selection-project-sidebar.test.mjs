import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectListQuery,
  projectSortOptions,
  toWorkspaceProject,
} from "../src/lib/imageSelectionProjectSidebar.mjs";

test("buildProjectListQuery uses the Image Selection sidebar API contract", () => {
  assert.equal(
    buildProjectListQuery({ search: "  Rose Wedding  ", sort: "size", order: "asc", archived: true }),
    "sort=size&order=asc&archived=true&search=Rose+Wedding",
  );
});

test("the same query serves both sidebars: nothing names a section", () => {
  assert.ok(!buildProjectListQuery({ section: "album-proofing" }).includes("section"));
});

test("buildProjectListQuery keeps defaults for the active project list", () => {
  assert.equal(buildProjectListQuery(), "sort=dateAdded&order=desc&archived=false");
});

test("all required sort choices are exposed", () => {
  assert.deepEqual(projectSortOptions.map(([value]) => value), [
    "name", "dateLastOpened", "dateAdded", "dateModified", "dateCreated", "size",
  ]);
});

test("toWorkspaceProject preserves backend fields and maps the workspace name", () => {
  const project = { id: "project-1", projectName: "Rose Wedding", status: "New" };
  assert.deepEqual(toWorkspaceProject(project), { ...project, name: "Rose Wedding" });
});
