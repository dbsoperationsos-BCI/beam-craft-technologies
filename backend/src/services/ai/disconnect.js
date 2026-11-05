/**
 * A cancel that fires when the reader goes - the tab closed, the panel shut - before a streamed
 * answer is finished. Handed to the model call, it stops the generation rather than leaving it to
 * run to the end for nobody: holding a core, and one of the assistant's few concurrent slots
 * (`limits.js`), that somebody else is waiting for. Both assistants' streams use it.
 */
function cancelOnDisconnect(res) {
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableFinished) controller.abort(); });
  return controller.signal;
}

module.exports = { cancelOnDisconnect };
