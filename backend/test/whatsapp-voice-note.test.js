const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const voice = require("../src/modules/sales/whatsapp-chat/voiceNote");

/*
 * Voice notes have to be OGG/Opus.
 *
 * Nothing else is playable as one. The browser's MediaRecorder gives `audio/webm` on Chrome and
 * `audio/mp4` on Safari, and sending either as a voice note got it accepted by WhatsApp and then
 * shown to the recipient as something they could not play - which, from the sender's side, looked
 * exactly like success. These tests hold the conversion that fixes it, and hold the rule that
 * nothing unconverted is ever marked as a voice note.
 */

// A second of silence in whatever container ffmpeg is asked for, so the tests exercise real audio
// rather than bytes that merely claim to be.
function synth(format, codec) {
  // mp4 cannot be written to a pipe without fragmenting it - the muxer needs to seek back and
  // write the index otherwise, and simply hangs.
  const extra = format === "mp4" ? ["-movflags", "frag_keyframe+empty_moov"] : [];
  return execFileSync(
    voice.ffmpegPath(),
    ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
      "-t", "1", "-c:a", codec, ...extra, "-f", format, "pipe:1"],
    { maxBuffer: 8 * 1024 * 1024, timeout: 15000 },
  );
}

// The container's own signature, read from the bytes rather than from what we were told.
function container(buffer) {
  if (buffer.subarray(0, 4).toString() === "OggS") return "ogg";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "webm";
  if (buffer.subarray(4, 8).toString() === "ftyp") return "mp4";
  return "unknown";
}

test("ffmpeg is available, so conversion is possible at all", () => {
  // Bundled through ffmpeg-static rather than installed on the server, so this holds on any box
  // the app is deployed to.
  assert.ok(voice.ffmpegPath(), "no ffmpeg binary was resolved");
});

test("a Chrome recording is converted to OGG/Opus", async () => {
  const webm = synth("webm", "libopus");
  assert.equal(container(webm), "webm", "the fixture itself should be webm");

  const prepared = await voice.prepareAudio(webm, "audio/webm;codecs=opus", { voice: true });
  assert.equal(container(prepared.buffer), "ogg", "a voice note must leave here as OGG");
  assert.match(prepared.mimetype, /^audio\/ogg/);
  assert.equal(prepared.ptt, true, "a converted recording may be sent as a voice note");
});

test("a Safari recording is converted too", async () => {
  const mp4 = synth("mp4", "aac");
  assert.equal(container(mp4), "mp4", "the fixture itself should be mp4");

  const prepared = await voice.prepareAudio(mp4, "audio/mp4", { voice: true });
  assert.equal(container(prepared.buffer), "ogg");
  assert.equal(prepared.ptt, true);
});

test("audio that is already OGG/Opus is passed straight through", async () => {
  const ogg = synth("ogg", "libopus");
  const prepared = await voice.prepareAudio(ogg, "audio/ogg; codecs=opus", { voice: true });
  // Not re-encoded: the bytes are handed on exactly as they arrived.
  assert.ok(prepared.buffer.equals(ogg), "already-correct audio should not be touched");
  assert.equal(prepared.ptt, true);
});

test("an uploaded audio file is not turned into a voice note", async () => {
  // The file picker, not the microphone. Someone attaching a song did not record it, and
  // inferring this from the mime type made every uploaded .ogg a voice note.
  const ogg = synth("ogg", "libopus");
  const prepared = await voice.prepareAudio(ogg, "audio/ogg", { voice: false });
  assert.equal(prepared.ptt, false);
});

test("audio that cannot be converted is still sent, just not as a voice note", async () => {
  // The failure that must never be silent: ffmpeg refuses, and the message still has to arrive.
  const notAudio = Buffer.from("this is not audio at all");
  const prepared = await voice.prepareAudio(notAudio, "audio/webm", { voice: true });
  assert.ok(prepared.buffer.equals(notAudio), "the original must still be sent");
  assert.equal(prepared.ptt, false, "unconverted audio must never be marked as a voice note");
});

test("only real OGG/Opus counts as already correct", () => {
  assert.equal(voice.isOggOpus("audio/ogg; codecs=opus"), true);
  assert.equal(voice.isOggOpus("audio/ogg"), true);
  assert.equal(voice.isOggOpus("audio/webm;codecs=opus"), false, "webm carries Opus but is not OGG");
  assert.equal(voice.isOggOpus("audio/mp4"), false);
  assert.equal(voice.isOggOpus(""), false);
});
