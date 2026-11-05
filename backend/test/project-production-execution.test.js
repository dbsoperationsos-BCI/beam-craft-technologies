const test = require("node:test");
const assert = require("node:assert/strict");
const { addFiles, removeFile, defaultStore, completeStep, pauseShoot, saveFootage } = require("../src/modules/project-management/production/execution");
const { createProductionFake, productionRow, manager, coordinator, stranger, superAdmin } = require("./production-fake-client");
const documentStorage = require("../src/services/documentStorage");
const imageStorage = require("../src/services/imageStorage");

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const PDF = "data:application/pdf;base64,JVBERi0xLjQ=";
const storeStub = (calls) => async (kind, files) => { calls.push({ kind, count: files.length }); return files.map((file, index) => ({ url: `https://cdn.example/${kind}-${index}`, key: `k-${index}`, fileName: file.name || "File", mimeType: "image/png" })); };

test("a ticket must be an image or a PDF", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  const calls = [];
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ name: "x.svg", data: "data:image/svg+xml;base64,PHN2Zz4=" }] }, manager, { client, store: storeStub(calls) }), (error) => error.status === 400);
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ name: "x.html", data: "data:text/html;base64,PGgxPg==" }] }, manager, { client, store: storeStub(calls) }), (error) => error.status === 400);
  await addFiles("shoot-1", { kind: "TICKET", files: [{ name: "train.pdf", data: PDF }] }, manager, { client, store: storeStub(calls) });
  assert.equal(calls.length, 1, "nothing is stored for a refused file");
});

test("a link is not a file", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ name: "x", data: "https://evil.example/x.pdf" }] }, manager, { client, store: storeStub([]) }), (error) => error.status === 400);
});

test("tickets are the manager's; step photos the shoot people's, nobody else's", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "HAPPENING_NOW" })] });
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, coordinator, { client, store: storeStub([]) }), (error) => error.status === 403);
  await assert.rejects(addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ data: PNG }] }, stranger, { client, store: storeStub([]) }), (error) => error.status === 403);
  await addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ data: PNG }] }, manager, { client, store: storeStub([]) });
  assert.equal(client.state.files.at(-1).kind, "HAPPENING_NOW");
});

test("added files are stored, recorded and logged", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "HAPPENING_NOW" })] });
  await addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ name: "a.png", data: PNG }, { name: "b.png", data: PNG }] }, coordinator, { client, store: storeStub([]) });
  assert.equal(client.state.files.length, 2);
  assert.equal(client.state.files[0].uploadedByUserId, 21);
  assert.equal(client.state.activities.at(-1).action, "FILE_ADDED");
});

test("the count limit is enforced", async () => {
  const files = Array.from({ length: 10 }, (_, index) => ({ id: `t-${index}`, productionId: "prod-1", kind: "TICKET" }));
  const client = createProductionFake({ productions: [productionRow()], files });
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, manager, { client, store: storeStub([]) }), (error) => error.status === 400);
});

test("the count limit is re-checked inside the transaction, against a race that lands between the pre-check and the write", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  const discarded = [];
  // Simulates a second, concurrent `POST /files` landing its own tickets while this request's slow
  // store step runs - so the pre-check above (held 0, limit 10) is stale by the time this reaches
  // the transaction.
  const store = async (kind, files) => {
    for (let index = 0; index < 10; index += 1) client.state.files.push({ id: `race-${index}`, productionId: "prod-1", kind: "TICKET" });
    return files.map((file, index) => ({ url: `https://cdn.example/${kind}-${index}`, key: `k-${index}`, fileName: file.name || "File", mimeType: "application/pdf" }));
  };
  await assert.rejects(
    addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, manager, { client, store, discard: async (stored) => discarded.push(...stored) }),
    (error) => error.status === 400,
  );
  assert.equal(discarded.length, 1, "the object stored for the losing request is discarded");
  assert.equal(client.state.files.filter((file) => file.url).length, 0, "the losing request's file is never written");
});

test("a ticket upload can set the travel mode itself, clearing the earlier detail, without saving the plan first", async () => {
  const client = createProductionFake({ productions: [productionRow({ travelMode: "Own", vehicleNumberPlate: "TN01AB1234" })] });
  await addFiles("shoot-1", { kind: "TICKET", files: [{ name: "t.pdf", data: PDF }], travelMode: "Train" }, manager, { client, store: storeStub([]) });
  const row = client.state.productions[0];
  assert.equal(row.travelMode, "Train");
  assert.equal(row.vehicleNumberPlate, null);
  assert.equal(client.state.files.length, 1);
  assert.ok(client.state.activities.some((entry) => entry.action === "PLAN_SAVED" && entry.detail === "Travel mode set to Train"));
});

test("a coordinator cannot set the travel mode through a ticket upload", async () => {
  const client = createProductionFake({ productions: [productionRow({ travelMode: "Own" })] });
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }], travelMode: "Train" }, coordinator, { client, store: storeStub([]) }), (error) => error.status === 403);
  assert.equal(client.state.productions[0].travelMode, "Own");
});

test("without a travelMode, a ticket upload is still refused against a non-ticket saved mode", async () => {
  const client = createProductionFake({ productions: [productionRow({ travelMode: "Own" })] });
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, manager, { client, store: storeStub([]) }), (error) => error.status === 400);
  assert.equal(client.state.productions[0].travelMode, "Own");
});

test("a coordinator reassigned mid-upload cannot write once the transaction re-checks who is named", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "HAPPENING_NOW" })] });
  const discarded = [];
  // Simulates the plan being resaved with a different coordinator while this request's slow store
  // step runs.
  const store = async (kind, files) => {
    client.state.productions[0].productionCoordinatorEmployeeId = 999;
    return files.map((file, index) => ({ url: `https://cdn.example/${kind}-${index}`, key: `k-${index}`, fileName: file.name || "File", mimeType: "image/png" }));
  };
  await assert.rejects(
    addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ data: PNG }] }, coordinator, { client, store, discard: async (stored) => discarded.push(...stored) }),
    (error) => error.status === 403,
  );
  assert.equal(discarded.length, 1);
});

test("a photo is refused outside its step", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "REACHED_SHOOT_PLACE" })] });
  await assert.rejects(addFiles("shoot-1", { kind: "PINEAPPLE_GROUP", files: [{ data: PNG }] }, coordinator, { client, store: storeStub([]) }), (error) => error.status === 409);
});

test("uploads are discarded when the record write fails", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "HAPPENING_NOW" })] });
  client.projectProductionFile.createMany = async () => { throw new Error("db down"); };
  const discarded = [];
  await assert.rejects(addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ data: PNG }] }, coordinator, { client, store: storeStub([]), discard: async (stored) => discarded.push(...stored) }));
  assert.equal(discarded.length, 1);
});

test("happening-now photos cannot be removed once Happening now is done; the object is deleted when they can", async () => {
  const files = [{ id: "f-1", productionId: "prod-1", kind: "HAPPENING_NOW", url: "https://cdn.example/a", fileName: "a.png" }];
  const done = createProductionFake({ productions: [productionRow({ currentStep: "HAPPY_CLIENTS" })], files });
  await assert.rejects(removeFile("shoot-1", "f-1", coordinator, { client: done, removeObject: async () => true }), (error) => error.status === 409);
  const open = createProductionFake({ productions: [productionRow({ currentStep: "HAPPENING_NOW" })], files });
  const removed = [];
  await removeFile("shoot-1", "f-1", coordinator, { client: open, removeObject: async (url) => removed.push(url) });
  assert.deepEqual(removed, ["https://cdn.example/a"]);
  assert.equal(open.state.activities.at(-1).action, "FILE_REMOVED");
});

test("a file of another shoot is not found", async () => {
  const client = createProductionFake({ productions: [productionRow()], files: [{ id: "f-9", productionId: "prod-other", kind: "TICKET", url: "u", fileName: "x" }] });
  await assert.rejects(removeFile("shoot-1", "f-9", manager, { client, removeObject: async () => true }), (error) => error.status === 404);
});

// --- Every uploaded image (a photo OR a ticket image) is compressed through imageStorage;
// only a PDF ticket goes to documentStorage, which cannot compress it. ---

test("defaultStore: a ticket PNG goes through the image path, never documentStorage", async (t) => {
  t.mock.method(imageStorage, "storeImages", async (sources) => sources.map((_, index) => ({ url: `https://cdn.example/img-${index}`, key: `img-${index}`, mimeType: "image/png" })));
  t.mock.method(documentStorage, "storeDocument", async () => { throw new Error("documentStorage must not be called for an image ticket"); });
  const stored = await defaultStore("TICKET", [{ name: "ticket.png", data: PNG }]);
  assert.equal(imageStorage.storeImages.mock.calls.length, 1);
  assert.equal(documentStorage.storeDocument.mock.calls.length, 0);
  assert.equal(stored[0].url, "https://cdn.example/img-0");
});

test("defaultStore: a ticket PDF goes through documentStorage, never imageStorage", async (t) => {
  t.mock.method(documentStorage, "storeDocument", async ({ name }) => ({ url: `https://cdn.example/doc-${name}`, key: "doc-1" }));
  t.mock.method(imageStorage, "storeImages", async () => { throw new Error("imageStorage must not be called for a PDF"); });
  const stored = await defaultStore("TICKET", [{ name: "train.pdf", data: PDF }]);
  assert.equal(documentStorage.storeDocument.mock.calls.length, 1);
  assert.equal(imageStorage.storeImages.mock.calls.length, 0);
  assert.equal(stored[0].mimeType, "application/pdf");
});

test("defaultStore: a mixed ticket batch routes each file to its own path, in order", async (t) => {
  t.mock.method(imageStorage, "storeImages", async (sources) => sources.map((_, index) => ({ url: `https://cdn.example/img-${index}`, key: `img-${index}`, mimeType: "image/png" })));
  t.mock.method(documentStorage, "storeDocument", async ({ name }) => ({ url: `https://cdn.example/${name}`, key: "doc-1" }));
  const stored = await defaultStore("TICKET", [{ name: "a.png", data: PNG }, { name: "b.pdf", data: PDF }]);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].url, "https://cdn.example/img-0");
  assert.equal(stored[1].url, "https://cdn.example/b.pdf");
});

test("defaultStore: a photo (non-ticket) always goes through imageStorage", async (t) => {
  t.mock.method(imageStorage, "storeImages", async (sources) => sources.map((_, index) => ({ url: `https://cdn.example/photo-${index}`, key: `p-${index}`, mimeType: "image/png" })));
  const stored = await defaultStore("HAPPENING_NOW", [{ name: "a.png", data: PNG }]);
  assert.equal(imageStorage.storeImages.mock.calls.length, 1);
  assert.equal(stored[0].url, "https://cdn.example/photo-0");
});

// --- The step engine and shoot status ---

const statuses = async () => ["Active"];
const at = (step, overrides = {}) => createProductionFake({ productions: [productionRow({ currentStep: step, ...overrides })], employees: [{ id: 14 }], travelPhotos: true });
const notifier = (sent) => async (productionId, messageStep) => { sent.push(messageStep); return { step: messageStep, status: "SENT" }; };

test("a step cannot be completed before the plan is submitted", async () => {
  const client = at("STARTED_FROM_STUDIO", { planSubmittedAt: null });
  await assert.rejects(completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client }), (error) => error.status === 409 && /plan/.test(error.message));
});

test("steps cannot be skipped", async () => {
  const client = at("STARTED_FROM_STUDIO");
  await assert.rejects(completeStep("shoot-1", "REACHED_SHOOT_PLACE", {}, coordinator, { client }), (error) => error.status === 409);
  await assert.rejects(completeStep("shoot-1", "NOT_A_STEP", {}, coordinator, { client }), (error) => error.status === 400);
});

test("the coordinator runs the steps; the manager and a Super Admin may complete one for them", async () => {
  await assert.rejects(completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, stranger, { client: at("STARTED_FROM_STUDIO") }), (error) => error.status === 403);
  await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, superAdmin, { client: at("STARTED_FROM_STUDIO") });
  // On the coordinator's behalf: the same checks apply, and the log names the manager.
  const client = at("STARTED_FROM_STUDIO");
  await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, manager, { client });
  assert.equal(client.state.productions[0].currentStep, "REACHED_SHOOT_PLACE");
  assert.equal(client.state.activities.at(-1).userName, "Meena");
});

test("completing a step moves to the next, stamps it, logs it and asks for its message", async () => {
  const client = at("STARTED_FROM_STUDIO");
  const sent = [];
  const result = await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client, now: () => new Date("2026-10-02T02:00:00Z"), notify: notifier(sent) });
  const row = client.state.productions[0];
  assert.equal(row.currentStep, "REACHED_SHOOT_PLACE");
  assert.deepEqual(row.startedFromStudioAt, new Date("2026-10-02T02:00:00Z"));
  assert.deepEqual(client.state.activities.at(-1), { productionId: "prod-1", action: "STEP_COMPLETED", detail: "STARTED_FROM_STUDIO", userId: 21, userName: "Ravi" });
  assert.deepEqual(sent, ["STARTED_FROM_STUDIO"]);
  assert.equal(result.message.status, "SENT");
});

test("a second press of the same step is refused and sends nothing twice", async () => {
  const client = at("REACHED_SHOOT_PLACE");
  const sent = [];
  await completeStep("shoot-1", "REACHED_SHOOT_PLACE", {}, coordinator, { client, notify: notifier(sent) });
  await assert.rejects(completeStep("shoot-1", "REACHED_SHOOT_PLACE", {}, coordinator, { client, notify: notifier(sent) }), (error) => error.status === 409);
  assert.deepEqual(sent, ["REACHED_SHOOT_PLACE"]);
});

test("the travel steps each need their own photo before they complete", async () => {
  for (const step of ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE"]) {
    const without = createProductionFake({ productions: [productionRow({ currentStep: step })] });
    await assert.rejects(completeStep("shoot-1", step, {}, coordinator, { client: without, notify: async () => null }), (error) => error.status === 400 && /photo/.test(error.message));
    const withPhoto = createProductionFake({ productions: [productionRow({ currentStep: step })], files: [{ id: "t", productionId: "prod-1", kind: step, url: "u", fileName: "x" }] });
    await completeStep("shoot-1", step, {}, coordinator, { client: withPhoto, notify: async () => null });
    assert.notEqual(withPhoto.state.productions[0].currentStep, step);
  }
});

test("the pineapple meeting needs a group photo and remarks", async () => {
  await assert.rejects(completeStep("shoot-1", "PINEAPPLE_MEETING", { remarks: "Met the family" }, coordinator, { client: at("PINEAPPLE_MEETING") }), (error) => error.status === 400 && /photo/.test(error.message));
  const withPhoto = createProductionFake({ productions: [productionRow({ currentStep: "PINEAPPLE_MEETING" })], files: [{ id: "p", productionId: "prod-1", kind: "PINEAPPLE_GROUP" }] });
  await assert.rejects(completeStep("shoot-1", "PINEAPPLE_MEETING", { remarks: "  " }, coordinator, { client: withPhoto }), (error) => error.status === 400 && /remarks/.test(error.message));
  await completeStep("shoot-1", "PINEAPPLE_MEETING", { remarks: "Met the family" }, coordinator, { client: withPhoto });
  assert.equal(withPhoto.state.productions[0].pineappleRemarks, "Met the family");
});

test("Shoot started needs its photo, takes an optional remark, and opens Happening now", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "SHOOT_STARTED" })] });
  await assert.rejects(completeStep("shoot-1", "SHOOT_STARTED", {}, coordinator, { client }), (error) => error.status === 400 && /photo/.test(error.message));
  client.state.files.push({ id: "s1", productionId: "prod-1", kind: "SHOOT_STARTED" });
  await completeStep("shoot-1", "SHOOT_STARTED", { remarks: "On time" }, coordinator, { client });
  assert.equal(client.state.productions[0].currentStep, "HAPPENING_NOW");
  assert.equal(client.state.productions[0].shootStartedRemarks, "On time");
});

test("at least 2 happening-now images are required, then Happy clients needs its own photo", async () => {
  const one = createProductionFake({ productions: [productionRow({ currentStep: "HAPPENING_NOW" })], files: [{ id: "h1", productionId: "prod-1", kind: "HAPPENING_NOW" }] });
  await assert.rejects(completeStep("shoot-1", "HAPPENING_NOW", {}, coordinator, { client: one }), (error) => error.status === 400 && /2/.test(error.message));
  one.state.files.push({ id: "h2", productionId: "prod-1", kind: "HAPPENING_NOW" });
  await completeStep("shoot-1", "HAPPENING_NOW", { remarks: "Haldi going well" }, coordinator, { client: one });
  assert.equal(one.state.productions[0].currentStep, "HAPPY_CLIENTS");
  assert.equal(one.state.productions[0].happeningNowRemarks, "Haldi going well");
  assert.ok(one.state.productions[0].happeningNowAt instanceof Date);
  await assert.rejects(completeStep("shoot-1", "HAPPY_CLIENTS", {}, coordinator, { client: one }), (error) => error.status === 400 && /photo/.test(error.message));
  one.state.files.push({ id: "c1", productionId: "prod-1", kind: "HAPPY_CLIENTS" });
  await completeStep("shoot-1", "HAPPY_CLIENTS", {}, coordinator, { client: one });
  assert.equal(one.state.productions[0].currentStep, "PHOTO_COPY");
});

test("Happy clients ends the shoot: it stamps it Completed itself and sends the shoot-completed message", async () => {
  const client = createProductionFake({
    productions: [productionRow({ currentStep: "HAPPY_CLIENTS" })],
    files: [{ id: "c1", productionId: "prod-1", kind: "HAPPY_CLIENTS" }],
  });
  const sent = [];
  const result = await completeStep("shoot-1", "HAPPY_CLIENTS", {}, coordinator, { client, notify: notifier(sent) });
  const row = client.state.productions[0];
  // Nobody is asked to say the shoot is over a second time: the footage is the one thing left.
  assert.equal(row.currentStep, "PHOTO_COPY");
  assert.equal(row.shootStatus, "COMPLETED");
  assert.ok(row.shootStatusAt instanceof Date);
  assert.deepEqual(sent, ["SHOOT_COMPLETED"]);
  assert.equal(result.message.status, "SENT");
  assert.deepEqual(client.state.activities.map((entry) => entry.action), ["STEP_COMPLETED"]);
});

test("a shoot left on the shoot status or the trip back is as far as File in, and its footage is what is asked for", async () => {
  for (const retired of ["SHOOT_STATUS", "STARTED_FROM_VENUE", "REACHED_STUDIO"]) {
    const client = at(retired, { shootStatus: "COMPLETED" });
    // The step itself is no step at all now, however it is asked for.
    await assert.rejects(completeStep("shoot-1", retired, {}, coordinator, { client }), (error) => error.status === 400);
    // And the step it reads as - File in - is the one that can be worked.
    await assert.rejects(completeStep("shoot-1", "HAPPY_CLIENTS", {}, coordinator, { client }), (error) => error.status === 409 && /File in/.test(error.message));
  }
});

test("the shoot can be paused where it stands and started again, each saying why, and nothing moves", async () => {
  const client = at("HAPPENING_NOW");
  // Why is required both ways round, and nothing is written for a refused save.
  await assert.rejects(pauseShoot("shoot-1", { paused: true, remarks: " " }, coordinator, { client }), (error) => error.status === 400 && /why/.test(error.message));
  await assert.rejects(pauseShoot("shoot-1", { paused: true, remarks: "Rain" }, { userId: 999, name: "Nobody" }, { client }), (error) => error.status === 403);
  assert.equal(client.state.productions[0].shootStatus, null);

  await pauseShoot("shoot-1", { paused: true, remarks: "Rain" }, coordinator, { client });
  const row = client.state.productions[0];
  assert.equal(row.shootStatus, "PAUSED");
  assert.equal(row.shootStatusRemarks, "Rain");
  assert.ok(row.shootStatusAt instanceof Date);
  assert.equal(row.currentStep, "HAPPENING_NOW", "pausing is not a step - the shoot stays where it is");
  assert.deepEqual(client.state.activities.map((entry) => entry.action), ["SHOOT_STATUS_CHANGED"]);
  assert.equal(client.state.activities[0].detail, "Running → Paused: Rain");

  // Paused, no step can be completed, and it cannot be paused twice.
  await assert.rejects(completeStep("shoot-1", "HAPPENING_NOW", {}, coordinator, { client }), (error) => error.status === 409 && /paused/.test(error.message));
  await assert.rejects(pauseShoot("shoot-1", { paused: true, remarks: "Rain again" }, coordinator, { client }), (error) => error.status === 409 && /already paused/.test(error.message));

  await pauseShoot("shoot-1", { paused: false, remarks: "Rain stopped" }, coordinator, { client });
  assert.equal(row.shootStatus, "STARTED");
  assert.equal(row.shootStatusRemarks, "Rain stopped");
  assert.equal(client.state.activities.at(-1).detail, "Paused → Started: Rain stopped");
  // And the step it stopped on is the step it carries on with.
  await completeStep("shoot-1", "HAPPENING_NOW", {}, coordinator, { client, notify: async () => null });
  assert.equal(row.currentStep, "HAPPY_CLIENTS");
});

test("the shoot cannot be paused before it has started or after Happy clients has ended it", async () => {
  for (const step of ["STARTED_FROM_STUDIO", "SHOOT_STARTED", "PHOTO_COPY"]) {
    await assert.rejects(pauseShoot("shoot-1", { paused: true, remarks: "x" }, coordinator, { client: at(step) }), (error) => error.status === 409, step);
  }
});

const footageFor = (serviceDefinitionId, overrides = {}) => ({
  serviceDefinitionId, footageUrl: "https://drive.example/f", backedUpByEmployeeId: 14, fileCount: 1250, size: "128 GB",
  firstFileName: "DSC_0001.ARW", lastFileName: "DSC_1250.ARW", remarks: "Two copies", ...overrides,
});

test("photo copy is answered once per service of the shoot - then the shoot is DONE", async () => {
  const services = [
    { shootId: "shoot-1", serviceDefinitionId: "svc-candid", serviceName: "Candid Photo" },
    { shootId: "shoot-1", serviceDefinitionId: "svc-video", serviceName: "Traditional Video" },
  ];
  const client = createProductionFake({ productions: [productionRow({ currentStep: "PHOTO_COPY" })], employees: [{ id: 14 }], services });
  // One service missing.
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-candid")] }, coordinator, { client, statuses }), (error) => error.status === 400 && /every service/.test(error.message));
  // A service that is not the shoot's, or one answered twice.
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-candid"), footageFor("svc-other")] }, coordinator, { client, statuses }), (error) => error.status === 400);
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-candid"), footageFor("svc-candid")] }, coordinator, { client, statuses }), (error) => error.status === 400);
  // A backup person who is not an active employee.
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-candid"), footageFor("svc-video", { backedUpByEmployeeId: 99 })] }, coordinator, { client, statuses }), (error) => error.status === 400);
  assert.equal(client.state.footage.length, 0, "nothing is written for a refused answer");
  await completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-candid"), footageFor("svc-video", { fileCount: 40, size: "850 MB" })] }, coordinator, { client, statuses });
  assert.equal(client.state.productions[0].currentStep, "DONE");
  assert.deepEqual(client.state.footage.map((row) => [row.serviceDefinitionId, row.fileCount, row.size]), [["svc-candid", 1250, "128 GB"], ["svc-video", 40, "850 MB"]]);
});

test("a shoot with no services booked answers photo copy once, for the whole shoot", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "PHOTO_COPY" })], employees: [{ id: 14 }] });
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", {}, coordinator, { client, statuses }), (error) => error.status === 400 && /for the shoot/.test(error.message));
  await completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor(null, { remarks: "  " })] }, coordinator, { client, statuses });
  assert.equal(client.state.footage[0].serviceDefinitionId, null);
  assert.equal(client.state.footage[0].remarks, null, "a blank remark is stored as none");
});

test("Mark as pending holds File in as it stands, and leaves the step where it is", async () => {
  /*
   * The copying is done card by card, so the step has to be able to hold three answers while the
   * fourth is still being read. The row is the card as it was left: what is typed is written and an
   * empty box is written as empty, because reopening the step has to show what the person left - an
   * earlier version kept a part-filled service's saved answers instead, and clearing a box then
   * brought the old value back on the next open. `saved` counts the services fully answered, which
   * is what completing the step is waiting on.
   */
  const services = [
    { shootId: "shoot-1", serviceDefinitionId: "svc-candid", serviceName: "Candid Photo" },
    { shootId: "shoot-1", serviceDefinitionId: "svc-video", serviceName: "Traditional Video" },
  ];
  const client = createProductionFake({ productions: [productionRow({ currentStep: "PHOTO_COPY" })], employees: [{ id: 14 }], services });
  const rows = (...fields) => client.state.footage.map((row) => fields.map((field) => row[field])).sort();

  const half = { serviceDefinitionId: "svc-video", footageUrl: "https://drive.example/v", backedUpByEmployeeId: "", fileCount: "", size: "", firstFileName: "", lastFileName: "", remarks: "" };
  const first = await saveFootage("shoot-1", { footage: [footageFor("svc-candid"), half] }, coordinator, { client, statuses });
  // Two cards written (`held`), one of them finished (`saved`), one service still to fill in: a card
  // saved part way is saved, and the screen says so rather than "nothing saved".
  assert.deepEqual([first.held, first.saved, first.pending], [2, 1, 1]);
  assert.equal(client.state.productions[0].currentStep, "PHOTO_COPY", "the step stays where it is");
  // Both held - the half-filled one with its empty boxes as nothing - and only the finished one counts.
  assert.deepEqual(rows("serviceDefinitionId", "footageUrl", "fileCount"), [["svc-candid", "https://drive.example/f", 1250], ["svc-video", "https://drive.example/v", null]]);
  assert.deepEqual(client.state.activities.map((entry) => [entry.action, entry.detail]), [["FOOTAGE_SAVED", "1 of 2 services filled in"]]);

  // Saved again: one row per service, so the answer is updated rather than answered twice.
  const second = await saveFootage("shoot-1", { footage: [footageFor("svc-candid", { fileCount: 1300 }), footageFor("svc-video", { size: "850 MB" })] }, coordinator, { client, statuses });
  assert.deepEqual([second.saved, second.pending], [2, 0]);
  assert.deepEqual(rows("serviceDefinitionId", "fileCount", "size"), [["svc-candid", 1300, "128 GB"], ["svc-video", 1250, "850 MB"]]);

  // A box cleared on a service already saved is saved cleared - the card as it was left - and that
  // service is one the step is waiting on again. The rest of its answers stay.
  const cleared = await saveFootage("shoot-1", { footage: [footageFor("svc-candid"), footageFor("svc-video", { size: "" })] }, coordinator, { client, statuses });
  assert.deepEqual([cleared.held, cleared.saved, cleared.pending], [2, 1, 1]);
  assert.deepEqual(rows("serviceDefinitionId", "size", "firstFileName"), [["svc-candid", "128 GB", "DSC_0001.ARW"], ["svc-video", null, "DSC_0001.ARW"]]);

  // Emptied out altogether, a service answered by mistake is taken back.
  const third = await saveFootage("shoot-1", { footage: [footageFor("svc-candid"), { serviceDefinitionId: "svc-video" }] }, coordinator, { client, statuses });
  assert.deepEqual([third.held, third.saved, third.pending], [1, 1, 1]);
  assert.deepEqual(client.state.footage.map((row) => row.serviceDefinitionId), ["svc-candid"]);

  // And completing the step then answers for every service at once, replacing what is held.
  await completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-candid"), footageFor("svc-video")] }, coordinator, { client, statuses });
  assert.equal(client.state.productions[0].currentStep, "DONE");
  assert.equal(client.state.footage.length, 2, "not four: the pending rows are replaced, not added to");
});

test("the five answers are nullable, with the migration that made them so", () => {
  /*
   * A part-filled card is stored part filled, so each answer has to be able to be nothing. Widening
   * only: every row that existed was written by a completed step and holds all five, so the migration
   * rewrites nothing and cannot fail on production data.
   */
  const fs = require("node:fs");
  const path = require("node:path");
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const model = schema.slice(schema.indexOf("model ProjectProductionFootage"));
  const body = model.slice(0, model.indexOf("\n}\n"));
  for (const field of ["footageUrl", "fileCount", "size", "firstFileName", "lastFileName"]) {
    assert.match(body, new RegExp(`${field}\\s+(String|Int)\\?`), `${field} is nullable`);
  }
  const dir = path.join(__dirname, "..", "prisma", "migrations");
  const folder = fs.readdirSync(dir).find((name) => name.endsWith("_footage_answers_nullable"));
  assert.ok(folder, "the migration is missing - a schema change that never reaches production");
  const sql = fs.readFileSync(path.join(dir, folder, "migration.sql"), "utf8");
  assert.match(sql, /MODIFY `footage_url` VARCHAR\(2048\) NULL/);
  assert.match(sql, /MODIFY `file_count` INTEGER NULL/);
  assert.match(sql, /MODIFY `size` VARCHAR\(50\) NULL/);
  assert.match(sql, /MODIFY `first_file_name` VARCHAR\(255\) NULL/);
  assert.match(sql, /MODIFY `last_file_name` VARCHAR\(255\) NULL/);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE /i, "widening only");
});

test("a pending File in is still only for the people on the shoot, on that step, with its own services", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "PHOTO_COPY" })], employees: [{ id: 14 }] });
  // Somebody not named on the shoot.
  await assert.rejects(saveFootage("shoot-1", { footage: [footageFor(null)] }, { userId: 999, name: "Nobody" }, { client, statuses }), (error) => error.status === 403);
  // A service the shoot does not book, and one answered twice.
  await assert.rejects(saveFootage("shoot-1", { footage: [footageFor("svc-other")] }, coordinator, { client, statuses }), (error) => error.status === 400);
  await assert.rejects(saveFootage("shoot-1", { footage: [footageFor(null), footageFor(null)] }, coordinator, { client, statuses }), (error) => error.status === 400);
  // A backup person who is not an active employee - the same refusal completing the step gives.
  await assert.rejects(saveFootage("shoot-1", { footage: [footageFor(null, { backedUpByEmployeeId: 99 })] }, coordinator, { client, statuses }), (error) => error.status === 400);
  assert.equal(client.state.footage.length, 0, "nothing is written for a refused save");
  // A shoot that books services does not answer once for the whole shoot, and the other way round.
  const withServices = createProductionFake({ productions: [productionRow({ currentStep: "PHOTO_COPY" })], employees: [{ id: 14 }], services: [{ shootId: "shoot-1", serviceDefinitionId: "svc-candid", serviceName: "Candid Photo" }] });
  await assert.rejects(saveFootage("shoot-1", { footage: [footageFor(null)] }, coordinator, { client: withServices, statuses }), (error) => error.status === 400);
  // And not before the shoot reaches the step.
  await assert.rejects(saveFootage("shoot-1", { footage: [footageFor(null)] }, coordinator, { client: at("HAPPY_CLIENTS"), statuses }), (error) => error.status === 409 && /Happy clients/.test(error.message));
});

test("the pending save's schema takes a blank answer where the step's own schema does not", () => {
  const { footageSaveSchema, stepSchema } = require("../src/modules/project-management/production/controller");
  const half = { serviceDefinitionId: "svc-video", footageUrl: "", backedUpByEmployeeId: "", fileCount: "", size: "", firstFileName: "", lastFileName: "" };
  assert.equal(footageSaveSchema.safeParse({ footage: [half] }).success, true);
  assert.equal(stepSchema.safeParse({ footage: [half] }).success, false, "completing the step still wants them all");
  // What is typed is still held to its own shape, blank or not - the location being free text.
  assert.equal(footageSaveSchema.safeParse({ footage: [{ ...half, footageUrl: "Seagate 3, Reception shelf" }] }).success, true);
  assert.equal(footageSaveSchema.safeParse({ footage: [{ ...half, fileCount: 2.5 }] }).success, false);
  assert.equal(footageSaveSchema.safeParse({ footage: [{ ...half, serviceDefinitionId: null }] }).success, true, "a shoot with no services");
  assert.equal(footageSaveSchema.safeParse({ footage: [footageFor("svc-candid")] }).success, true);
  // Nothing else of the step rides in on it.
  assert.equal(footageSaveSchema.safeParse({ footage: [], remarks: "x" }).success, false);
});

test("the photo copy fields are required, remarks aside, and checked before anything else", () => {
  const { stepSchema } = require("../src/modules/project-management/production/controller");
  assert.equal(stepSchema.safeParse({ footage: [footageFor("s")] }).success, true);
  for (const field of ["footageUrl", "backedUpByEmployeeId", "fileCount", "size", "firstFileName", "lastFileName"]) {
    const entry = footageFor("s");
    delete entry[field];
    assert.equal(stepSchema.safeParse({ footage: [entry] }).success, false, `${field} is required`);
  }
  assert.equal(stepSchema.safeParse({ footage: [footageFor("s", { size: "  " })] }).success, false);
  // Remarks may be left out.
  const noRemarks = footageFor("s");
  delete noRemarks.remarks;
  assert.equal(stepSchema.safeParse({ footage: [noRemarks] }).success, true);
  assert.equal(stepSchema.safeParse({ footage: [footageFor("s", { fileCount: 2.5 })] }).success, false);
  // The footage location is plain text: a disk on a shelf is as good an answer as a link, and what
  // is typed is stored as it was typed. Only an empty one is refused, by the loop above.
  assert.equal(stepSchema.parse({ footage: [footageFor("s", { footageUrl: "Seagate 3, Reception shelf" })] }).footage[0].footageUrl, "Seagate 3, Reception shelf");
  assert.equal(stepSchema.parse({ footage: [footageFor("s", { footageUrl: "drive.google.com/x" })] }).footage[0].footageUrl, "drive.google.com/x");
});

test("a notifier that throws never undoes the step", async () => {
  const client = at("STARTED_FROM_STUDIO");
  const result = await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client, notify: async () => { throw new Error("socket closed"); } });
  assert.equal(client.state.productions[0].currentStep, "REACHED_SHOOT_PLACE");
  assert.equal(result.message.status, "FAILED");
  assert.equal(result.message.reason, "Send failed");
  assert.equal(result.message.error, undefined);
});

test("the steps that ask nothing else take an optional remark, kept on that step", async () => {
  const client = at("STARTED_FROM_STUDIO");
  await completeStep("shoot-1", "STARTED_FROM_STUDIO", { remarks: "  Left at 6:10, two cars  " }, coordinator, { client, statuses, notify: async () => null });
  assert.equal(client.state.productions[0].startedFromStudioRemarks, "Left at 6:10, two cars");
  await completeStep("shoot-1", "REACHED_SHOOT_PLACE", {}, coordinator, { client, statuses, notify: async () => null });
  assert.equal(client.state.productions[0].reachedShootPlaceRemarks, null);
});

test("the Production Team and the service crew run the steps too; whoever is first completes it for all", async () => {
  const teamMember = { userId: 30, name: "Arun", employeeId: 40, superAdmin: false, runsExecution: true };
  const crewMember = { userId: 31, name: "Divya", employeeId: 41, superAdmin: false, runsExecution: true };
  const client = createProductionFake({
    productions: [productionRow({ currentStep: "SHOOT_STARTED", teamMembers: [{ employeeId: 40 }], serviceCrew: [{ employeeId: 41 }, { employeeId: null }] })],
    files: [{ id: "s1", productionId: "prod-1", kind: "SHOOT_STARTED" }],
  });
  // Somebody named nowhere on the shoot still cannot.
  await assert.rejects(completeStep("shoot-1", "SHOOT_STARTED", {}, stranger, { client }), (error) => error.status === 403);
  await completeStep("shoot-1", "SHOOT_STARTED", {}, teamMember, { client });
  assert.equal(client.state.productions[0].currentStep, "HAPPENING_NOW");
  assert.equal(client.state.activities.at(-1).action, "STEP_COMPLETED");
  // The crew member adds the photos of the step that is now open.
  await addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ data: PNG }, { data: PNG }] }, crewMember, { client, store: storeStub([]) });
  await completeStep("shoot-1", "HAPPENING_NOW", {}, crewMember, { client });
  // The step already done is done for everybody.
  await assert.rejects(completeStep("shoot-1", "HAPPENING_NOW", {}, teamMember, { client }), (error) => error.status === 409);
  // A vendor slot (no employee) never matches a viewer without one.
  const { accessFor } = require("../src/modules/project-management/production/access");
  assert.equal(accessFor(client.state.productions[0], { employeeId: null }).canRunSteps, false);
  assert.equal(accessFor(client.state.productions[0], teamMember).canEditPlan, false);
});

/*
 * File in asks a copy only for the services that hand files over - Settings → Project → Services,
 * "Deliverable added". An LED wall brings nothing back, so it is not asked for; a shoot whose
 * services all bring nothing has no copy to make at all.
 */
test("File in asks only for the services that deliver files", async () => {
  const services = [
    { shootId: "shoot-1", serviceDefinitionId: "svc-candid", serviceName: "Candid Photo" },
    { shootId: "shoot-1", serviceDefinitionId: "svc-led", serviceName: "LED Wall", deliverableAdded: false },
  ];
  const client = createProductionFake({ productions: [productionRow({ currentStep: "PHOTO_COPY" })], employees: [{ id: 14 }], services });
  // The LED wall is neither wanted nor accepted: the one delivering service is the whole answer.
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-candid"), footageFor("svc-led")] }, coordinator, { client, statuses }), (error) => error.status === 400);
  await completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-candid")] }, coordinator, { client, statuses });
  assert.deepEqual(client.state.footage.map((row) => row.serviceDefinitionId), ["svc-candid"]);
  assert.equal(client.state.productions[0].currentStep, "DONE");
});

test("a shoot whose services all deliver nothing has no copy to make, and the step finishes", async () => {
  const services = [{ shootId: "shoot-1", serviceDefinitionId: "svc-led", serviceName: "LED Wall", deliverableAdded: false }];
  const client = createProductionFake({ productions: [productionRow({ currentStep: "PHOTO_COPY" })], employees: [{ id: 14 }], services });
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor("svc-led")] }, coordinator, { client, statuses }), (error) => error.status === 400 && /no photo copy to fill in/.test(error.message));
  await completeStep("shoot-1", "PHOTO_COPY", { footage: [] }, coordinator, { client, statuses });
  assert.deepEqual(client.state.footage, [], "nothing is written, because nothing was copied");
  assert.equal(client.state.productions[0].currentStep, "DONE");
});

test("a shoot with no services booked at all still answers once for the whole shoot", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "PHOTO_COPY" })], employees: [{ id: 14 }], services: [] });
  await completeStep("shoot-1", "PHOTO_COPY", { footage: [footageFor(null)] }, coordinator, { client, statuses });
  assert.deepEqual(client.state.footage.map((row) => row.serviceDefinitionId), [null]);
});
