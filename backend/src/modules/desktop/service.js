const flags = require("./flags");
const facesConfig = require("../image-selection/faces/config");
const { ENGINE_VERSION, MODEL_VERSION } = require("./runtime");
const engine = require("../ai-feature/face-engine/engine");

/**
 * What this server offers the Virtual Curation desktop app, read once when it signs in. Switches
 * and thresholds only - no row of any table - so the desktop can decide whether to run its own
 * face engine, which model it must load to stay compatible, and which quality gate and cluster
 * threshold the server will apply to what it hands over. `deferral` and `runtime` say this server
 * can hold an upload back for the desktop to describe and can serve the managed runtime
 * (`/runtime/*`); an older server answers without them, which is how the desktop tells.
 */
function capabilities() {
  return {
    virtualCuration: true,
    localAi: flags.localAiOffered(),
    faceModel: flags.expectedFaceModel(),
    embeddingDimension: flags.EMBEDDING_DIMENSION,
    imageSelectionFaces: {
      enabled: facesConfig.enabled(),
      minFaceQuality: facesConfig.minFaceQuality(),
      clusterThreshold: facesConfig.clusterThreshold(),
    },
    deferral: true,
    runtime: { engineVersion: ENGINE_VERSION, modelVersion: MODEL_VERSION },
    // Whether a culling run may be analyzed on the workstation (originals read where they live,
    // numbers posted to `…/ai-culling/sessions/:id/signals`). The same switch as the face hand-off.
    cullingLocal: flags.desktopAiEnabled(),
    // Whether an AI Editing render may be done on the workstation from the original it holds and
    // the edited output handed over (`…/ai-editing/photos/:id/output`). The same switch.
    editingLocal: flags.desktopAiEnabled(),
    // Whether this server's own face engine is answering right now, as the desktop's Automatic
    // mode reads it: on, it leaves the work to the server; off, it describes photos itself. Read
    // off `engine.health()` - no spawn, no await - so it is true only in the process that runs the
    // AI worker (the default), and false on an API that leaves the worker to another machine.
    serverEngineReady: engine.health().status === "ready",
    serverTime: new Date().toISOString(),
  };
}

module.exports = { capabilities };
