const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { sceneEnabled } = require("../src/modules/image-selection/ai-culling/scene/engine");

const SCENE = path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "scene");

// Culling V2, phase 3: scene understanding on by default wherever the local AI runtime is, and a
// wedding/event profile measured on real photos.
test("the scene engine follows the local AI runtime unless the studio says otherwise", () => {
  assert.equal(sceneEnabled({}), false, "no local AI: off");
  assert.equal(sceneEnabled({ AI_FACE_ENGINE_ENABLED: "true" }), true, "the same Python runtime as the face engine: on");
  assert.equal(sceneEnabled({ AI_FACE_ENGINE_ENABLED: "true", AI_CULLING_SCENE_ENABLED: "false" }), false, "an explicit off wins");
  assert.equal(sceneEnabled({ AI_CULLING_SCENE_ENABLED: "true" }), true);
  assert.equal(sceneEnabled({ AI_FACE_ENGINE_ENABLED: "true", AI_CULLING_SCENE_ENABLED: "auto" }), true);
});

test("the event profile names the wedding scenes a studio culls by, and its vectors match it", () => {
  const profile = JSON.parse(fs.readFileSync(path.join(SCENE, "profiles", "event.json"), "utf8"));
  const assets = JSON.parse(fs.readFileSync(path.join(SCENE, "assets", "scene-labels.event.clip-b32.json"), "utf8"));
  const ids = profile.scenes.map((scene) => scene.id);
  for (const id of ["BRIDE_PORTRAIT", "GROOM_PORTRAIT", "COUPLE", "FAMILY", "GROUP", "CEREMONY", "STAGE", "DANCE", "CANDID", "EMOTIONAL", "DECOR", "DETAILS", "VENUE", "KIDS", "ACCIDENTAL"]) assert.ok(ids.includes(id), id);
  assert.equal(profile.version, 2);
  assert.deepEqual(assets.scenes.map((scene) => scene.id), ids, "the vectors were rebuilt from this profile");
  assert.equal(assets.version, 2);
  for (const scene of assets.scenes) assert.equal(scene.vector.length, 512);
  assert.equal(profile.scenes.find((scene) => scene.id === "ACCIDENTAL").accidental, true);
});
