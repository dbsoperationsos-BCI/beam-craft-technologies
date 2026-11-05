require("dotenv").config();
const { startWorker } = require("../modules/image-selection/faces/worker");
const { recoverPending } = require("../modules/image-selection/faces/queue");

// The client gallery's face worker as a process of its own, for a machine that wants face
// detection off the API's CPU. Run with `npm run worker:faces` and set
// IMAGE_SELECTION_FACE_EMBEDDED_WORKER=false on the API. Runs when AI_FACE_ENGINE_ENABLED=true (or IMAGE_SELECTION_FACE_RECOGNITION_ENABLED=true).
if (!startWorker()) console.log("[image-selection faces] the People filter is switched off (AI_FACE_ENGINE_ENABLED / IMAGE_SELECTION_FACE_RECOGNITION_ENABLED); nothing to run.");
recoverPending().then((count) => { if (count) console.log(`Recovered ${count} pending face scans.`); }).catch((error) => console.error("Unable to recover pending face scans:", error));
