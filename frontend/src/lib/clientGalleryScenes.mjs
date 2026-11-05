/**
 * The client gallery's Scene filter, decided without the DOM: the rows its dropdown offers and
 * which scene is in force once the list has been re-counted.
 *
 * The rows are the culling review's own (`cullingSceneOptions`): "All scenes", then each scene the
 * server listed as "Family · 8" - the same words, the same order, the same count beside the name -
 * so a scene reads the same to the studio in the review and to the client in the gallery.
 */
import { CULLING_ALL_SCENES, cullingSceneOptions } from "./imageSelectionCulling.mjs";

// The value the dropdown holds when no scene is asked for - the whole shoot, classified or not.
export const ALL_SCENES = CULLING_ALL_SCENES;

/** The dropdown's rows, or none at all when the gallery has no scene to offer. */
export const sceneOptions = (scenes = []) => cullingSceneOptions(scenes);

/**
 * The scene the grid is asked for. A scene the list no longer holds - chosen for the whole shoot,
 * then gone once the chosen people narrowed the count to none, or another shoot opened - reads
 * as all scenes rather than as an empty grid under a row the menu cannot show.
 */
export function activeScene(sceneId, scenes = []) {
  if (!sceneId || sceneId === ALL_SCENES) return ALL_SCENES;
  return scenes.some((scene) => scene.id === sceneId) ? sceneId : ALL_SCENES;
}

/** What the listing is asked for: nothing for all scenes, the id otherwise. */
export const sceneQuery = (sceneId, scenes = []) => {
  const scene = activeScene(sceneId, scenes);
  return scene === ALL_SCENES ? undefined : scene;
};

/** The scene's own words for a heading - "Family" - or empty for all scenes. */
export const sceneLabel = (sceneId, scenes = []) => scenes.find((scene) => scene.id === activeScene(sceneId, scenes))?.label || "";
