const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");

const { reviveRaw, mediaDetails, openMediaStream } = require("../src/modules/sales/whatsapp-chat/mediaOnDemand");

/*
 * A chat's files are fetched from WhatsApp when somebody asks, never kept. What the CRM holds is
 * the message as WhatsApp delivered it - saved with JSON.stringify - and these tests hold that it
 * can be read back into something the download can use, and that the panel's preview comes from it.
 */

const thumb = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const key = Buffer.from("0123456789abcdef0123456789abcdef");

function stored(content) {
  return JSON.stringify({ key: { id: "ABC" }, message: content });
}

test("the stored message comes back with its key as a Buffer", () => {
  const raw = reviveRaw(stored({ imageMessage: { mediaKey: key, url: "https://mmg.whatsapp.net/x" } }));
  assert.ok(Buffer.isBuffer(raw.message.imageMessage.mediaKey));
  assert.deepEqual(raw.message.imageMessage.mediaKey, key);
});

test("a Uint8Array written as numbered keys is revived too", () => {
  const written = JSON.stringify({ message: { documentMessage: { mediaKey: new Uint8Array([1, 2, 3]) } } });
  assert.deepEqual(reviveRaw(written).message.documentMessage.mediaKey, Buffer.from([1, 2, 3]));
});

test("unreadable or missing messages are null, not a crash", () => {
  assert.equal(reviveRaw(null), null);
  assert.equal(reviveRaw("{not json"), null);
});

test("a photo shows its name, size and WhatsApp's own small preview", () => {
  const details = mediaDetails(stored({ imageMessage: { mimetype: "image/jpeg", fileLength: { low: 2048, high: 0, unsigned: true }, jpegThumbnail: thumb } }), "image");
  assert.equal(details.size, 2048);
  assert.equal(details.contentType, "image/jpeg");
  assert.equal(details.thumbnail, `data:image/jpeg;base64,${thumb.toString("base64")}`);
});

test("a document keeps the name the client gave it", () => {
  const details = mediaDetails(stored({ documentMessage: { fileName: "Quote.pdf", mimetype: "application/pdf", fileLength: "51200" } }), "document");
  assert.equal(details.fileName, "Quote.pdf");
  assert.equal(details.size, 51200);
  assert.equal(details.thumbnail, "");
});

test("a message without a stored original still answers", () => {
  assert.deepEqual(mediaDetails(null, "audio"), { fileName: "", size: null, thumbnail: "", contentType: "audio/ogg" });
});

test("a file is streamed from WhatsApp with the revived message and nothing is written", async () => {
  let asked = null;
  const body = new PassThrough();
  const file = await openMediaStream(
    { mediaType: "image", rawMessage: stored({ imageMessage: { mediaKey: key, mimetype: "image/png" } }) },
    null,
    { download: async (raw, type, _options, ctx) => { asked = { raw, type, ctx }; return body; } },
  );
  assert.equal(file.stream, body);
  assert.equal(file.contentType, "image/png");
  assert.equal(asked.type, "stream");
  assert.ok(Buffer.isBuffer(asked.raw.message.imageMessage.mediaKey));
  // Baileys logs while it asks the phone to re-upload, and throws without a logger.
  assert.equal(typeof asked.ctx.logger.info, "function");
  // With no live session there is nobody to ask for a re-upload, and saying so is the answer.
  await assert.rejects(asked.ctx.reuploadRequest({}), /not linked/);
});

test("a file WhatsApp no longer has is null, so the endpoint can say so", async () => {
  const file = await openMediaStream(
    { mediaType: "video", rawMessage: stored({ videoMessage: { mediaKey: key } }) },
    null,
    { download: async () => { throw new Error("410 Gone"); } },
  );
  assert.equal(file, null);
  assert.equal(await openMediaStream({ mediaType: "video", rawMessage: null }), null);
});
