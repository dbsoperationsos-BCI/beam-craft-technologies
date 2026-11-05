import assert from "node:assert/strict";
import test from "node:test";
import { availableGroupNames, filterGroupNames } from "../src/lib/albumProofingGroupNames.mjs";

const inProgress = "Work in Progress - Post Production";

test("availableGroupNames offers only in-progress projects with an unused, unique group name", () => {
  const projects = [
    { id: "a", projectStatus: inProgress, whatsappGroupName: "Rose Wedding" },
    { id: "b", projectStatus: "Booked", whatsappGroupName: "Not Started Yet" },
    { id: "c", projectStatus: inProgress, whatsappGroupName: "  " },
    { id: "d", projectStatus: inProgress, whatsappGroupName: "Rose Wedding" },
    { id: "e", projectStatus: "Work in Progress - Pre & Production", whatsappGroupName: "Lily Reception" },
    { id: "f", projectStatus: inProgress, whatsappGroupName: "Already Proofing" },
  ];
  assert.deepEqual(
    availableGroupNames(projects, ["f"]).map((project) => project.id),
    ["a", "e"],
  );
});

test("availableGroupNames tolerates an empty or missing list", () => {
  assert.deepEqual(availableGroupNames(undefined), []);
  assert.deepEqual(availableGroupNames([null]), []);
});

test("filterGroupNames matches case-insensitively and keeps everything for a blank query", () => {
  const names = [
    { id: "a", whatsappGroupName: "Rose Wedding" },
    { id: "b", whatsappGroupName: "Lily Reception" },
  ];
  assert.deepEqual(filterGroupNames(names, "  ").map((project) => project.id), ["a", "b"]);
  assert.deepEqual(filterGroupNames(names, "lily").map((project) => project.id), ["b"]);
  assert.deepEqual(filterGroupNames(names, "nothing"), []);
});
