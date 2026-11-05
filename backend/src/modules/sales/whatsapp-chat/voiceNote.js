const { spawn } = require("child_process");

/**
 * Audio, in the one container WhatsApp will actually play.
 *
 * A voice note on WhatsApp is OGG/Opus. Nothing else is: the browser's MediaRecorder produces
 * `audio/webm` on Chrome and `audio/mp4` on Safari, and sending either of those as a voice note
 * gets it accepted by the server and then shown to the recipient as something they cannot play -
 * which is indistinguishable, from the sender's side, from it having worked.
 *
 * So it is converted here rather than hoped about. webm and ogg both carry Opus already, so for
 * the common case this is a remux rather than a re-encode - fast, and no quality is lost.
 *
 * ffmpeg comes from `ffmpeg-static`, a prebuilt binary in node_modules, so there is nothing to
 * install on the server and no system package to drift.
 */

// A recording is a message someone is waiting on, not a batch job. Better to send the original
// and have it arrive as a file than to hold the send open while a stuck process is waited for.
const CONVERT_TIMEOUT_MS = 20000;
// Voice notes are short. This is far above any real recording and well below anything that would
// hurt to hold in memory twice while converting.
const MAX_CONVERT_BYTES = 32 * 1024 * 1024;

function ffmpegPath() {
  try {
    // Resolved lazily so a server without the package still starts, and still sends audio - just
    // without the conversion.
    return require("ffmpeg-static") || "";
  } catch {
    return "";
  }
}

function isOggOpus(mimetype) {
  return /^audio\/(ogg|opus)/i.test(String(mimetype || ""));
}

/**
 * Converts audio to OGG/Opus, or answers null when it cannot.
 *
 * Null is a real answer rather than a failure: the caller sends what it already had, which is
 * better than sending nothing. Everything goes through stdin and stdout, so no temporary file is
 * written and a client's voice never touches this server's disk.
 */
function toOggOpus(buffer) {
  const binary = ffmpegPath();
  if (!binary || !buffer?.length || buffer.length > MAX_CONVERT_BYTES) return Promise.resolve(null);

  /*
   * Spawned rather than exec'd, because the audio has to be written to its stdin.
   *
   * `execFile` has no `input` option - that belongs to the synchronous variants - so handing it
   * one left ffmpeg reading an stdin that never produced anything and never closed, and the call
   * hung until it was killed. The pipe is fed and then ended explicitly here, which is the whole
   * difference.
   */
  return new Promise((resolve) => {
    const child = spawn(binary, [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      // Mono at 48kHz is what a voice note is, and what keeps it small.
      "-vn", "-ac", "1", "-ar", "48000",
      "-c:a", "libopus", "-b:a", "32k",
      "-f", "ogg", "pipe:1",
    ]);

    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (result, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result && why) {
        // Named rather than swallowed: a conversion that keeps failing is why recipients would
        // stop being able to play voice notes, and that should be in the log before they complain.
        console.warn("[whatsapp] Voice note conversion failed, sending the original:", why);
      }
      resolve(result);
    };

    // A recording is a message someone is waiting on. A stuck process must not hold the send open.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null, "timed out");
    }, CONVERT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_CONVERT_BYTES) {
        child.kill("SIGKILL");
        finish(null, "output too large");
        return;
      }
      chunks.push(chunk);
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-400); });
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => {
      if (code === 0 && chunks.length) finish(Buffer.concat(chunks), "");
      else finish(null, stderr.trim() || `ffmpeg exited with ${code}`);
    });

    // Feeding stdin can fail on its own if ffmpeg rejects the input and closes early - that is a
    // refusal, not a crash, and the close handler above reports it.
    child.stdin.on("error", () => {});
    child.stdin.end(buffer);
  });
}

/**
 * The audio to send, and whether it may go as a voice note.
 *
 * Only OGG/Opus is ever marked `ptt`. Anything that could not be converted is sent as an ordinary
 * audio message, which WhatsApp shows as a playable file for the containers it understands and as
 * an attachment otherwise - either way it arrives, which is the part that was failing.
 */
async function prepareAudio(buffer, mimetype, { voice = false } = {}) {
  if (isOggOpus(mimetype)) return { buffer, mimetype: "audio/ogg; codecs=opus", ptt: voice };

  const converted = await toOggOpus(buffer);
  if (converted) return { buffer: converted, mimetype: "audio/ogg; codecs=opus", ptt: voice };

  return { buffer, mimetype: String(mimetype || "audio/mpeg"), ptt: false };
}

module.exports = { prepareAudio, toOggOpus, isOggOpus, ffmpegPath };
