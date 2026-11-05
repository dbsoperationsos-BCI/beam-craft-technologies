const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSignatureAlbumPdfService } = require("../src/modules/image-selection/signature-album/signatureAlbum.pdf.service");
const { LIMITS } = require("../src/modules/image-selection/signature-album/signatureAlbum.constants");

/*
 * The PDF job store, with the headless browser replaced: one print per album however often it is
 * asked for, a stale PDF never handed over, a failure reported, a cap on prints at once, and old
 * files deleted.
 */
function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signature-album-pdf-"));
  let clock = 1_000_000;
  const gates = [];
  const printed = [];
  const render = (album, file) => new Promise((resolve, reject) => { printed.push(album.id); gates.push({ finish: async () => { await fs.promises.writeFile(file, `%PDF ${album.id}`); resolve(); }, fail: () => reject(new Error("browser crashed")) }); });
  const pdfs = createSignatureAlbumPdfService({ dir, render, now: () => clock, log: { error: () => {} } });
  return { pdfs, dir, printed, gates, advance: (ms) => { clock += ms; } };
}
// The job makes its folder before it prints, which is real file-system work, so wait for the fact.
async function until(check) { for (let tries = 0; tries < 500 && !check(); tries += 1) await new Promise((resolve) => { setTimeout(resolve, 10); }); assert.ok(check(), "timed out"); }
const album = (id, updatedAt = "2026-09-28T10:00:00Z") => ({ id, shortCode: id.toUpperCase(), updatedAt });

test("an album is printed once however often it is asked for, and handed over once ready", async () => {
  const ctx = build();
  assert.deepEqual(ctx.pdfs.status(album("a")), { status: "idle" });
  assert.equal(ctx.pdfs.start(album("a")).status, "preparing");
  assert.equal(ctx.pdfs.start(album("a")).status, "preparing");
  await until(() => ctx.gates.length === 1);
  assert.deepEqual(ctx.printed, ["a"]);
  assert.throws(() => ctx.pdfs.open(album("a")), (error) => error.status === 409, "not before it is ready");
  await ctx.gates[0].finish();
  await until(() => ctx.pdfs.status(album("a")).status === "ready");
  const text = await new Promise((resolve) => { const parts = []; ctx.pdfs.open(album("a")).on("data", (part) => parts.push(part)).on("end", () => resolve(Buffer.concat(parts).toString())); });
  assert.equal(text, "%PDF a");
  assert.equal(ctx.pdfs.start(album("a")).status, "ready", "a finished PDF of the same album is reused");
  assert.equal(ctx.printed.length, 1);
});

test("an album changed since its PDF was printed is printed again, and the old file is never handed over", async () => {
  const ctx = build();
  ctx.pdfs.start(album("a")); await until(() => ctx.gates.length === 1); await ctx.gates[0].finish();
  await until(() => ctx.pdfs.status(album("a")).status === "ready");
  const edited = album("a", "2026-09-28T11:00:00Z");
  assert.equal(ctx.pdfs.status(edited).status, "idle");
  assert.throws(() => ctx.pdfs.open(edited), (error) => error.status === 409);
  assert.equal(ctx.pdfs.start(edited).status, "preparing");
  await until(() => ctx.printed.length === 2);
});

test("a failed print says so, and the next start tries again", async () => {
  const ctx = build();
  ctx.pdfs.start(album("a")); await until(() => ctx.gates.length === 1); ctx.gates[0].fail();
  await until(() => ctx.pdfs.status(album("a")).status === "failed");
  assert.throws(() => ctx.pdfs.open(album("a")), (error) => error.status === 409);
  assert.equal(ctx.pdfs.start(album("a")).status, "preparing");
});

test("only a few albums print at once, and old PDFs are deleted", async () => {
  const ctx = build();
  for (let index = 0; index < LIMITS.PDF_MAX_RENDERING; index += 1) ctx.pdfs.start(album(`a${index}`));
  assert.throws(() => ctx.pdfs.start(album("extra")), (error) => error.status === 429);
  await until(() => ctx.gates.length === LIMITS.PDF_MAX_RENDERING);
  // Both start by making the folder, so either may reach the printer first: finish a0's own.
  await ctx.gates[ctx.printed.indexOf("a0")].finish();
  await until(() => ctx.pdfs.status(album("a0")).status === "ready");
  const [file] = fs.readdirSync(ctx.dir);
  assert.ok(file);
  ctx.advance(LIMITS.PDF_KEEP_MS + 1);
  ctx.pdfs.sweep();
  assert.deepEqual(ctx.pdfs.status(album("a0")), { status: "idle" });
  await until(() => !fs.readdirSync(ctx.dir).includes(file));
});
