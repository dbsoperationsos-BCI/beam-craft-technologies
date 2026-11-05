/**
 * Talking to Ollama.
 *
 * Ollama runs on the same machine as this server and listens on loopback only, so nothing here
 * authenticates - reaching it at all means you are already on the box. That is also why the base
 * URL is configuration rather than a constant: the address is the one thing that differs between
 * a laptop and the VPS, and hardcoding `localhost` is what makes a service work in development and
 * quietly fail in production.
 *
 * Everything below assumes the model may be slow, absent, or not running at all. A local model is
 * a process someone can stop; the CRM has to stay usable when they do.
 */

/*
 * `qwen3:8b`: the model in Nebula's workflow that reads the question and writes the answer. Large
 * enough to choose its lookups reliably and to explain what they returned; the 1.7B it replaced
 * missed tool calls and misread figures.
 *
 * It costs memory and time: about 5GB resident, and on a small CPU-only server a few tokens a
 * second. It is only a default - `OLLAMA_MODEL` overrides it, so a box that cannot carry it runs a
 * smaller model without a code change.
 */
const DEFAULTS = {
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen3:8b",
  /*
   * How long Ollama keeps the model in memory after a question.
   *
   * Its own default is five minutes, and that default is most of why Nebula felt slow. The second
   * model carries the studio's examples baked in, and evaluating that prefix from cold costs 45
   * seconds on this hardware - against 0.5s once it is cached. Ask two questions a minute apart and
   * both are fast; come back after lunch and the first one takes a minute for no visible reason.
   *
   * An hour costs memory and nothing else, and memory the CRM was going to want anyway.
   */
  keepAlive: "1h",
  /*
   * A ceiling on the answer, in tokens.
   *
   * Generation is the other half of the wait: this model writes about six tokens a second on CPU,
   * so a rambling answer is a slow one. The panel asks for two or three sentences, which lands
   * around 60-90 tokens, and a question that deserves a plan runs to about 150. This sits above
   * both - high enough that it never truncates a real answer, low enough that a model which starts
   * rambling is cut off in seconds rather than half a minute.
   */
  maxTokens: 260,
  // A local 8B model on CPU can take a minute on a long transcript. Generous, because the
  // alternative is abandoning work that was nearly done.
  timeoutMs: 120_000,
};

function config() {
  return {
    baseUrl: String(process.env.OLLAMA_BASE_URL || DEFAULTS.baseUrl).trim().replace(/\/+$/, ""),
    model: String(process.env.OLLAMA_MODEL || DEFAULTS.model).trim(),
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || DEFAULTS.timeoutMs),
    keepAlive: String(process.env.OLLAMA_KEEP_ALIVE || DEFAULTS.keepAlive).trim(),
    maxTokens: Number(process.env.OLLAMA_MAX_TOKENS || DEFAULTS.maxTokens),
  };
}

/**
 * Why a request failed, in terms the caller can act on.
 *
 * `retryable` is the important one: a model that is not installed will not install itself on a
 * second attempt, and retrying a 60-second timeout three times turns one slow request into three
 * minutes of a worker doing nothing.
 */
class AiError extends Error {
  constructor(code, message, { retryable = false, status = 502 } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

/*
 * What goes in the log.
 *
 * Never the prompt and never the response: these carry client conversations, names and numbers,
 * and a log file is read by more people and kept for longer than anyone intends. Sizes and
 * durations say everything needed to diagnose a slow or failing model.
 */
function log(event, detail = {}) {
  const parts = Object.entries(detail).map(([key, value]) => `${key}=${value}`).join(" ");
  console.warn(`[ai:ollama] ${event}${parts ? ` ${parts}` : ""}`);
}

/*
 * qwen3 reasons before it answers, and that reasoning is not streamed as content - so the panel
 * showed a blinking cursor for thirty seconds before a single word appeared. For summarising a
 * lead and drafting a reply the reasoning buys very little and costs all of that latency, so it is
 * off. `OLLAMA_THINK=true` turns it back on for a model or a task where it earns its keep.
 */
function thinkingEnabled() {
  return String(process.env.OLLAMA_THINK || "").trim().toLowerCase() === "true";
}

/** Is Ollama up, and is the configured model actually present? */
async function health() {
  const { baseUrl, model } = config();
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return { ok: false, reason: `Ollama responded ${response.status}.`, model, baseUrl };
    }
    const payload = await response.json();
    const installed = (payload?.models || []).map((entry) => entry.name || entry.model).filter(Boolean);
    // Ollama reports "qwen3:8b"; a request for "qwen3" resolves to it, so a prefix match is the
    // honest test rather than string equality.
    const present = installed.some((name) => name === model || name.startsWith(`${model}:`) || model.startsWith(name));
    return {
      ok: present,
      reason: present ? "" : `Ollama is running but '${model}' is not installed. Run: ollama pull ${model}`,
      model,
      baseUrl,
      installed,
    };
  } catch (error) {
    const timedOut = error.name === "TimeoutError";
    return {
      ok: false,
      reason: timedOut ? "Ollama did not respond within 5s." : `Ollama is not reachable at ${baseUrl}.`,
      model,
      baseUrl,
      installed: [],
    };
  }
}

/*
 * The request's deadline, and the caller's cancel where there is one. A reader who closes the panel
 * mid-answer cancels the generation rather than leaving it to run to the end in the background -
 * holding a core, and one of the assistant's few concurrent slots, for an answer nobody will read.
 */
function deadline(timeoutMs, cancel) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return cancel ? AbortSignal.any([timeout, cancel]) : timeout;
}

/**
 * One completion.
 *
 * `schema` is passed to Ollama's structured-output mode, which constrains generation to that shape
 * rather than asking the model politely and hoping. Older builds ignore an object here, so a plain
 * `"json"` is the fallback and the result is validated by the caller either way - a model that
 * returns valid JSON of the wrong shape is the failure this cannot prevent.
 */
async function complete({ system, prompt, schema, temperature = 0.2, repeatPenalty, maxTokens: tokenLimit, model: modelOverride, messages: conversation, tools, raw = false, signal: cancel } = {}) {
  const { baseUrl, timeoutMs, keepAlive, maxTokens } = config();
  const model = String(modelOverride || config().model);
  const started = Date.now();

  const body = {
    model,
    stream: false,
    // Keeps the model - and its cached prompt prefix - in memory between questions.
    keep_alive: keepAlive,
    /*
     * A caller may hand over a whole exchange rather than one question - that is how a tool loop
     * works, where the model's own tool call and the tool's result both have to go back to it.
     */
    messages: conversation || [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: String(prompt || "") },
    ],
    ...(tools && tools.length ? { tools } : {}),
    think: thinkingEnabled(),
    options: {
      temperature,
      // Extraction, not conversation: the same call should read the same way twice.
      top_p: 0.9,
      num_predict: tokenLimit || maxTokens,
      /*
       * Raised by callers that have seen this model loop. Pushed hard toward a language it barely
       * writes, a small model stops composing and starts repeating - one answer came back
       * as "irukke" four times in three sentences. Ollama's default of 1.1 is not enough there.
       */
      ...(repeatPenalty ? { repeat_penalty: repeatPenalty } : {}),
    },
  };
  if (schema) body.format = schema;

  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: deadline(timeoutMs, cancel),
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      log("timeout", { model, ms: Date.now() - started });
      // Not retried here: the worker decides, and a model that took two minutes will take two
      // minutes again.
      throw new AiError("AI_TIMEOUT", `The AI model did not answer within ${Math.round(timeoutMs / 1000)}s.`, { retryable: false, status: 504 });
    }
    log("unreachable", { model, ms: Date.now() - started });
    throw new AiError("AI_UNAVAILABLE", "The AI service is not running.", { retryable: true, status: 503 });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // Ollama answers 404 for a model it does not have. Pulling it is a person's job, not a retry's.
    if (response.status === 404) {
      log("model-missing", { model });
      throw new AiError("AI_MODEL_MISSING", `The model '${model}' is not installed on the AI server.`, { retryable: false });
    }
    log("http-error", { model, status: response.status });
    throw new AiError("AI_FAILED", `The AI service responded ${response.status}.`, {
      // 5xx can pass; 4xx is the request and will not.
      retryable: response.status >= 500,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AiError("AI_BAD_RESPONSE", "The AI service returned something that was not JSON.", { retryable: true });
  }

  const message = payload?.message || {};
  /*
   * A caller running a tool loop needs the whole message, because a turn that asks for a tool has
   * `tool_calls` and no content at all - which is a valid answer, not an empty one.
   */
  if (raw) {
    log("ok", { model, ms: Date.now() - started, tools: (message.tool_calls || []).length });
    return message;
  }

  const content = message.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiError("AI_EMPTY", "The AI model returned an empty answer.", { retryable: true });
  }

  log("ok", { model, ms: Date.now() - started, chars: content.length });
  return content;
}

/**
 * The same completion, delivered a piece at a time.
 *
 * A local model on CPU takes the better part of a minute to finish a paragraph, and a panel that
 * shows nothing for fifty seconds reads as broken. Streaming is not a flourish here - it is the
 * difference between an assistant that appears to be thinking and one that appears to be stuck.
 *
 * Ollama streams newline-delimited JSON, one object per token or so. `onToken` is called with each
 * fragment; the whole answer is returned at the end for the caller that wants it.
 */
async function completeStream({ system, prompt, temperature = 0.3, repeatPenalty, maxTokens: tokenLimit, model: modelOverride, messages: conversation, signal: cancel } = {}, onToken) {
  const { baseUrl, timeoutMs, keepAlive, maxTokens } = config();
  const model = String(modelOverride || config().model);
  const started = Date.now();

  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        keep_alive: keepAlive,
        think: thinkingEnabled(),
        // A caller may hand over a whole exchange rather than one question.
        messages: conversation || [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: String(prompt || "") },
        ],
        options: { temperature, top_p: 0.9, num_predict: tokenLimit || maxTokens, ...(repeatPenalty ? { repeat_penalty: repeatPenalty } : {}) },
      }),
      signal: deadline(timeoutMs, cancel),
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new AiError("AI_TIMEOUT", `The AI model did not answer within ${Math.round(timeoutMs / 1000)}s.`, { status: 504 });
    }
    /*
     * Only a failure to reach Ollama is Ollama's fault.
     *
     * This catch used to swallow everything, and a missing variable in the request body above was
     * duly reported as "the AI service is not running" - with Ollama running perfectly well. Two
     * debugging sessions went looking at the wrong machine. A bug in this file must look like a
     * bug in this file.
     */
    if (!(error instanceof TypeError)) throw error;
    throw new AiError("AI_UNAVAILABLE", "The AI service is not running.", { retryable: true, status: 503 });
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new AiError("AI_MODEL_MISSING", `The model '${model}' is not installed on the AI server.`);
    }
    throw new AiError("AI_FAILED", `The AI service responded ${response.status}.`, { retryable: response.status >= 500 });
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    // One JSON object per line. The last line of a chunk is usually a partial one, so it is kept
    // in the buffer until the newline that completes it arrives.
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try { parsed = JSON.parse(trimmed); } catch { continue; }
      const piece = parsed?.message?.content;
      if (piece) { full += piece; onToken?.(piece); }
    }
  }

  log("stream-ok", { model, ms: Date.now() - started, chars: full.length });
  if (!full.trim()) throw new AiError("AI_EMPTY", "The AI model returned an empty answer.", { retryable: true });
  return full;
}

/**
 * A completion parsed as JSON.
 *
 * Reasoning models - qwen3 among them - like to wrap an answer in prose or a ```json fence even
 * when asked not to, so the first balanced object in the text is taken rather than the whole
 * string. A model that returns nothing parseable is a failure the caller must handle, never a
 * silent empty object.
 */
async function completeJson(options) {
  const raw = await complete(options);
  const parsed = extractJson(raw);
  if (parsed === null) {
    log("unparseable", { chars: raw.length });
    throw new AiError("AI_BAD_JSON", "The AI model did not return usable JSON.", { retryable: true });
  }
  return parsed;
}

/** The first complete JSON object in a string, ignoring any prose or fencing around it. */
function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* Wrapped in something. Find it below. */ }

  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(raw.slice(start, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Loads a model into memory before anybody asks it anything.
 *
 * The first question after a quiet spell was the slow one - not because the model is slow, but
 * because it was not there. Loading a model and evaluating a long system prompt costs
 * about a minute from cold; once resident it answers in seconds and `keep_alive` holds it. Doing
 * that at boot moves the wait to a moment when nobody is watching.
 *
 * Deliberately fire-and-forget. A studio with no Ollama running must still get a working CRM, so a
 * failure here is logged and forgotten - the panel already explains itself when the model is
 * genuinely unavailable.
 */
async function warm(models = [], system = "") {
  const wanted = [...new Set(models.map((name) => String(name || "").trim()).filter(Boolean))];
  for (const model of wanted) {
    try {
      /*
       * Warmed with the real system prompt, not a bare "ok".
       *
       * Ollama caches the longest common prefix of a request, and for a long system prompt that
       * prefix is the system prompt plus the studio's baked-in examples - about 2,300 tokens, which
       * take some fifteen seconds to evaluate from cold and a fifth of a second once cached. Warming
       * without the system prompt loaded the weights but left that cache empty, so the first real
       * question still paid the fifteen seconds. Sending the same prefix the CRM sends is what
       * actually makes the first question fast.
       */
      /*
       * One token, not an answer.
       *
       * Without the cap this generated a full reply nobody would read - 34 seconds of the
       * model writing into the void at boot. The cost worth paying here is loading the weights and
       * evaluating the prefix; the generation is pure waste.
       */
      await complete({ system: system || undefined, prompt: "ok", model, temperature: 0, maxTokens: 1 });
      log("warmed", { model, prefix: system ? system.length : 0 });
    } catch (error) {
      log("warm-failed", { model, reason: error.code || error.name });
    }
  }
}

/*
 * How often the models are touched to keep them resident.
 *
 * `keep_alive` tells Ollama to hold a model for an hour, and it does - until memory gets tight.
 * With both models loaded (4.8GB against 5.4GB free on a 16GB laptop) one gets evicted, and the
 * next question in that language pays a full reload: 47 seconds to first token, measured, in the
 * middle of an otherwise 10-second run.
 *
 * A one-token request every few minutes keeps both in memory and their prompt prefixes cached. It
 * costs a fraction of a second when they are resident, and when one has been evicted it pays the
 * reload here instead of in front of somebody waiting.
 */
const WARM_INTERVAL_MS = 4 * 60 * 1000;

/**
 * Keeps warming, until told to stop.
 *
 * Returns a stop function. Unref'd, so it never holds the process open by itself - a script that
 * has finished its work should exit whether or not this is running.
 */
function keepWarm(models = [], system = "") {
  const timer = setInterval(() => {
    warm(models, system).catch(() => { /* Logged inside warm; a miss is retried in four minutes. */ });
  }, WARM_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { complete, completeJson, completeStream, health, warm, keepWarm, extractJson, config, AiError, DEFAULTS, WARM_INTERVAL_MS };
