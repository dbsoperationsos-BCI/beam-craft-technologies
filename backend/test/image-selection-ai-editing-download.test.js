const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Writable, Readable } = require("node:stream");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "ai-editing-download-test-secret";
const { createEditDownloads, editDownloadState, uniqueNames } = require("../src/modules/image-selection/ai-editing/download");

const STYLE = { style: "warmWedding", adjustments: {}, tools: {} };
const rendered = (over = {}) => ({ id: "e", status: "RENDERED", version: 2, outputKey: "image-selection/ai-editing/p/v2/output.jpg", recipe: STYLE, appliedRecipe: STYLE, outputBytes: 9, ...over });
const upload = (id, fileName, edit, over = {}) => ({ id, projectId: "p1", fileName, status: "READY", edit, ...over });

function fixture(rows, objects = {}) {
  const repo = {
    findProject: async (id) => (id === "p1" ? { id } : null),
    listUploads: async (projectId, ids) => rows.filter((row) => row.projectId === projectId && ids.includes(row.id)),
  };
  const r2 = {
    isConfigured: () => true,
    objectExists: async (key) => key in objects,
    getObjectStream: async (key) => (key in objects ? Readable.from([Buffer.from(objects[key])]) : null),
  };
  return { repo, r2, downloads: createEditDownloads(repo, { r2 }) };
}

// A response that keeps what was written, with the headers the controller sets.
function sink() {
  const chunks = [];
  const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.body = () => Buffer.concat(chunks);
  return res;
}

test("only a saved, current, rendered edit is downloadable - a tick, an empty edit, a render in flight or a changed recipe never is", () => {
  assert.equal(editDownloadState(upload("a", "A.jpg", rendered())), "ready");
  assert.equal(editDownloadState(upload("a", "A.jpg", null)), "notEdited", "in the bay, never edited");
  assert.equal(editDownloadState(upload("a", "A.jpg", rendered({ status: "DRAFT", outputKey: null, appliedRecipe: null }))), "notEdited", "a saved recipe never applied");
  assert.equal(editDownloadState(upload("a", "A.jpg", rendered({ appliedRecipe: null }))), "notEdited", "an output without an applied edit");
  for (const status of ["QUEUED", "RENDERING", "WAITING_FOR_DESKTOP"]) assert.equal(editDownloadState(upload("a", "A.jpg", rendered({ status }))), "inProgress");
  assert.equal(editDownloadState(upload("a", "A.jpg", rendered({ status: "FAILED" }))), "failed", "a failed re-render is not the edit asked for");
  assert.equal(editDownloadState(upload("a", "A.jpg", rendered({ recipe: { style: "luxuryWedding", adjustments: {}, tools: {} } }))), "outdated", "saved since the last Apply");
  assert.equal(editDownloadState(upload("a", "A.jpg", rendered(), { status: "PROCESSING" })), "notEdited");
  assert.deepEqual(uniqueNames(["A (edited).jpg", "a (edited).jpg", "B/C.jpg"]), ["A (edited).jpg", "a (edited) (2).jpg", "B_C.jpg"]);
});

test("the plan keeps the edited photos of those asked for, counts the rest by reason, and signs a ticket that is no login token", async () => {
  const rows = [
    upload("u1", "DSC_1.JPG", rendered({ outputKey: "k1" })),
    upload("u2", "DSC_2.JPG", null),
    upload("u3", "DSC_3.JPG", rendered({ outputKey: "k3", recipe: { style: "luxuryWedding", adjustments: {}, tools: {} } })),
    upload("u4", "DSC_4.JPG", rendered({ outputKey: "k4" })),
    upload("u5", "DSC_1.JPG", rendered({ outputKey: "k5", version: 7 }), { folderId: "other" }),
    upload("x9", "OTHER.JPG", rendered({ outputKey: "k9" }), { projectId: "p2" }),
  ];
  const { downloads } = fixture(rows, { k1: "one", k5: "five", k9: "nine" });
  const plan = await downloads.plan("p1", ["u1", "u2", "u3", "u4", "u5", "x9", "u1"], 7);
  assert.deepEqual(plan.included.map((item) => [item.uploadId, item.downloadName]), [["u1", "DSC_1 (edited).jpg"], ["u5", "DSC_1 (edited) (2).jpg"]], "same file names made unique, never merged");
  assert.deepEqual(plan.excluded, { notEdited: 2, outdated: 1, inProgress: 0, failed: 0, missing: 1 }, "u2 not edited, x9 another project's, u3 outdated, u4's output gone");
  assert.equal(plan.asked, 6);
  assert.throws(() => jwt.verify(plan.ticket, process.env.JWT_SECRET), "the auth guard's own key cannot read it, so it never passes as a session");
  const payload = downloads.verify(plan.ticket);
  assert.deepEqual([payload.projectId, payload.sub, payload.items], ["p1", 7, [["u1", 2], ["u5", 7]]]);
  const none = await downloads.plan("p1", ["u2"], 7);
  assert.deepEqual([none.included.length, none.ticket], [0, null], "nothing edited: no ticket at all");
  await assert.rejects(downloads.plan("p-gone", ["u1"], 7), (error) => error.status === 404);
  assert.throws(() => downloads.verify("not-a-ticket"), (error) => error.status === 401);
});

test("one edited photo downloads as its JPEG master; several stream as a ZIP of the masters, never a preview or an original", async () => {
  const rows = [upload("u1", "DSC_1.JPG", rendered({ outputKey: "k1" })), upload("u2", "DSC_2.JPG", rendered({ outputKey: "k2", outputPreviewKey: "preview2", version: 3 }))];
  const { downloads } = fixture(rows, { k1: "MASTER-ONE", k2: "MASTER-TWO", preview2: "PREVIEW" });
  const single = await downloads.plan("p1", ["u1"], 7);
  const res = sink();
  await downloads.streamArchive(single.ticket, res);
  assert.equal(res.headers["content-type"], "image/jpeg");
  assert.match(res.headers["content-disposition"], /attachment; filename="DSC_1 \(edited\)\.jpg"/);
  assert.equal(res.body().toString(), "MASTER-ONE");
  const both = await downloads.plan("p1", ["u1", "u2"], 7);
  const zip = sink();
  await downloads.streamArchive(both.ticket, zip);
  assert.equal(zip.headers["content-type"], "application/zip");
  const body = zip.body();
  assert.equal(body.subarray(0, 2).toString(), "PK");
  for (const text of ["DSC_1 (edited).jpg", "DSC_2 (edited).jpg", "MASTER-ONE", "MASTER-TWO"]) assert.ok(body.includes(Buffer.from(text)), `${text} is in the archive`);
  assert.ok(!body.includes(Buffer.from("PREVIEW")), "the preview is never the deliverable");
  assert.ok(!body.includes(Buffer.from("NOT-INCLUDED.txt")));
});

test("an edit changed or reset after the ticket was made is left out and named, and a ticket for another project or with nothing left is refused", async () => {
  const rows = [upload("u1", "DSC_1.JPG", rendered({ outputKey: "k1" })), upload("u2", "DSC_2.JPG", rendered({ outputKey: "k2" }))];
  const { downloads } = fixture(rows, { k1: "MASTER-ONE", k2: "MASTER-TWO" });
  const plan = await downloads.plan("p1", ["u1", "u2"], 7);
  rows[1].edit = rendered({ outputKey: "k2b", version: 3 });
  const zip = sink();
  await downloads.streamArchive(plan.ticket, zip);
  const body = zip.body();
  assert.ok(body.includes(Buffer.from("MASTER-ONE")));
  assert.ok(!body.includes(Buffer.from("MASTER-TWO")), "the re-rendered photo's old version is not served");
  assert.ok(body.includes(Buffer.from("NOT-INCLUDED.txt")) && body.includes(Buffer.from("DSC_2.JPG")), "and it is named");
  rows[0].edit = rendered({ status: "DRAFT", outputKey: null, appliedRecipe: null });
  rows[1].edit = null;
  await assert.rejects(downloads.streamArchive(plan.ticket, sink()), (error) => error.status === 409 && /None of these photos has a saved edit/.test(error.message));
});

test("a master gone from storage is a 409 with the photo's name, never a 500; the batch is capped and archives at once are limited", async () => {
  const rows = [upload("u1", "DSC_1.JPG", rendered({ outputKey: "k1" }))];
  const { repo } = fixture(rows, { k1: "x" });
  let fail = false;
  const r2 = { isConfigured: () => true, objectExists: async () => true, getObjectStream: async () => { if (fail) throw new Error("R2 down"); return Readable.from([Buffer.from("x")]); } };
  const downloads = createEditDownloads(repo, { r2 });
  const plan = await downloads.plan("p1", ["u1"], 7);
  fail = true;
  await assert.rejects(downloads.streamArchive(plan.ticket, sink()), (error) => error.status === 409 && /DSC_1\.JPG is no longer in storage/.test(error.message));
  const many = Array.from({ length: 2005 }, (_, index) => `id${index}`);
  let asked = 0;
  const counting = createEditDownloads({ findProject: async () => ({ id: "p1" }), listUploads: async (projectId, ids) => { asked = ids.length; return []; } }, { r2 });
  assert.equal((await counting.plan("p1", many, 7)).asked, 2000);
  assert.equal(asked, 2000, "never more than 2000 in one download");
  const { MAX_CONCURRENT } = require("../src/modules/image-selection/ai-editing/download");
  const slow = createEditDownloads(repo, { r2: { isConfigured: () => true, objectExists: async () => true, getObjectStream: async () => new Readable({ read() {} }) } });
  const ticket = (await slow.plan("p1", ["u1"], 7)).ticket;
  const open = Array.from({ length: MAX_CONCURRENT }, () => { const res = sink(); slow.streamArchive(ticket, res).catch(() => {}); return res; });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(slow.streamArchive(ticket, sink()), (error) => error.status === 429);
  for (const res of open) res.destroy();
});

test("the routes: the plan is AI Editing READ behind the session guard, the file takes the ticket alone, both ahead of the project router, rate limited", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-editing", "download.routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/downloads\/plan", protect, planLimiter, checkPermission\("IMAGE_SELECTION", "AI Editing", "READ"\), c\.downloadPlan\);/);
  assert.match(routes, /router\.post\("\/downloads\/archive", downloadLimiter, express\.urlencoded\(\{ extended: false, limit: "512kb" \}\), c\.downloadArchive\);/);
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  const early = server.indexOf('app.use("/api/image-selection/projects/:projectId/ai-editing", require("./modules/image-selection/ai-editing/download.routes"));');
  assert.ok(early > 0 && early < server.indexOf('app.use("/api/image-selection", imageSelectionProjectRoutes);'), "mounted before the project router's session guard");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-editing", "controller.js"), "utf8");
  assert.match(controller, /if \(ticket\.projectId !== params\.data\.projectId\) return refuse\(401, "Invalid download\."\);/, "a ticket is good for the project it names only");
});
