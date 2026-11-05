const { createRedisConnection } = require("../config/redis");
const repository = require("./repository");

// Same shape as the upload batch channel: one Redis pub/sub channel per session, one shared
// publisher connection, and the SSE controller subscribes with its own connection per viewer.
let publisher;
const channel = (sessionId) => `image-selection:culling:${sessionId}`;
function getPublisher() { if (!publisher) publisher = createRedisConnection(); return publisher; }

async function publish(sessionId, repo = repository) {
  if (!sessionId) return;
  const session = await repo.findSessionById(sessionId);
  if (!session) return;
  // Best-effort by design, like upload progress: a dropped Redis publish must never fail the run.
  await getPublisher().publish(channel(sessionId), JSON.stringify({ type: "progress", session })).catch(() => {});
}

module.exports = { channel, publish };
