const { z } = require("zod");
const { recordHeartbeat, HEARTBEAT_SECONDS, CONTEXTS } = require("./service");
const { readMonitoringSettings } = require("../settings/service");

const beatSchema = z.object({
  context: z.enum(CONTEXTS).default("app"),
});

/**
 * One beat from a browser that is being used.
 *
 * Deliberately says nothing about *when*: the server stamps it. A client that could name the time
 * could name any time, and a usage figure anybody can inflate from the console is not a
 * measurement.
 *
 * Answers with the beat interval, so the browser takes its pace from the server rather than from a
 * constant compiled into a bundle somebody may be running a stale copy of.
 */
async function beat(req, res) {
  const parsed = beatSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid heartbeat." });
  try {
    await recordHeartbeat({ userId: req.user.id, context: parsed.data.context });
    /*
     * The pace *and* the timeout, so the browser takes both from the server rather than from a
     * constant compiled into its bundle. The heartbeat already read its interval from here; the
     * timeout is the same kind of fact and an administrator can now change it, so a tab that has
     * been open since before the change picks the new value up on its next beat.
     */
    const { usageTimeoutMinutes } = await readMonitoringSettings();
    return res.json({ data: { intervalSeconds: HEARTBEAT_SECONDS, idleTimeoutSeconds: usageTimeoutMinutes * 60 } });
  } catch (error) {
    // A missed beat costs a few seconds of a usage figure and nothing else, so it is never worth
    // failing a page over - it is logged and answered quietly.
    console.error("Unable to record a usage heartbeat:", error.message);
    return res.status(error.status || 500).json({ message: "Unable to record usage." });
  }
}

module.exports = { beat };
