const compression = require("compression");

/*
 * Responses are gzipped for the browsers that ask (every one does). The lists are JSON, which
 * shrinks by most of its size - the Projects list and the Pre Production board run to megabytes at
 * the studio's volume, and were sent whole.
 *
 * Event streams are left alone: compressing one buffers it, so the AI replies and the upload
 * progress would arrive all at once at the end instead of as they happen. Anything already
 * compressed (images, PDFs, ZIPs) is skipped by `compression`'s own check of the content type, and
 * so is a response marked `Cache-Control: no-transform`.
 */
const isEventStream = (res) => String(res.getHeader("Content-Type") || "").includes("text/event-stream");

const compressResponses = compression({
  filter: (req, res) => !isEventStream(res) && compression.filter(req, res),
});

module.exports = { compressResponses, isEventStream };
