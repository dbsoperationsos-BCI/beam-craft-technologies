const { getBrowser, frontendOrigin } = require("../../../services/quotationPdfService");
const { previewKeyFor } = require("./service");

/*
 * An invitation as a picture to download: the front of it - artwork, pieces, names, photo, date and
 * place - drawn by the guest's own page in its still form (`/inv/<token>?still=1`, nothing moving, no
 * curtain) and photographed by the same headless browser the quotation PDF uses, at a phone story's
 * size (1080 x 1920). So the picture is exactly what guests see, in the design's own faces.
 *
 * Kept for a while per invitation and per save, so tapping Download twice costs one render.
 */

const WIDTH = 540;
const HEIGHT = 960;
const SCALE = 2;
const TIMEOUT_MS = 30000;
const KEEP_MS = 30 * 60 * 1000;
const MAX_KEPT = 40;
const kept = new Map();

/** The invitation's front as PNG bytes. `version` (its last save) decides whether a kept one will do. */
async function renderInvitationCard(token, version) {
  const key = `${token}:${version}`;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.png;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(TIMEOUT_MS);
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });
    // With a preview key: Download is free, even for an invitation not yet paid for.
    await page.goto(`${frontendOrigin()}/inv/${encodeURIComponent(token)}?still=1&k=${encodeURIComponent(previewKeyFor(token))}`, { waitUntil: "domcontentloaded" });
    // Settled once it has drawn everything, or found the link opens nothing - never while "loading".
    const settled = await page.waitForSelector('[data-invitation-state="ready"], [data-invitation-state="missing"]', { timeout: TIMEOUT_MS });
    const state = await settled.evaluate((node) => node.getAttribute("data-invitation-state"));
    if (state !== "ready") throw new Error(`The invitation could not be drawn (${state}).`);
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    kept.set(key, { png, at: Date.now() });
    // The oldest go first once the shelf is full.
    while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
    return png;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { renderInvitationCard };
