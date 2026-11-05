const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

/*
 * The Ollama client, against a stand-in for Ollama.
 *
 * A real model is not installed on every machine that runs these tests, and even where it is, its
 * answers vary - which makes it useless for asserting behaviour. What matters here is not what the
 * model says but what this code does when the model is slow, absent, or talking nonsense, and a
 * stub reproduces each of those on demand.
 */

function startStub(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function withEnv(port, extra = {}) {
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.OLLAMA_MODEL = extra.model || "qwen3:8b";
  process.env.OLLAMA_TIMEOUT_MS = extra.timeoutMs || "3000";
}

function chatReply(content) {
  return JSON.stringify({ message: { role: "assistant", content }, done: true });
}

// Required fresh so each test reads the env set just above it.
function client() {
  delete require.cache[require.resolve("../src/services/ai/ollamaClient")];
  return require("../src/services/ai/ollamaClient");
}

test("health reports ok when the model is installed", async () => {
  const { server, port } = await startStub((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "llama3.2:3b" }] }));
  });
  withEnv(port);
  const result = await client().health();
  assert.equal(result.ok, true);
  assert.equal(result.model, "qwen3:8b");
  server.close();
});

test("health says which model to pull when it is missing", async () => {
  const { server, port } = await startStub((req, res) => {
    res.end(JSON.stringify({ models: [{ name: "llama3.2:3b" }] }));
  });
  withEnv(port);
  const result = await client().health();
  assert.equal(result.ok, false);
  // The message has to be actionable: a person reading it should know the next command.
  assert.match(result.reason, /ollama pull qwen3:8b/);
  server.close();
});

test("health fails cleanly when Ollama is not running at all", async () => {
  // Nothing listening on this port.
  withEnv(59_999);
  const result = await client().health();
  assert.equal(result.ok, false);
  assert.match(result.reason, /not reachable/);
});

test("a completion comes back as text", async () => {
  const { server, port } = await startStub((req, res) => {
    res.end(chatReply("Hello from the model."));
  });
  withEnv(port);
  assert.equal(await client().complete({ prompt: "hi" }), "Hello from the model.");
  server.close();
});

test("JSON wrapped in prose or a fence is still read", async () => {
  // What reasoning models actually do, however firmly they are asked not to.
  const wrapped = 'Here is the analysis you asked for:\n```json\n{"sentiment":"positive","score":4}\n```\nHope that helps.';
  const { server, port } = await startStub((req, res) => res.end(chatReply(wrapped)));
  withEnv(port);
  assert.deepEqual(await client().completeJson({ prompt: "x" }), { sentiment: "positive", score: 4 });
  server.close();
});

test("nested braces and braces inside strings do not confuse the extractor", async () => {
  const nested = '{"a":{"b":[1,2]},"note":"a } inside a string","c":true}';
  const { server, port } = await startStub((req, res) => res.end(chatReply(`thinking...\n${nested}`)));
  withEnv(port);
  const out = await client().completeJson({ prompt: "x" });
  assert.deepEqual(out, { a: { b: [1, 2] }, note: "a } inside a string", c: true });
  server.close();
});

test("unparseable output is an error, never a silent empty object", async () => {
  const { server, port } = await startStub((req, res) => res.end(chatReply("I could not do that.")));
  withEnv(port);
  await assert.rejects(client().completeJson({ prompt: "x" }), (error) => {
    assert.equal(error.code, "AI_BAD_JSON");
    assert.equal(error.retryable, true);
    return true;
  });
  server.close();
});

test("a missing model is not retried", async () => {
  const { server, port } = await startStub((req, res) => {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "model 'qwen3:8b' not found" }));
  });
  withEnv(port);
  await assert.rejects(client().complete({ prompt: "x" }), (error) => {
    assert.equal(error.code, "AI_MODEL_MISSING");
    // Pulling a model is a person's job. Three attempts would only delay the work behind it.
    assert.equal(error.retryable, false);
    return true;
  });
  server.close();
});

test("a timeout is reported as a timeout and not retried", async () => {
  const { server, port } = await startStub(() => { /* never responds */ });
  withEnv(port, { timeoutMs: "300" });
  await assert.rejects(client().complete({ prompt: "x" }), (error) => {
    assert.equal(error.code, "AI_TIMEOUT");
    assert.equal(error.retryable, false);
    assert.equal(error.status, 504);
    return true;
  });
  server.close();
});

test("Ollama being down is retryable, a bad request is not", async () => {
  withEnv(59_999);
  await assert.rejects(client().complete({ prompt: "x" }), (error) => {
    assert.equal(error.code, "AI_UNAVAILABLE");
    assert.equal(error.retryable, true);
    return true;
  });

  const { server, port } = await startStub((req, res) => { res.statusCode = 400; res.end("bad"); });
  withEnv(port);
  await assert.rejects(client().complete({ prompt: "x" }), (error) => {
    assert.equal(error.retryable, false);
    return true;
  });
  server.close();
});

test("an empty answer is an error", async () => {
  const { server, port } = await startStub((req, res) => res.end(chatReply("   ")));
  withEnv(port);
  await assert.rejects(client().complete({ prompt: "x" }), (error) => {
    assert.equal(error.code, "AI_EMPTY");
    return true;
  });
  server.close();
});

test("the base URL is never hardcoded - it follows the environment", async () => {
  const { server, port } = await startStub((req, res) => res.end(chatReply("ok")));
  withEnv(port);
  assert.equal(client().config().baseUrl, `http://127.0.0.1:${port}`);
  process.env.OLLAMA_BASE_URL = "http://ollama.internal:11434/";
  // A trailing slash must not become a double slash in the path.
  assert.equal(client().config().baseUrl, "http://ollama.internal:11434");
  withEnv(port);
  server.close();
});

test("the streaming request is built without reaching for undefined config", async () => {
  /*
   * A real bug, and a nasty one: `completeStream` used `keepAlive` and `maxTokens` while
   * destructuring only `baseUrl` and `timeoutMs`, so building the request threw a ReferenceError
   * inside the try - which the catch reported as "the AI service is not running". Ollama was fine
   * the whole time.
   *
   * The request body is captured here rather than mocked loosely, so the next missing field fails
   * as a test rather than as a phantom outage.
   */
  const realFetch = global.fetch;
  let sent = null;
  global.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return {
      ok: true,
      body: (async function* () { yield Buffer.from(JSON.stringify({ message: { content: "hi" } }) + "\n"); })(),
    };
  };

  try {
    const answer = await client().completeStream({ prompt: "hello", model: "test-model" }, () => {});
    assert.strictEqual(answer, "hi");
  } finally {
    global.fetch = realFetch;
  }

  assert.strictEqual(sent.model, "test-model");
  assert.strictEqual(sent.stream, true);
  // The two that were undefined.
  assert.ok(sent.keep_alive, "keep_alive must be sent, or the model unloads and the next answer crawls");
  assert.ok(Number.isFinite(sent.options.num_predict), "num_predict must be a number");
});

test("a bug in this file is not reported as Ollama being down", async () => {
  const realFetch = global.fetch;
  // Not a TypeError - i.e. not a failure to reach the network.
  global.fetch = async () => { throw new RangeError("something wrong in here"); };
  try {
    await assert.rejects(
      () => client().completeStream({ prompt: "hello" }, () => {}),
      (error) => error instanceof RangeError,
      "a programming error must surface as itself",
    );
  } finally {
    global.fetch = realFetch;
  }
});
