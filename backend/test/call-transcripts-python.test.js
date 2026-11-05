const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const transcriber = require("../src/modules/sales/call-transcripts/transcriber");

/**
 * Choosing the interpreter that runs faster-whisper.
 *
 * The bug this exists for: transcripts failed with "faster-whisper is not installed" on a machine
 * where `python3 -c "import faster_whisper"` succeeded when typed by hand. The PATH a server process
 * inherits is not the PATH of the shell somebody installed from - pm2 at boot, a systemd unit, a
 * pyenv shim - so trusting the first `python3` on the path is trusting the wrong thing.
 */

test.beforeEach(() => transcriber.resetPythonBin());
test.after(() => { delete process.env.PYTHON_BIN; transcriber.resetPythonBin(); });

test("an explicit PYTHON_BIN is obeyed without a search", () => {
  /*
   * Obeyed even when it is wrong, deliberately. Somebody who set it wants that interpreter, and
   * quietly using a different one would hide their mistake behind an error about something else.
   */
  process.env.PYTHON_BIN = "/nonexistent/python3";
  assert.strictEqual(transcriber.pythonBin(), "/nonexistent/python3");
  delete process.env.PYTHON_BIN;
});

test("the chosen interpreter can actually import faster-whisper", () => {
  delete process.env.PYTHON_BIN;
  const bin = transcriber.pythonBin();
  assert.ok(bin, "an interpreter should be chosen");

  const probe = spawnSync(bin, ["-c", "import faster_whisper"], { timeout: 30_000 });
  if (probe.status !== 0) {
    /*
     * Not a failure of the search - it is the honest answer on a machine where no interpreter has
     * the package. The point of the search is that it picks a working one when one exists, and the
     * readiness check below is what reports the case where none does.
     */
    assert.strictEqual(transcriber.checkTranscriptionReady().ready, false);
    return;
  }
  assert.strictEqual(transcriber.checkTranscriptionReady().ready, true);
});

test("the result is cached rather than searched per recording", () => {
  delete process.env.PYTHON_BIN;
  const first = transcriber.pythonBin();
  const second = transcriber.pythonBin();
  assert.strictEqual(first, second);
});

test("the readiness check never throws, whatever is configured", () => {
  process.env.PYTHON_BIN = "/nonexistent/python3";
  transcriber.resetPythonBin();
  // A server without transcription is a server that still runs the CRM.
  assert.doesNotThrow(() => transcriber.checkTranscriptionReady());
  assert.strictEqual(transcriber.checkTranscriptionReady().ready, false);
  delete process.env.PYTHON_BIN;
});

test("a missing package is reported with the interpreter and the install command", (t) => {
  /*
   * The message somebody actually has to act on. "faster-whisper is not installed" sends them to
   * install a package that is usually already installed - for a different interpreter.
   */
  const script = path.join(__dirname, "..", "src", "modules", "sales", "call-transcripts", "whisper.py");
  const probe = spawnSync(process.execPath, ["-e", "0"]);
  assert.strictEqual(probe.status, 0, "sanity");

  // `-S` skips site-packages, so the import fails on an interpreter that otherwise has the package.
  // Windows installs Python 3 as `python`; the server, and macOS, as `python3`.
  const python = process.platform === "win32" ? "python" : "python3";
  const out = spawnSync(python, ["-S", script, "--audio", "/dev/null"], { encoding: "utf8", timeout: 30_000 });
  // No Python at all - absent, or Windows' Microsoft Store alias (exit 9009), which runs nothing.
  if (out.error?.code === "ENOENT" || out.status === 9009) return t.skip(`${python} is not installed`);
  const line = (out.stdout || "").trim().split("\n").pop();
  const parsed = JSON.parse(line);
  assert.strictEqual(parsed.error, "FASTER_WHISPER_MISSING");
  assert.match(parsed.message, /python/i, "the message should name the interpreter");
  assert.match(parsed.message, /pip install faster-whisper/, "and the command that fixes it");
  assert.ok(parsed.python, "and report it as a field");
});

const { assignSpeakers, EMPLOYEE, CLIENT, UNKNOWN } = require("../src/modules/sales/call-transcripts/speakers");

/**
 * Who said which line.
 *
 * The bug these come from reached a user: every line of a two-person call was labelled EMPLOYEE, so
 * a conversation read as a monologue and there was no way to tell who had said what.
 */

/** The gaps measured from a real two-speaker recording: VAD splits on 500ms, turns land at 500-600. */
const REAL_CALL = [
  { startMs: 0, endMs: 3200, text: "Hello, this is Ravi from the studio." },
  { startMs: 3700, endMs: 5200, text: "Yes, tell me." },
  { startMs: 5700, endMs: 9000, text: "We have an offer for a newborn shoot." },
  { startMs: 9600, endMs: 10800, text: "What is the price?" },
];

test("a two-person call is not attributed to one person", () => {
  const turns = assignSpeakers(REAL_CALL, { callType: "outgoing" });
  const speakers = turns.map((turn) => turn.speaker);
  assert.deepStrictEqual(speakers, [EMPLOYEE, CLIENT, EMPLOYEE, CLIENT]);
  /*
   * The assertion that would have caught the original bug. A 1200ms threshold sat above every real
   * gap - 500 to 600ms - so nothing ever flipped.
   */
  assert.ok(new Set(speakers).size > 1, "a conversation must not read as a monologue");
});

test("an outgoing call opens with the employee, an incoming one with the client", () => {
  assert.strictEqual(assignSpeakers(REAL_CALL, { callType: "outgoing" })[0].speaker, EMPLOYEE);
  assert.strictEqual(assignSpeakers(REAL_CALL, { callType: "incoming" })[0].speaker, CLIENT);
});

test("an unknown direction names nobody rather than guessing", () => {
  // Half the lines wrong reads as fact; no label reads as no label.
  const turns = assignSpeakers(REAL_CALL, { callType: "" });
  assert.ok(turns.every((turn) => turn.speaker === UNKNOWN));
});

test("a configured gap threshold still applies", () => {
  /*
   * The escape hatch for a recording where one person talks at length with pauses in it - the case
   * where alternating on every boundary is the wrong answer.
   */
  const previous = process.env.CALL_TRANSCRIPT_TURN_GAP_MS;
  process.env.CALL_TRANSCRIPT_TURN_GAP_MS = "5000";
  delete require.cache[require.resolve("../src/modules/sales/call-transcripts/speakers")];
  const { assignSpeakers: strict } = require("../src/modules/sales/call-transcripts/speakers");
  const turns = strict(REAL_CALL, { callType: "outgoing" });
  assert.ok(turns.every((turn) => turn.speaker === EMPLOYEE), "no gap here reaches five seconds");

  if (previous === undefined) delete process.env.CALL_TRANSCRIPT_TURN_GAP_MS;
  else process.env.CALL_TRANSCRIPT_TURN_GAP_MS = previous;
  delete require.cache[require.resolve("../src/modules/sales/call-transcripts/speakers")];
});

test("an empty recording produces no turns rather than throwing", () => {
  assert.deepStrictEqual(assignSpeakers([], { callType: "outgoing" }), []);
  assert.deepStrictEqual(assignSpeakers(undefined, { callType: "outgoing" }), []);
});
