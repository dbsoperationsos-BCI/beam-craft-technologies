const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { withoutBlurredShadows, trackImageRequests, waitForRenderedAssets } = require("../src/services/quotationPdfService");

/*
 * The quotation PDF's shadows: Chrome prints a blurred box-shadow as a bitmap at print resolution,
 * which was 35-45% of every quotation PDF. The renderer keeps only the sharp layers, which print as
 * shapes. Inputs are computed values, as Chrome writes them.
 */

test("a card's soft drop-shadow goes entirely", () => {
  assert.equal(withoutBlurredShadows("rgba(28, 28, 28, 0.03) 0px 1px 2px 0px, rgba(28, 28, 28, 0.25) 0px 18px 40px -30px"), "none");
});

test("a sharp ring stays and only the blurred layer beside it goes", () => {
  assert.equal(withoutBlurredShadows("rgba(28, 28, 28, 0.03) 0px 0px 0px 1px, rgba(28, 28, 28, 0.2) 0px 8px 24px -18px"), "rgba(28, 28, 28, 0.03) 0px 0px 0px 1px");
  assert.equal(withoutBlurredShadows("rgba(214, 185, 106, 0.25) 0px 0px 0px 3px"), "rgba(214, 185, 106, 0.25) 0px 0px 0px 3px");
});

test("an inset hairline is sharp and stays", () => {
  assert.equal(withoutBlurredShadows("rgba(201, 162, 77, 0.45) 0px 0px 0px 1px inset"), "rgba(201, 162, 77, 0.45) 0px 0px 0px 1px inset");
});

test("no shadow is left as it is", () => {
  assert.equal(withoutBlurredShadows("none"), "none");
  assert.equal(withoutBlurredShadows(""), "");
});

/*
 * The PDF is printed only once every picture asked for has been answered. It used to print after
 * two seconds whatever had arrived, which left a slow cover photograph blank.
 */
const fakePage = () => Object.assign(new EventEmitter(), { evaluate: async () => true });
const fakeRequest = (url, resourceType = "image") => ({ url: () => url, resourceType: () => resourceType });

test("the print waits for a picture still on its way, and goes once it is answered", async () => {
  const page = fakePage();
  const pending = trackImageRequests(page);
  const cover = fakeRequest("https://storage.example/cover.webp");
  page.emit("request", cover);
  page.emit("request", fakeRequest("https://app.example/api/quotation", "fetch"));
  page.emit("request", fakeRequest("data:image/png;base64,AAAA"));
  assert.equal(pending.size, 1, "only web pictures are counted");
  let printed = false;
  const waiting = waitForRenderedAssets(page, pending, 5_000).then(() => { printed = true; });
  await new Promise((resolve) => { setTimeout(resolve, 250); });
  assert.equal(printed, false);
  page.emit("requestfinished", cover);
  await waiting;
  assert.equal(printed, true);
});

test("a failed picture is answered; one that never arrives fails the render", async () => {
  const page = fakePage();
  const pending = trackImageRequests(page);
  const broken = fakeRequest("https://storage.example/missing.webp");
  page.emit("request", broken);
  page.emit("requestfailed", broken);
  await waitForRenderedAssets(page, pending, 1_000);
  page.emit("request", fakeRequest("https://storage.example/slow.webp"));
  await assert.rejects(waitForRenderedAssets(page, pending, 300), /did not finish loading/);
});
