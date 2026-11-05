require("dotenv").config();
const { startWorker } = require("../modules/image-selection/ai-culling/worker");
const { recoverPending } = require("../modules/image-selection/ai-culling/queue");

startWorker();
recoverPending().then((count) => { if (count) console.log(`Recovered ${count} pending culling sessions.`); }).catch((error) => console.error("Unable to recover pending culling sessions:", error));
