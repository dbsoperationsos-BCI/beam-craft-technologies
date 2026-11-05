const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { getBrowser, frontendOrigin } = require("../../../services/quotationPdfService");
const { previewKeyFor } = require("./service");

/*
 * An invitation as a video to download: the guest's own page, played - the doors opening, the
 * artwork moving in, the names coming one after another, then a slow scroll through the events -
 * with the client's ten seconds of song laid under it. An MP4 (H.264 + AAC), 720 x 1280 -
 * the size WhatsApp keeps videos and Status at, so nothing is lost when it is sent. 25 fps.
 *
 * Drawn frame by frame, not filmed: in the headless browser (the one the quotation PDF uses) every
 * animation on the page is held and moved on by exactly one frame, then photographed - so each lands
 * on every frame however busy the server is (a live recording dropped frames and stuttered). The page
 * is opened in its recording form (`?record=1`), where this, not a timer, says when the doors are open.
 * Laid out at a phone's width (where the invitation fills the screen) and photographed at
 * 1.5x, so it is sharp at full size.
 *
 * ffmpeg is `ffmpeg-static`'s binary, already used for voice notes. Videos are made one at a time and
 * kept for a while per invitation and per save.
 */

const VIEW_WIDTH = 480;
const VIEW_HEIGHT = 854;
const SCALE = 1.5;
const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 25;
const SECONDS = 10;
// When things happen, in frames: the doors are tapped open, then the page scrolls down the rest.
const OPEN_AT = Math.round(0.5 * FPS);
// The doors take 1.3 s to part (invitation.css); then the curtain is gone and the page is open.
const OPENED_AT = OPEN_AT + Math.round(1.4 * FPS);
const SCROLL_FROM = Math.round(5.6 * FPS);
const SCROLL_TO = Math.round(9.6 * FPS);
const KEEP_MS = 30 * 60 * 1000;
const MAX_KEPT = 8;
const MAX_SONG_BYTES = 12 * 1024 * 1024;
const kept = new Map();
let queue = Promise.resolve();

const ffmpegPath = () => {
  try {
    return require("ffmpeg-static") || "";
  } catch {
    return "";
  }
};

/** ffmpeg reading JPEG frames on its stdin; `{ write(buffer), done() }`. */
function encoder(args) {
  const child = spawn(ffmpegPath(), args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  const finished = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split("\n").slice(-3).join(" ")}`))));
  });
  // A frame ffmpeg cannot take yet waits for it, so memory never fills with frames.
  const write = (buffer) => (child.stdin.write(buffer) ? Promise.resolve() : new Promise((resolve) => child.stdin.once("drain", resolve)));
  const done = () => { child.stdin.end(); return finished; };
  // Given up on (the drawing failed): ffmpeg is stopped, and its own failure is not a second error.
  const abort = () => { finished.catch(() => {}); child.stdin.destroy(); child.kill("SIGKILL"); };
  return { write, done, abort };
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/** Plays the invitation one frame at a time, handing each frame (JPEG) to `frame`. */
async function drawFrames(token, frame) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(30000);
    // Drawn at 1.5x by the page itself - asking each screenshot to scale re-lays the page every frame.
    await page.setViewport({ width: VIEW_WIDTH, height: VIEW_HEIGHT, deviceScaleFactor: SCALE });
    // Everything it shows has arrived before the clock is stopped.
    // With a preview key: Download is free, even for an invitation not yet paid for.
    await page.goto(`${frontendOrigin()}/inv/${encodeURIComponent(token)}?record=1&k=${encodeURIComponent(previewKeyFor(token))}`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".inv-curtain", { timeout: 20000 });
    await page.evaluate(() => document.fonts?.ready);
    const scrollEnd = await page.evaluate(() => Math.max(0, Math.min(document.documentElement.scrollHeight - window.innerHeight, window.innerHeight * 1.6)));
    const cdp = await page.createCDPSession();
    // Each animation is held and moved on by exactly one frame here - a new one (a door, a word, a
    // section coming in) from its start.
    const advanceAnimations = () => page.evaluate((ms) => {
      for (const animation of document.getAnimations()) {
        if (!animation.invHeld) {
          animation.invHeld = true;
          animation.pause();
          animation.currentTime = 0;
        } else {
          animation.currentTime = (Number(animation.currentTime) || 0) + ms;
        }
      }
    }, 1000 / FPS);
    let scrolled = 0;
    for (let i = 0; i < SECONDS * FPS; i += 1) {
      if (i === OPEN_AT) await page.evaluate(() => document.querySelector(".inv-curtain")?.click());
      if (i === OPENED_AT) await page.evaluate(() => window.invitationOpened?.());
      if (i >= SCROLL_FROM && i <= SCROLL_TO) {
        scrolled = Math.round(scrollEnd * ease((i - SCROLL_FROM) / (SCROLL_TO - SCROLL_FROM)));
        await page.evaluate((y) => window.scrollTo(0, y), scrolled);
      }
      await advanceAnimations();
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 90,
        optimizeForSpeed: true,
      });
      await frame(Buffer.from(data, "base64"));
    }
  } finally {
    await page.close().catch(() => {});
  }
}

/** The song's file, fetched to `songPath`; false when there is none or it cannot be read. */
async function fetchSong(url, songPath) {
  if (!/^https?:\/\//i.test(url || "")) return false;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) return false;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_SONG_BYTES) return false;
  await fs.writeFile(songPath, bytes);
  return true;
}

async function make(token, song) {
  if (!ffmpegPath()) throw Object.assign(new Error("Video is not available on this server."), { status: 503 });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `invitation-${crypto.randomBytes(4).toString("hex")}-`));
  try {
    const audio = path.join(dir, "song");
    const mp4 = path.join(dir, "invitation.mp4");
    const withSong = song ? await fetchSong(song.url, audio).catch(() => false) : false;
    const args = ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0"];
    if (withSong) args.push("-ss", String(song.start || 0), "-t", String(SECONDS), "-i", audio);
    args.push(
      "-t", String(SECONDS),
      "-map", "0:v:0",
      ...(withSong ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "160k", "-af", `afade=t=in:d=0.6,afade=t=out:st=${SECONDS - 0.8}:d=0.8`] : ["-an"]),
      "-vf", `scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
      "-r", String(FPS),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-tune", "animation",
      "-movflags", "+faststart",
      mp4,
    );
    const video = encoder(args);
    try {
      await drawFrames(token, video.write);
    } catch (error) {
      video.abort();
      throw error;
    }
    await video.done();
    return await fs.readFile(mp4);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The invitation playing, as MP4 bytes. `version` (its last save) decides whether a kept one will do;
 * `song` is `{ url, start }` or null.
 */
function renderInvitationVideo(token, version, song) {
  const key = `${token}:${version}`;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return Promise.resolve(hit.mp4);
  // One at a time: a second download waits for the first rather than recording beside it.
  const run = queue.then(() => {
    const again = kept.get(key);
    if (again && Date.now() - again.at < KEEP_MS) return again.mp4;
    return make(token, song).then((mp4) => {
      kept.set(key, { mp4, at: Date.now() });
      while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
      return mp4;
    });
  });
  queue = run.catch(() => {});
  return run;
}

module.exports = { renderInvitationVideo };
