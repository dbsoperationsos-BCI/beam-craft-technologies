require("dotenv").config();
const { startWorker } = require("../modules/ai-feature/processing/worker");
const { recoverPending } = require("../modules/ai-feature/processing/queue");

// The AI Feature's media worker as a process of its own, for a machine that wants face detection
// off the API's CPU. Run with `npm run worker:ai-events` and set AI_FEATURE_EMBEDDED_WORKER=false on the API.
startWorker();
recoverPending().then((count) => console.log(`Recovered ${count} pending AI event media jobs.`)).catch((error) => console.error("Unable to recover pending AI event media jobs:", error));
