const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Writable } = require("node:stream");
const JSZip = require("jszip");
const { createEventDownloads, baseName } = require("../src/modules/hrm/events/download");
const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");

/*
 * HRM → Events → Download: an event's photos as a file, behind `HRM / Event Download` as well as
 * `HRM / Events`. Read from the event's own storage only - a stored outside link is never fetched.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const inline = `data:image/jpeg;base64,${JPEG.toString("base64")}`;

// A response that collects what is written, with the parts of Express the download uses.
function fakeResponse() {
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.body = () => Buffer.concat(chunks);
  return res;
}

function downloads(event, objects = {}) {
  const asked = [];
  return {
    asked,
    service: createEventDownloads({
      prisma: { hrmEvent: { findUnique: async ({ where }) => (where.id === 7 ? event : null) } },
      objectStorage: {
        keyFromUrl: (url) => (String(url).startsWith("https://bucket.example/") ? String(url).slice("https://bucket.example/".length) : null),
        getPublicObjectBuffer: async (key) => { asked.push(key); return objects[key] || null; },
      },
    }),
  };
}

test("one photo is answered as that picture, named for the event", async () => {
  const { service } = downloads({ title: "Annual Day", imageUrl: inline, imageKey: null, images: [{ imageUrl: inline, imageKey: null }] });
  const res = fakeResponse();
  await service.sendEventPhotos(7, res);
  assert.equal(res.headers["content-type"], "image/jpeg");
  assert.match(res.headers["content-disposition"], /filename="Annual Day\.jpg"/);
  assert.equal(res.headers["cache-control"], "private, no-store");
  assert.deepEqual(res.body(), JPEG);
});

test("several photos are a ZIP in their order; an outside link is never fetched and is named instead", async () => {
  const { service, asked } = downloads({
    title: "Team / Outing",
    imageUrl: "https://bucket.example/hrm/events/a.webp",
    imageKey: "hrm/events/a.webp",
    images: [
      { imageUrl: "https://bucket.example/hrm/events/a.webp", imageKey: "hrm/events/a.webp" },
      { imageUrl: "https://bucket.example/hrm/events/b.jpg", imageKey: null },
      { imageUrl: "https://elsewhere.example/c.jpg", imageKey: null },
    ],
  }, { "hrm/events/a.webp": Buffer.from("webp-a"), "hrm/events/b.jpg": Buffer.from("jpeg-b") });
  const res = fakeResponse();
  await service.sendEventPhotos(7, res);
  assert.equal(res.headers["content-type"], "application/zip");
  assert.match(res.headers["content-disposition"], /filename="Team Outing\.zip"/);
  assert.deepEqual(asked, ["hrm/events/a.webp", "hrm/events/b.jpg"], "only this studio's bucket is read");
  const zip = await JSZip.loadAsync(res.body());
  assert.deepEqual(Object.keys(zip.files).sort(), ["NOT-INCLUDED.txt", "Team Outing 1.webp", "Team Outing 2.jpg"]);
  assert.equal(await zip.file("Team Outing 2.jpg").async("string"), "jpeg-b");
  assert.match(await zip.file("NOT-INCLUDED.txt").async("string"), /Photo 3/);
});

test("an unknown event is 404, and one with nothing readable is refused before anything is sent", async () => {
  const { service } = downloads({ title: "Gone", imageUrl: "https://elsewhere.example/x.jpg", imageKey: null, images: [] });
  await assert.rejects(service.sendEventPhotos(8, fakeResponse()), (error) => error.status === 404);
  const res = fakeResponse();
  await assert.rejects(service.sendEventPhotos(7, res), (error) => error.status === 409);
  assert.deepEqual(res.headers, {}, "no file was started");
});

test("a title becomes a safe file name", () => {
  assert.equal(baseName("  ../Diwali: 2026?  "), ".. Diwali 2026");
  assert.equal(baseName(""), "event");
});

test("the route asks for HRM / Events and HRM / Event Download, and the permission exists everywhere", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "events", "routes.js"), "utf8");
  assert.match(routes, /checkPermission\("HRM", "Event Download", "READ"\)/);
  assert.match(routes, /router\.get\("\/:id\/download", canUseEvents, canDownloadEvents, downloadEvent\)/);
  const row = PERMISSIONS.find((permission) => permission.module === "HRM" && permission.feature === "Event Download");
  assert.equal(row?.level, "EVENT_DOWNLOAD");
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261026120000_hrm_event_download_permission", "migration.sql"), "utf8");
  assert.match(migration, /'Event Download' AS `feature`, 'EVENT_DOWNLOAD' AS `level`/);
  // Granted to SUPER_ADMIN alone: every other role starts without it.
  assert.equal((migration.match(/INSERT INTO `role_permission`/g) || []).length, 1);
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
});

test("a reader who leaves mid-archive ends it, rather than leaving it writing to a closed connection", async () => {
  const objects = { "hrm/events/a.jpg": Buffer.alloc(64 * 1024, 1), "hrm/events/b.jpg": Buffer.alloc(64 * 1024, 2) };
  const { service } = downloads({ title: "Long", imageUrl: "", imageKey: null, images: Object.keys(objects).map((key) => ({ imageUrl: "", imageKey: key })) }, objects);
  const res = fakeResponse();
  res.once("pipe", () => setImmediate(() => res.destroy()));
  await service.sendEventPhotos(7, res);
  assert.equal(res.destroyed, true);
});
