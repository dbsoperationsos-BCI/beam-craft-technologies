const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const share = require("./signatureAlbum.share.service");
const { httpError } = require("./signatureAlbum.helpers");
const { LIMITS, PRINT_SESSION_TTL } = require("./signatureAlbum.constants");

/*
 * Download Album: the whole designed album as one PDF.
 *
 * The client's own page is the template, as the quotation's is: rather than describing the album a
 * second time in a PDF library - which would drift from the page the first time either changed -
 * the shared headless browser (`quotationPdfService`) opens the album's print view,
 * `/a/<code>/print`, and prints it. That view is `SignatureAlbumView` with every photo loaded and no
 * controls, so the cover and its crop, the design, the layouts, the order and the ending in the PDF
 * are the saved album's by construction. The photos are the web previews the page already shows;
 * no original is ever read.
 *
 * The print view opens the album with a session of its own, minted here for minutes and handed to
 * it in the URL's fragment, so it reads the album through the same public API the client does and
 * the token never reaches a server log. It says when every photo and font has arrived by setting
 * `data-album-print-state` on its root, which is what the render waits for.
 *
 * A large album takes a while, longer than a proxy holds a request open, so the PDF is built in the
 * background to a temporary file: `start` begins it (or joins the one already building for that
 * album), `status` answers how it is going, and `open` hands the finished file to the download.
 * One album renders once however many times it is asked for, a few render at once in all, and a
 * file is deleted once it is old or the album has changed since.
 */
const PAGE_WIDTH_PX = 1440;
// A4 landscape's shape at that width, so the cover fills the first page exactly.
const PAGE_HEIGHT_PX = 1018;
const STATE_SELECTOR = "[data-album-print-state]";

function frontendOrigin() {
  return String(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Prints one album's print view to `file`. */
async function renderWithBrowser(album, file) {
  const { getBrowser } = require("../../../services/quotationPdfService");
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(LIMITS.PDF_RENDER_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(LIMITS.PDF_RENDER_TIMEOUT_MS);
    await page.setViewport({ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX, deviceScaleFactor: 1 });
    const session = share.signSession(album.shortCode, album.id, { expiresIn: PRINT_SESSION_TTL });
    await page.goto(`${frontendOrigin()}/a/${encodeURIComponent(album.shortCode)}/print#session=${encodeURIComponent(session)}`, { waitUntil: "domcontentloaded" });
    const settled = await page.waitForSelector(STATE_SELECTOR, { timeout: LIMITS.PDF_RENDER_TIMEOUT_MS });
    const state = await settled.evaluate((node) => node.getAttribute("data-album-print-state"));
    if (state !== "ready") {
      const detail = await page.evaluate(() => document.body.innerText.trim().slice(0, 200));
      throw new Error(`The album's print view could not be printed (${state}): ${detail}`);
    }
    const stream = await page.createPDFStream({
      width: `${PAGE_WIDTH_PX}px`,
      height: `${PAGE_HEIGHT_PX}px`,
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      timeout: LIMITS.PDF_RENDER_TIMEOUT_MS,
    });
    // Written as it arrives, so a long album is never held whole in this process's memory.
    await pipeline(Readable.fromWeb(stream), fs.createWriteStream(file));
  } finally {
    await page.close().catch(() => {});
  }
}

function createSignatureAlbumPdfService(dependencies = {}) {
  const render = dependencies.render || renderWithBrowser;
  const files = dependencies.fs || fs;
  const dir = dependencies.dir || path.join(os.tmpdir(), "signature-album-pdf");
  const now = dependencies.now || Date.now;
  const log = dependencies.log || console;
  // albumId -> { version, state: "rendering" | "ready" | "failed", file, finishedAt }
  const jobs = new Map();
  let rendering = 0;

  // A PDF belongs to the album as it was saved when it was printed; an edit since makes it stale.
  const versionOf = (album) => new Date(album.updatedAt || 0).getTime();
  const remove = (file) => { if (file) files.promises.rm(file, { force: true }).catch(() => {}); };

  function sweep() {
    for (const [albumId, job] of jobs) {
      if (job.state !== "rendering" && now() - job.finishedAt > LIMITS.PDF_KEEP_MS) { jobs.delete(albumId); remove(job.file); }
    }
  }

  function status(album) {
    const job = jobs.get(album.id);
    if (!job || (job.state !== "rendering" && job.version !== versionOf(album))) return { status: "idle" };
    return { status: job.state === "rendering" ? "preparing" : job.state };
  }

  function start(album) {
    sweep();
    const current = jobs.get(album.id);
    // Already building, or built from the album as it is now: join it rather than print twice.
    if (current && (current.state === "rendering" || (current.state === "ready" && current.version === versionOf(album)))) return status(album);
    if (rendering >= LIMITS.PDF_MAX_RENDERING) throw httpError(429, "Other albums are being prepared right now. Please try again in a minute.");
    if (current) remove(current.file);
    const job = { version: versionOf(album), state: "rendering", file: path.join(dir, `${album.id}-${crypto.randomBytes(8).toString("hex")}.pdf`), finishedAt: 0 };
    jobs.set(album.id, job);
    rendering += 1;
    (async () => {
      try {
        await files.promises.mkdir(dir, { recursive: true });
        await render(album, job.file);
        job.state = "ready";
      } catch (error) {
        log.error("Unable to prepare the Signature Album PDF:", error);
        job.state = "failed";
        remove(job.file);
        job.file = null;
      } finally {
        rendering -= 1;
        job.finishedAt = now();
      }
    })();
    return status(album);
  }

  /** The finished PDF, for the download; refused unless it is ready and still the album's. */
  function open(album) {
    const job = jobs.get(album.id);
    if (!job || job.state !== "ready" || job.version !== versionOf(album)) throw httpError(409, "The album is not ready to download yet. Please press Download Album again.");
    return files.createReadStream(job.file);
  }

  return { start, status, open, sweep };
}

// One for the process: the jobs are shared by every request, and the files are swept on a timer.
// The jobs live in memory, so a file left by an earlier run of the process belongs to no job and
// would never be swept: the folder is emptied once, before this run writes anything to it.
let shared = null;
function sharedPdfService() {
  if (!shared) {
    const dir = path.join(os.tmpdir(), "signature-album-pdf");
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    shared = createSignatureAlbumPdfService({ dir });
    const timer = setInterval(() => shared.sweep(), 10 * 60 * 1000);
    timer.unref?.();
  }
  return shared;
}

module.exports = { createSignatureAlbumPdfService, sharedPdfService, renderWithBrowser, PAGE_WIDTH_PX, PAGE_HEIGHT_PX };
