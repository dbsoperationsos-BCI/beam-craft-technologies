import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mediaFileName, mediaKindLabel, mediaSummary, mediaViewMode } from "../src/lib/whatsappMedia.mjs";

// A chat file is described from its message and fetched only when View or Download is pressed.

test("a download keeps the client's name for the file, or gets one from its kind", () => {
  assert.equal(mediaFileName({ mediaName: "Quote.pdf", mediaType: "document" }), "Quote.pdf");
  assert.equal(mediaFileName({ id: "wam-abc-12345678", mediaType: "image", mediaMime: "image/jpeg" }), "image-12345678.jpg");
  assert.equal(mediaFileName({ id: "x", mediaType: "audio", mediaMime: "audio/ogg; codecs=opus" }), "audio-x.ogg");
  assert.equal(mediaFileName({ id: "x", mediaType: "document" }), "document-x.bin");
});

test("the summary says what it is and how big", () => {
  assert.equal(mediaKindLabel({ mediaType: "video" }), "Video");
  assert.equal(mediaKindLabel({ mediaType: "something" }), "File");
  assert.equal(mediaSummary({ mediaType: "image", mediaSize: 1536 }), "Photo · 1.5 KB");
  assert.equal(mediaSummary({ mediaType: "document", mediaSize: null }), "Document");
});

test("photos, videos and PDFs open in the viewer, audio plays, other documents only download", () => {
  assert.equal(mediaViewMode({ mediaType: "image" }), "viewer");
  assert.equal(mediaViewMode({ mediaType: "video" }), "viewer");
  assert.equal(mediaViewMode({ mediaType: "audio" }), "player");
  assert.equal(mediaViewMode({ mediaType: "document", mediaMime: "application/pdf" }), "viewer");
  assert.equal(mediaViewMode({ mediaType: "document", mediaMime: "application/vnd.ms-excel" }), "");
});

test("the chat bubble fetches nothing until View or Download is pressed", () => {
  const panel = fs.readFileSync(new URL("../src/components/sales/WhatsAppChatPanel.js", import.meta.url), "utf8");
  const bubble = panel.slice(panel.indexOf("function MediaBubble("), panel.indexOf("function CameraDialog(") > 0 ? panel.indexOf("function CameraDialog(") : undefined);
  const effects = bubble.match(/useEffect\([\s\S]*?\);/g) || [];
  assert.ok(effects.every((effect) => !effect.includes("fetchWhatsappMedia")), "a file is being fetched as the bubble mounts");
  assert.match(bubble, /async function run\(action\)/);
  assert.match(bubble, /saveToDownloads\(blob, name\)/);
});
