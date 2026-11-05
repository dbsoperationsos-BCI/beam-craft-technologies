const puppeteer = require("puppeteer");

/**
 * Turns the client-facing quotation page into a PDF.
 *
 * The page at `/q/<token>` is the template. Rather than describing the same layout a second time
 * in a PDF library - which would drift from the web page the first time either was edited - this
 * loads that very URL in a headless browser and prints it. What the client reads online and what
 * they are sent as a file are the same document by construction.
 *
 * `?print=1` tells the page it is being printed: it drops the download button and the grey
 * surround, leaving the white sheet alone on the paper.
 */

const NAVIGATION_TIMEOUT_MS = 30_000;

/*
 * Where the page has got to, which is what this waits for.
 *
 * `PublicQuotationPage` carries `data-quotation-state` on every state it settles in - `ready` on
 * the laid-out document, `expired` and `error` on the two it cannot print - and on the one state it
 * does not settle in, "Loading quotation…", it carries nothing. So the attribute appearing means
 * the page is finished, and its value says whether there is a quotation to print.
 */
const STATE_SELECTOR = "[data-quotation-state]";

/** The width the client's copy is designed at, in CSS pixels; the PDF is exactly this wide. */
const SHEET_WIDTH_PX = 1080;

/*
 * One browser for the process, started on first use.
 *
 * Launching Chromium costs roughly a second and a good deal of memory; a studio sending several
 * quotations in a row would pay it every time. Pages are cheap, so each request opens and closes
 * a page against the one browser. `launching` holds the in-flight promise so two requests
 * arriving together share a launch rather than starting two browsers.
 */
let browser = null;
let launching = null;

function frontendOrigin() {
  return String(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
}

async function getBrowser() {
  if (browser?.connected) return browser;
  if (!launching) {
    launching = puppeteer
      .launch({
        headless: true,
        // Chromium's sandbox needs kernel privileges a container or a plain VPS user often does
        // not have, and this browser only ever loads our own page.
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      })
      .then((instance) => {
        browser = instance;
        // A crashed browser must not be handed out again: clearing it here means the next
        // request launches a fresh one instead of failing forever.
        instance.on("disconnected", () => { browser = null; });
        return instance;
      })
      .finally(() => { launching = null; });
  }
  return launching;
}

/** Renders one quotation and resolves to the PDF bytes. */
async function renderQuotationPdf(token) {
  const instance = await getBrowser();
  const page = await instance.newPage();
  try {
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    const url = `${frontendOrigin()}/q/${encodeURIComponent(token)}?print=1`;
    // Print colours as designed, and set before the page loads so it is laid out once rather than
    // rendered for the screen and then reflowed for paper.
    await page.emulateMediaType("print");
    /*
     * Wait for the document, not for the network to go quiet.
     *
     * This was `networkidle0`, which asks a different question - "has nothing been fetched for
     * 500ms" - and answered it wrong in both directions. Quiet arrives *before* the page has asked
     * for the quotation as easily as after, so a PDF could be printed of the "Loading quotation…"
     * state; and anything holding a connection open - a dev server's hot-reload socket, a poll -
     * means quiet never comes and the render waits out its whole thirty-second timeout.
     *
     * The page says when it is ready instead. `domcontentloaded` gets us to a page that can run,
     * the selector waits for the laid-out quotation, and the images below are waited for by name.
     */
    // The design is laid out for a 1080px sheet, which is what the page is asked to be before it
    // renders; the PDF below is cut to exactly that width.
    await page.setViewport({ width: SHEET_WIDTH_PX, height: 1400, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const settled = await page.waitForSelector(STATE_SELECTOR, { timeout: NAVIGATION_TIMEOUT_MS });
    const state = await settled.evaluate((node) => node.getAttribute("data-quotation-state"));
    /*
     * A page that settled on something other than the quotation is an error here, not a PDF.
     *
     * The endpoint refuses an expired link before it ever gets this far, so reaching either of
     * these means something is actually wrong - the API unreachable from the renderer, most
     * likely - and the honest answer is a failed download rather than a file that says
     * "Failed to fetch" where a client expects a price.
     */
    if (state !== "ready") {
      const detail = await page.evaluate(() => document.body.innerText.trim().slice(0, 200));
      throw Object.assign(new Error(`The quotation page could not be printed (${state}): ${detail}`), { pageState: state });
    }
    await waitForRenderedAssets(page);
    /*
     * One page, as tall as the document.
     *
     * The client's copy is a continuous sheet - a cover photograph, the proposal, the events, the
     * pricing, the studio's story, the infrastructure collage and a closing photograph - and cut
     * into A4 pages it broke a card wherever a page ended. Measured after the pictures have
     * arrived, because they are what decides the height. `pageRanges` guards against the one
     * extra blank page a fractional height can produce.
     */
    const height = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)));
    return await page.pdf({
      width: `${SHEET_WIDTH_PX}px`,
      height: `${height + 2}px`,
      printBackground: true,
      preferCSSPageSize: false,
      pageRanges: "1",
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * The pictures and the type, which are what a PDF prints wrong if it does not wait.
 *
 * Only the images actually on the page and only the ones still loading - the logo, in practice.
 * A blanket wait for the network would be back to `networkidle0`; this asks the document what it is
 * still missing, and stops as soon as it has it. `document.fonts.ready` is the same question for
 * the type: a heading printed mid-swap is a heading in the wrong face.
 *
 * Given its own timeout so a logo the studio's storage is slow to hand over delays the PDF by two
 * seconds rather than failing it - a quotation with an unfetched image still prints correctly in
 * every other respect.
 */
const ASSET_TIMEOUT_MS = 2_000;

async function waitForRenderedAssets(page) {
  await page.evaluate((timeout) => {
    const images = Array.from(document.images)
      .filter((image) => !image.complete)
      .map((image) => new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }));
    const settled = Promise.all([...images, document.fonts?.ready].filter(Boolean));
    return Promise.race([settled, new Promise((resolve) => { setTimeout(resolve, timeout); })]);
  }, ASSET_TIMEOUT_MS).catch(() => {});
}

/**
 * Starts the shared browser before anybody asks for a PDF.
 *
 * Called at boot so the launch - about a second - is not paid by the first download of the day.
 * Resolves either way; a host that cannot run Chromium is reported by the download that needs it,
 * not by refusing to start the server.
 */
async function warmQuotationPdfBrowser() {
  await getBrowser();
}

/** Closes the shared browser, so a shutting-down process does not leave Chromium running. */
async function closeQuotationPdfBrowser() {
  const instance = browser;
  browser = null;
  if (instance) await instance.close().catch(() => {});
}

module.exports = { renderQuotationPdf, warmQuotationPdfBrowser, closeQuotationPdfBrowser };
