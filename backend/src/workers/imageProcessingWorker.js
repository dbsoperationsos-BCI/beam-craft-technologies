require("dotenv").config();
const { startWorker } = require("../modules/image-selection/processing/worker");
const { recoverPending } = require("../modules/image-selection/processing/queue");

startWorker();
recoverPending().then((count) => console.log(`Recovered ${count} pending image jobs.`)).catch((error) => console.error("Unable to recover pending image jobs:", error));
