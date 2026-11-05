import test from "node:test";
import assert from "node:assert/strict";

/*
 * Safari draws WebP but cannot encode it: `canvas.toBlob(cb, "image/webp", q)` hands back a PNG and ignores
 * the quality. The compressor's quality search then never fit the budget, so it walked the whole
 * size ladder down to 320px - every photo picked on an iPhone arrived as a tiny, blurry PNG. Where
 * WebP cannot be encoded a photo is written as JPEG, and a picture with transparency (a logo) stays
 * PNG, because JPEG would turn its see-through parts black.
 *
 * The browser is faked here: a canvas whose encoded size follows the quality asked for, and which
 * answers PNG for any type it cannot encode - the way Safari does.
 */

function fakeBrowser({ encodes, transparent = false, probeThrows = false }) {
  const requested = [];
  globalThis.createImageBitmap = async () => ({ width: 4032, height: 3024, close() {} });
  globalThis.FileReader = class {
    readAsDataURL(blob) { this.result = `data:${blob.type};base64,AAAA`; queueMicrotask(() => this.onload()); }
  };
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage() {},
          getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(transparent ? 0 : 255) }),
        }),
        toDataURL: (type) => {
          if (probeThrows) throw new Error("SecurityError");
          return `data:${encodes.includes(type) ? type : "image/png"};base64,AAAA`;
        },
        toBlob: (callback, type, quality) => {
          requested.push(type);
          const encodable = encodes.includes(type);
          const pixels = canvas.width * canvas.height;
          // A lossy encode shrinks with quality; a PNG is the same size whatever is asked.
          const lossy = encodable && type !== "image/png";
          callback({ type: encodable ? type : "image/png", size: lossy ? Math.round(pixels * 0.15 * quality) : pixels * 2 });
        },
      };
      return canvas;
    },
  };
  return requested;
}

const SAFARI = ["image/jpeg", "image/png"];
const photo = { size: 7_000_000, type: "image/jpeg" };

test("a browser that cannot encode WebP gets a full-size JPEG of a photo, not a 320px PNG", async () => {
  const requested = fakeBrowser({ encodes: SAFARI });
  const { compressImageFile } = await import("../src/lib/imageCompression.js?safari-photo");
  const result = await compressImageFile(photo);

  assert.equal(result.mimeType, "image/jpeg");
  assert.ok(result.dataUrl.startsWith("data:image/jpeg"));
  assert.ok(result.width >= 900, `kept a usable size, got ${result.width}px`);
  assert.ok(result.byteSize <= 150 * 1024);
  assert.ok(!requested.includes("image/webp"), "never asks for an encoder the browser lacks");
});

test("a transparent picture stays PNG where WebP cannot be encoded, so it does not turn black", async () => {
  fakeBrowser({ encodes: SAFARI, transparent: true });
  const { compressImageFile } = await import("../src/lib/imageCompression.js?safari-logo");
  const result = await compressImageFile({ size: 40_000, type: "image/png" });

  assert.equal(result.mimeType, "image/png");
});

test("a browser that refuses to read a canvas back still compresses a photo", async () => {
  fakeBrowser({ encodes: SAFARI, probeThrows: true });
  const { compressImageFile } = await import("../src/lib/imageCompression.js?hardened");
  const result = await compressImageFile(photo);

  assert.equal(result.mimeType, "image/jpeg");
});

test("a browser that encodes WebP keeps WebP", async () => {
  fakeBrowser({ encodes: ["image/webp", ...SAFARI] });
  const { compressImageFile } = await import("../src/lib/imageCompression.js?chrome");
  const result = await compressImageFile(photo);

  assert.equal(result.mimeType, "image/webp");
  assert.ok(result.width >= 900);
});
