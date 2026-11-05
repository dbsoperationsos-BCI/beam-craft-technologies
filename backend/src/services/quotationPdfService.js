const puppeteer = require("puppeteer");
const { installPdfImageCompression } = require("./pdfImageCompression");

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
async function renderQuotationPdf(token, { printPass } = {}) {
  const instance = await getBrowser();
  const page = await instance.newPage();
  try {
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    // A client portal download of a lapsed quotation: the page's API calls carry the one-time pass
    // (`services/quotationPrintPass.js`) so the quotation still loads for this render.
    if (printPass) await page.setExtraHTTPHeaders({ "x-quotation-print-pass": printPass });
    const url = `${frontendOrigin()}/q/${encodeURIComponent(token)}?print=1`;
    // Print colours as designed, and set before the page loads so it is laid out once rather than
    // rendered for the screen and then reflowed for paper.
    await page.emulateMediaType("print");
    // Its photographs as JPEG sized for the sheet, so the PDF stays small - see pdfImageCompression.
    await installPdfImageCompression(page);
    // Counted from the first request, so a picture asked for before the document settles is waited for.
    const pendingImages = trackImageRequests(page);
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
    await waitForRenderedAssets(page, pendingImages);
    await dropBlurredShadows(page);
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

/*
 * Every picture the page has asked for and not yet been handed, `<img>` and CSS background alike.
 *
 * Asked of the network rather than of the document because `document.images` cannot see a
 * background (the India map), and because each picture now passes through `pdfImageCompression`
 * first - a fetch and a JPEG encode, three at a time - so the document can be ready seconds before
 * its pictures are. A failed request leaves the set too: it is answered, if not well. Only web
 * addresses are counted, as `pdfImageCompression` only converts those: a `data:` picture is already
 * in the page.
 */
function trackImageRequests(page) {
  const pending = new Set();
  page.on("request", (request) => { if (request.resourceType() === "image" && /^https?:\/\//i.test(request.url())) pending.add(request); });
  const settle = (request) => { pending.delete(request); };
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  return pending;
}

/**
 * The pictures and the type, which are what a PDF prints wrong if it does not wait.
 *
 * Printed only once every picture asked for has arrived, every `<img>` has decoded and the fonts
 * are in - `document.fonts.ready` is the type's half: a heading printed mid-swap is a heading in the
 * wrong face. A picture that failed to load is not waited for again; the page shows the client the
 * same thing, and the logo falls back to the bundled mark on its own.
 *
 * This used to give up after two seconds and print whatever had arrived, which with the pictures
 * queued through the JPEG conversion was a cover or a collage cell printed blank, silently. A
 * picture still on its way after `ASSET_TIMEOUT_MS` now fails the render instead: the studio is told
 * the download did not work and can try again, rather than sending a client a quotation with holes.
 */
const ASSET_TIMEOUT_MS = 20_000;
const ASSET_POLL_MS = 100;

async function waitForRenderedAssets(page, pendingImages, timeoutMs = ASSET_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // A lazy picture off-screen is never asked for, so it is not waited for; the sheet has none today.
    const documentReady = await page.evaluate(() => Array.from(document.images).every((image) => image.complete || image.loading === "lazy"));
    if (documentReady && pendingImages.size === 0) break;
    if (Date.now() > deadline) {
      throw new Error(`The quotation's pictures did not finish loading within ${timeoutMs / 1000}s (${pendingImages.size} still loading).`);
    }
    await new Promise((resolve) => { setTimeout(resolve, ASSET_POLL_MS); });
  }
  // Loaded is not yet decoded; a decode that fails is a broken picture, already counted as answered.
  await page.evaluate(() => Promise.all([
    ...Array.from(document.images).map((image) => image.decode().catch(() => {})),
    document.fonts?.ready,
  ]));
}

/*
 * A box-shadow with only its sharp layers left: those with no blur radius.
 *
 * Chrome cannot write a blurred shadow into a PDF as vectors, so it paints each one as a bitmap at
 * print resolution - a card 1040px wide became a 3257px JPEG plus a soft mask of the same size, for
 * a shadow a few pixels deep. The cards' soft drop-shadows were 35-45% of every quotation PDF. A
 * shadow with no blur (the 3px halo round a timeline dot, a 1px ring) is drawn as a shape and costs
 * nothing, so it stays. Computed values only: Chrome writes each layer as `<colour> <x> <y> <blur>
 * <spread> [inset]`, the colour first.
 */
function withoutBlurredShadows(value) {
  if (!value || value === "none") return value;
  const layers = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) { layers.push(current.trim()); current = ""; } else current += char;
  }
  if (current.trim()) layers.push(current.trim());
  const kept = layers.filter((layer) => {
    const lengths = layer.replace(/[a-z-]+\([^)]*\)/gi, "").match(/-?[\d.]+px/g) || [];
    return !(parseFloat(lengths[2] || "0") > 0);
  });
  return kept.length ? kept.join(", ") : "none";
}

/**
 * Takes the blurred shadows off the page being printed (see `withoutBlurredShadows`). Only the
 * renderer's own headless page is touched - the client's link and the studio's screens keep them.
 */
async function dropBlurredShadows(page) {
  const shadows = await page.evaluate(() => Array.from(document.querySelectorAll("body *"), (node) => getComputedStyle(node).boxShadow));
  const replaced = shadows.map((value) => { const next = withoutBlurredShadows(value); return next === value ? null : next; });
  if (!replaced.some((value) => value !== null)) return;
  await page.evaluate((values) => {
    Array.from(document.querySelectorAll("body *")).forEach((node, index) => {
      if (values[index] !== null && values[index] !== undefined) node.style.setProperty("box-shadow", values[index], "important");
    });
  }, replaced);
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

// `getBrowser` is shared: the Signature Album prints its Download Album PDF with the same browser.
module.exports = { renderQuotationPdf, warmQuotationPdfBrowser, closeQuotationPdfBrowser, getBrowser, frontendOrigin, withoutBlurredShadows, trackImageRequests, waitForRenderedAssets };
