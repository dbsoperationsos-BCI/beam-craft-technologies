const ollama = require("./ollamaClient");

/**
 * Which engine answers.
 *
 * Ollama is the only supported provider. Nebula handles client conversations, recordings and
 * operational data, so sending prompts to a paid external provider is intentionally impossible.
 */
function providerName() {
  return "ollama";
}

/** A JSON answer from whichever engine is configured. */
function completeJson(options) {
  return ollama.completeJson(options);
}

/**
 * One turn that may ask for a tool.
 *
 * Ollama runs the tool loop and the plain-answer path, keeping all prompts on the local machine.
 */
function completeWithTools(options) {
  return ollama.complete({ ...options, raw: true });
}

/**
 * A streamed answer for a whole exchange.
 *
 * The final turn of an answer - the one the reader watches appear - rather than the tool rounds
 * before it, which have nothing to show.
 */
function streamConversation(options, onToken) {
  return ollama.completeStream(options, onToken);
}

/** Free text, for the conversational assistant where a shape would get in the way. */
function complete(options) {
  return ollama.complete(options);
}

/**
 * A streamed answer, where the engine can stream.
 *
 * The local provider streams directly so the caller can show progress immediately.
 */
async function completeStream(options, onToken) {
  return ollama.completeStream(options, onToken);
}

/** Whether the configured engine is usable right now, for the health endpoint and the UI. */
async function health() {
  return { ...(await ollama.health()), provider: "ollama" };
}

/**
 * Whether an engine could answer at all.
 *
 * Ollama needs no credential - it is a process on this machine - so this is about configuration
 * rather than reachability. Whether it is actually running is what `health()` asks.
 */
function isConfigured() {
  return true;
}

module.exports = { complete, completeJson, completeStream, streamConversation, completeWithTools, health, providerName, isConfigured, AiError: ollama.AiError };
