const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
// Synchronous existence checks, used only while choosing an interpreter at startup.
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const ffmpegPath = require("ffmpeg-static");

/**
 * Turning a recording into timestamped text, on this server and at no per-minute cost.
 *
 * faster-whisper is a Python library, so it runs as a subprocess: `whisper.py` beside this file
 * prints JSON on stdout and the parsed result comes back here. Nothing is sent to a third party -
 * the audio never leaves the machine, which for recordings of client calls is worth more than the
 * accuracy an API would add.
 *
 * The same pattern the WhatsApp voice notes already use for ffmpeg: spawn, collect, time out, kill.
 */

const SCRIPT = path.join(__dirname, "whisper.py");
// Long enough for a twenty-minute call on a small CPU model, short enough that a wedged process is
// noticed the same day rather than holding a worker slot for ever.
const TRANSCRIBE_TIMEOUT_MS = Number(process.env.CALL_TRANSCRIBE_TIMEOUT_MS || 20 * 60 * 1000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.CALL_RECORDING_DOWNLOAD_TIMEOUT_MS || 120 * 1000);
// Callyzer's recordings are a few megabytes. The cap is what stops a wrong URL filling the disk.
const MAX_RECORDING_BYTES = Number(process.env.CALL_RECORDING_MAX_BYTES || 100 * 1024 * 1024);

/*
 * The interpreters worth trying, in order.
 *
 * `python3` on PATH is the obvious answer and it is not a reliable one. The PATH a server process
 * inherits is not the PATH of the shell somebody installed the package from - pm2 started at boot,
 * a systemd unit, a launcher that never read a profile, a pyenv shim that resolves differently under
 * a daemon. The symptom is this exact one: "faster-whisper is not installed" from a machine where
 * `python3 -c "import faster_whisper"` succeeds when you try it by hand.
 *
 * So the interpreter is chosen by asking each candidate whether it can actually import the package,
 * rather than by trusting the first one on the path. `PYTHON_BIN` still wins outright when set - an
 * explicit answer beats a search - and a virtualenv inside the project is preferred next, because
 * that is where a deployment would most sensibly put it.
 */
const PYTHON_CANDIDATES = [
  path.join(__dirname, "..", "..", "..", "..", ".venv", "bin", "python3"),
  path.join(__dirname, "..", "..", "..", "..", "venv", "bin", "python3"),
  "python3",
  "/usr/bin/python3",
  "/usr/local/bin/python3",
  "/opt/homebrew/bin/python3",
  "python",
];

/*
 * Resolved once per process.
 *
 * The search costs a spawn per candidate, which is nothing next to a transcription and far too much
 * to repeat per recording. `null` means "not looked yet"; a resolved value is kept even across
 * failures, because an interpreter that could import the package once still can.
 */
let resolvedPython = null;

/** Whether this interpreter can import faster-whisper. Never throws: a candidate either works or not. */
function canImport(bin) {
  const probe = spawnSync(bin, ["-c", "import faster_whisper"], { timeout: 20_000 });
  return probe.status === 0;
}

/**
 * The interpreter to run whisper.py with.
 *
 * Returns the first candidate that can import faster-whisper. If none can, it falls back to the
 * first that merely runs, so the failure reported is the honest one - "this interpreter exists and
 * does not have the package" rather than "no interpreter".
 */
function pythonBin() {
  if (resolvedPython) return resolvedPython;

  const configured = String(process.env.PYTHON_BIN || "").trim();
  // An explicit setting is obeyed without a search: if it is wrong, saying so is more use than
  // quietly using something else.
  if (configured) {
    resolvedPython = configured;
    return resolvedPython;
  }

  let firstThatRuns = null;
  for (const candidate of PYTHON_CANDIDATES) {
    if (candidate.includes(path.sep) && !fsSync.existsSync(candidate)) continue;
    const runs = spawnSync(candidate, ["--version"], { timeout: 10_000 }).status === 0;
    if (!runs) continue;
    if (!firstThatRuns) firstThatRuns = candidate;
    if (canImport(candidate)) {
      resolvedPython = candidate;
      console.log(`[transcripts] using ${candidate} for faster-whisper`);
      return resolvedPython;
    }
  }

  resolvedPython = firstThatRuns || "python3";
  return resolvedPython;
}

/** Tests and diagnostics: forget the resolved interpreter so the search runs again. */
function resetPythonBin() {
  resolvedPython = null;
}

/**
 * Whether transcription can actually run, checked once at boot.
 *
 * Said at startup rather than discovered on the first recording. A studio finds out today by making
 * a call, waiting for it to upload, and reading "faster-whisper is not installed" against a
 * recording they cannot get back - by which time the interesting question is which interpreter the
 * server used, and nothing has told them.
 *
 * Never throws and never blocks the boot: a server without transcription is a server that still runs
 * the CRM.
 */
function checkTranscriptionReady() {
  try {
    const bin = pythonBin();
    if (canImport(bin)) {
      console.log(`[transcripts] ready - faster-whisper available to ${bin}`);
      /*
       * Fetch the model now, in the background, rather than inside the first recording.
       *
       * `medium` is about 1.5GB and downloads on first use. That download happens *inside* the
       * transcription job, so the first call after a deploy sits at "Transcribing" for as long as
       * the network takes - which is exactly what it looks like when something is broken, and can
       * outlast the job timeout. Measured once: 257 seconds of which 235 were the download.
       *
       * Never awaited and never fatal: a server that cannot reach HuggingFace should still start,
       * and the job will simply pay the download itself as it used to.
       */
      const model = process.env.WHISPER_MODEL || "medium";
      const child = spawn(bin, ["-c", `from faster_whisper import WhisperModel; WhisperModel(${JSON.stringify(model)}, device="cpu", compute_type="int8")`], { stdio: "ignore" });
      child.on("close", (code) => {
        if (code === 0) console.log(`[transcripts] model "${model}" is cached and ready`);
        else console.warn(`[transcripts] could not pre-fetch model "${model}" - the first recording will download it`);
      });
      child.on("error", () => {});
      child.unref?.();
      return { ready: true, python: bin };
    }
    console.warn(
      `[transcripts] NOT READY - ${bin} cannot import faster-whisper. `
      + `Recordings will be stored but not transcribed. Install it with: ${bin} -m pip install faster-whisper`,
    );
    return { ready: false, python: bin };
  } catch (error) {
    console.warn("[transcripts] NOT READY -", error?.message || error);
    return { ready: false, python: "" };
  }
}

class TranscriptionError extends Error {
  constructor(code, message, { permanent = false } = {}) {
    super(message);
    this.code = code;
    // A permanent failure is not retried: a recording that 404s will 404 again in five minutes,
    // and burning three attempts on it only delays the calls behind it.
    this.permanent = permanent;
  }
}

/**
 * The recording, on local disk.
 *
 * Callyzer serves these over plain HTTPS with no auth. A URL that is missing, unreachable or not
 * audio is a permanent failure - there is nothing to retry into existence.
 */
async function downloadRecording(url, directory) {
  const target = String(url || "").trim();
  if (!target) throw new TranscriptionError("NO_RECORDING", "This call has no recording URL.", { permanent: true });
  if (!/^https?:\/\//i.test(target)) {
    throw new TranscriptionError("BAD_RECORDING_URL", "The recording URL is not http(s).", { permanent: true });
  }

  let response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: "follow" });
  } catch (error) {
    throw new TranscriptionError("DOWNLOAD_FAILED", `Could not fetch the recording: ${error.message}`);
  }
  if (!response.ok) {
    // 4xx is the provider saying the file is not there; 5xx may pass.
    const permanent = response.status >= 400 && response.status < 500;
    throw new TranscriptionError("DOWNLOAD_FAILED", `The recording responded ${response.status}.`, { permanent });
  }

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RECORDING_BYTES) {
    throw new TranscriptionError("RECORDING_TOO_LARGE", `The recording is ${declared} bytes.`, { permanent: true });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new TranscriptionError("EMPTY_RECORDING", "The recording is empty.", { permanent: true });
  if (buffer.length > MAX_RECORDING_BYTES) {
    throw new TranscriptionError("RECORDING_TOO_LARGE", `The recording is ${buffer.length} bytes.`, { permanent: true });
  }

  const file = path.join(directory, `recording${path.extname(new URL(target).pathname) || ".mp3"}`);
  await fs.writeFile(file, buffer, { mode: 0o600 });
  return file;
}

/**
 * 16 kHz mono WAV, which is what Whisper wants.
 *
 * Handing it an MP3 works, but it decodes internally anyway; doing it here with the ffmpeg the
 * project already ships means one predictable format going in and no surprise on a codec Python
 * happens not to have.
 */
function toWav(input, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      "-i", input,
      "-ac", "1", "-ar", "16000",
      "-c:a", "pcm_s16le",
      "-y", output,
    ]);
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), DOWNLOAD_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(new TranscriptionError("FFMPEG_FAILED", error.message)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(output);
      // A file ffmpeg cannot read is not audio, and will not become audio on a retry.
      return reject(new TranscriptionError("FFMPEG_FAILED", stderr.slice(0, 400) || `ffmpeg exited ${code}`, { permanent: true }));
    });
  });
}

function runWhisper(audioPath, modelOverride) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), [
      SCRIPT,
      "--audio", audioPath,
      /*
       * `medium`, not `small`, and the difference is not subtle.
       *
       * Measured on 25 seconds of Tamil whose content was known. `small` returned "I am here to talk
       * to you about your child's pregnancy" and "I am Kairam Rubak" - not a poor translation, a
       * wrong one, about things nobody said. `medium` returned "There is a fee to take your child's
       * picture" and "4000 rupees", which is the call.
       *
       * It costs about three times the time: 9s against 22s here, and 11s against 31s when limited
       * to two cores, which is what the production box has. Roughly real-time either way, and a
       * transcript nobody can trust is not worth the seconds it saves.
       */
      "--model", modelOverride || process.env.WHISPER_MODEL || "medium",
      "--language", process.env.WHISPER_LANGUAGE || "auto",
      // Translate by default: the CRM reads English whatever language the call was held in.
      // Set WHISPER_TASK=transcribe to keep the spoken language instead.
      "--task", process.env.WHISPER_TASK || "translate",
      "--compute-type", process.env.WHISPER_COMPUTE_TYPE || "int8",
    ]);

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TRANSCRIBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      // No interpreter at all: worth saying plainly, because it is a setup step and not a bug.
      reject(new TranscriptionError("PYTHON_MISSING", `Could not run ${pythonBin()}: ${error.message}`, { permanent: true }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        return reject(new TranscriptionError("WHISPER_FAILED", stderr.slice(0, 400) || `whisper exited ${code}`));
      }
      let parsed;
      try { parsed = JSON.parse(stdout.trim().split("\n").pop()); } catch {
        return reject(new TranscriptionError("WHISPER_BAD_OUTPUT", stdout.slice(0, 300) || "No JSON from whisper.py"));
      }
      if (parsed.error) {
        return reject(new TranscriptionError(parsed.error, parsed.message || "Transcription failed.", {
          permanent: parsed.error === "FASTER_WHISPER_MISSING",
        }));
      }
      return resolve(parsed);
    });
  });
}

/**
 * A recording, transcribed into timestamped segments.
 *
 * Everything happens inside one temporary directory that is removed whatever the outcome: these
 * are recordings of client conversations and they have no business staying on disk after the text
 * has been stored.
 */
async function transcribeRecording(recordingUrl) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `dbs-call-${crypto.randomBytes(6).toString("hex")}-`));
  try {
    const downloaded = await downloadRecording(recordingUrl, directory);
    const wav = await toWav(downloaded, path.join(directory, "audio.wav"));
    const result = await runWhisper(wav);
    const task = process.env.WHISPER_TASK || "translate";
    return {
      // The task is part of what produced this text, so it belongs in the provider string: a
      // transcript made a year ago in translate mode should not be mistaken for a native one.
      provider: `faster-whisper:${process.env.WHISPER_MODEL || "small"}:${task}`,
      // The language Whisper *heard*. Under translate the text itself is English, so this is what
      // lets the panel say "translated from Tamil" instead of implying the call was in English.
      language: result.language || "",
      translated: task === "translate" && Boolean(result.language) && result.language !== "en",
      durationSeconds: Number(result.durationSeconds) || 0,
      segments: Array.isArray(result.segments) ? result.segments : [],
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Transcribes a file already on disk.
 *
 * The same two steps `transcribeRecording` uses - ffmpeg to 16kHz mono, then whisper - without the
 * download, because the caller already has the audio. Written so the assistant's voice input goes
 * through the studio's own transcription rather than a browser speech service: the Web Speech API
 * would send whatever somebody dictates about a client to Google, which is the one thing this whole
 * system has been built to avoid.
 *
 * The caller owns the file and is responsible for removing it.
 */
async function transcribeAudioFile(inputPath, directory, { model } = {}) {
  const wav = await toWav(inputPath, path.join(directory, "voice.wav"));
  /*
   * A smaller model for dictation than for a call recording.
   *
   * `small` takes about nine seconds on a few words here, which is far too long to sit with a
   * microphone open; `base` is a second or two and easily good enough for a question somebody is
   * about to read back and correct before sending. A call recording is transcribed once, in the
   * background, and keeps the better model.
   */
  const result = await runWhisper(wav, model || process.env.WHISPER_VOICE_MODEL || "base");

  /*
   * Whisper returns segments, not a single string.
   *
   * There is no top-level `text` field - reading one gave an empty transcript for a clip that had
   * transcribed perfectly well.
   */
  const text = (Array.isArray(result.segments) ? result.segments : [])
    .map((segment) => String(segment.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    text,
    // What whisper heard, which is not the language of the text - under translate that is English.
    language: result.language || "",
    durationSeconds: Number(result.durationSeconds) || 0,
  };
}

module.exports = { transcribeRecording, transcribeAudioFile, pythonBin, resetPythonBin, checkTranscriptionReady, TranscriptionError };
