const prisma = require("../../../config/db");
const documentStorage = require("../../../services/documentStorage");
const imageStorage = require("../../../services/imageStorage");
const objectStorage = require("../../../services/objectStorage");
const { accessFor, loadForWrite, fail } = require("./access");
const { logActivity } = require("./activity");
const { claimSending, sendStepMessage } = require("./messages");
const { travelData } = require("./plan");
const S = require("./steps");
const { studioDateKey } = require("../../../services/studioTime");
const { ticketRefusal } = require("./travel");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const clientPush = require("../../../services/clientPush");

// The crew's steps a client hears about on their phone, in their words.
const CLIENT_PUSH = {
  STARTED_FROM_STUDIO: (name) => ({ title: `Our team is on the way`, body: name }),
  REACHED_SHOOT_PLACE: (name) => ({ title: `Our team has reached the venue`, body: name }),
  SHOOT_STARTED: (name) => ({ title: `${name} has started`, body: "Your shoot is live now" }),
};

/**
 * Asks for the step's WhatsApp message after the step is saved, outside its transaction. Whatever
 * happens to the send, the step stays done: a throw here is reported as a FAILED message.
 */
async function notifyAfter(notify, productionId, messageStep, caller, deps) {
  try {
    return await notify(productionId, messageStep, caller, deps);
  } catch (error) {
    console.error("Production message could not be recorded:", error);
    return { step: messageStep, status: "FAILED", reason: "Send failed", sentAt: null };
  }
}

/*
 * What the people on the shoot do on the day, and the files both sides add.
 *
 * Tickets are the manager's (plan side), and only while the plan's travel mode is Bus, Train or
 * Flight (`travel.ticketRefusal`, 400); tickets added under an earlier mode are kept and can still be
 * removed. Photos are the shoot people's. Both accept only JPEG, PNG,
 * WebP or - a ticket only - PDF. Every IMAGE, whichever side added it, is compressed to ≤150 KB and
 * uploaded to R2 through `imageStorage` exactly like any other picture in this application; only a
 * PDF ticket goes to `documentStorage` (`trustUrls: false`), which cannot compress it and is not
 * asked to. Only a `data:` payload of an allowed type is accepted - a link, an SVG or an HTML page
 * is refused before anything is stored. Files are stored before the transaction (uploads are slow)
 * and discarded if the record write fails.
 *
 * `documentStorage` and `imageStorage` are required as namespaces, not destructured, so a test can
 * `mock.method` the function actually reached at call time.
 */
const DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const mimeOf = (data) => (/^data:([^;,]+);base64,/.exec(String(data || "")) || [])[1] || null;

function assertSide(production, kind, caller) {
  const access = accessFor(production, caller);
  // A ticket is the plan's, and its route sits beside the steps' rather than behind Production's own
  // guard, so Production at Read / Write is asked here as the plan's other routes ask it there.
  if (kind === "TICKET" ? !(access.canEditPlan && (caller?.superAdmin || caller?.allProjects || caller?.writesProduction)) : !access.canRunSteps) {
    throw fail(403, kind === "TICKET" ? "Only this project's Production Manager can change the tickets." : "Only the people named on this shoot who hold Production or Production Execution at Read / Write can add or remove its photos.");
  }
}

/**
 * Stores a batch of photos through `imageStorage`, which compresses each to ≤150 KB and uploads it
 * to R2. `imageStorage.storeImages` rolls back its own partial uploads on failure.
 */
async function storePhotos(files, folder) {
  const images = await imageStorage.storeImages(files.map((file) => file.data), { folder });
  return images.map((image, index) => ({ url: image.url, key: image.key, fileName: String(files[index]?.name || `Photo ${index + 1}`).slice(0, 255), mimeType: image.mimeType }));
}

/**
 * Stores a batch of tickets. A PDF goes to `documentStorage` (uncompressible); an image ticket goes
 * through `imageStorage` exactly like a photo - every image is compressed and kept in R2, no
 * exceptions for which side added it. Output order matches input order.
 */
async function storeTickets(files) {
  const stored = new Array(files.length);
  const photoIndexes = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (mimeOf(file.data) === "application/pdf") {
        const name = String(file.name || "Ticket").slice(0, 255);
        const result = await documentStorage.storeDocument({ name, data: file.data }, { folder: "production/tickets", trustUrls: false });
        if (!result) throw fail(400, `${name} could not be read.`);
        // Without object storage (local development) the document comes back inline rather than linked.
        stored[index] = { url: result.url || result.data, key: result.key, fileName: name, mimeType: "application/pdf" };
      } else {
        photoIndexes.push(index);
      }
    }
    if (photoIndexes.length) {
      const photoFiles = photoIndexes.map((index) => files[index]);
      const photos = await storePhotos(photoFiles, "production/tickets");
      photoIndexes.forEach((originalIndex, photoIndex) => { stored[originalIndex] = photos[photoIndex]; });
    }
    return stored;
  } catch (error) {
    await imageStorage.discardUploads(stored.filter(Boolean));
    throw error;
  }
}

async function defaultStore(kind, files) {
  return kind === "TICKET" ? storeTickets(files) : storePhotos(files, "production/photos");
}

/**
 * A ticket upload may carry the travel mode it is picking (`travelMode`), so the mode never has to
 * be saved to the plan first - the effective mode is that, or else the plan's own saved one.
 */
const effectiveMode = (production, travelMode) => travelMode || production.travelMode;

async function addFiles(shootId, { kind, files, travelMode }, caller, deps = {}) {
  const { client = prisma, store = defaultStore, discard = imageStorage.discardUploads, now = () => new Date() } = deps;
  const today = studioDateKey(now());
  const production = await loadForWrite(client, shootId);
  assertSide(production, kind, caller);
  const refusal = S.fileAddRefusal(production, kind, today);
  if (refusal) throw fail(409, refusal);
  if (kind === "TICKET") {
    const preRefusal = ticketRefusal({ travelMode: effectiveMode(production, travelMode) });
    if (preRefusal) throw fail(400, preRefusal);
  }

  const allowed = kind === "TICKET" ? DOCUMENT_TYPES : PHOTO_TYPES;
  for (const file of files) {
    const type = mimeOf(file.data);
    if (!type || !allowed.has(type)) throw fail(400, `${file.name || "This file"} is not ${kind === "TICKET" ? "an image or a PDF" : "a JPEG, PNG or WebP photo"}.`);
  }
  const held = await client.projectProductionFile.count({ where: { productionId: production.id, kind } });
  if (held + files.length > S.FILE_LIMITS[kind]) throw fail(400, `Up to ${S.FILE_LIMITS[kind]} ${S.FILE_KIND_LABELS[kind].toLowerCase()}s can be kept on a shoot.`);

  const stored = await store(kind, files);
  try {
    await client.$transaction(async (tx) => {
      // Asked again inside the write: the step, who is named, and how many files are already held
      // can all have moved while the upload ran - most concretely two uploads racing each other
      // past the pre-check above and both landing here.
      let current = await loadForWrite(tx, shootId);
      assertSide(current, kind, caller);
      const stillRefused = S.fileAddRefusal(current, kind, today);
      if (stillRefused) throw fail(409, stillRefused);

      // Picking Bus, Train or Flight for the first time on the upload itself: set it on the plan
      // now, with the same clearing rule `plan.js` uses for a save (`travelData`), rather than
      // asking the Production Manager to save the plan before adding a ticket for it. Access is
      // already `canEditPlan` - `assertSide` above requires it for every TICKET upload.
      if (kind === "TICKET" && travelMode && travelMode !== current.travelMode) {
        const travel = await travelData(tx, current, { travelMode });
        await tx.projectProduction.update({ where: { id: current.id }, data: travel });
        await logActivity(tx, current.id, "PLAN_SAVED", `Travel mode set to ${travelMode}`, caller);
        current = { ...current, ...travel };
      }
      // The plan can have moved off Bus / Train / Flight while the upload ran.
      if (kind === "TICKET" && ticketRefusal(current)) throw fail(400, ticketRefusal(current));
      const heldNow = await tx.projectProductionFile.count({ where: { productionId: current.id, kind } });
      if (heldNow + stored.length > S.FILE_LIMITS[kind]) throw fail(400, `Up to ${S.FILE_LIMITS[kind]} ${S.FILE_KIND_LABELS[kind].toLowerCase()}s can be kept on a shoot.`);
      await tx.projectProductionFile.createMany({
        data: stored.map((file) => ({ productionId: production.id, kind, url: file.url, fileName: file.fileName, mimeType: file.mimeType || null, uploadedByUserId: caller.userId || null })),
      });
      await logActivity(tx, production.id, "FILE_ADDED", `${S.FILE_KIND_LABELS[kind]}: ${stored.map((file) => file.fileName).join(", ")}`, caller);
    });
  } catch (error) {
    await discard(stored);
    throw error;
  }
  return { productionId: production.id, added: stored.length };
}

async function removeFile(shootId, fileId, caller, deps = {}) {
  const { client = prisma, removeObject = objectStorage.deleteObject } = deps;
  const removed = await client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    const file = await tx.projectProductionFile.findFirst({ where: { id: String(fileId || ""), productionId: production.id }, select: { id: true, kind: true, url: true, fileName: true } });
    if (!file) throw fail(404, "File not found.");
    assertSide(production, file.kind, caller);
    const refusal = S.fileRemoveRefusal(production, file.kind);
    if (refusal) throw fail(409, refusal);
    await tx.projectProductionFile.delete({ where: { id: file.id } });
    await logActivity(tx, production.id, "FILE_REMOVED", `${S.FILE_KIND_LABELS[file.kind]}: ${file.fileName}`, caller);
    return { ...file, productionId: production.id };
  });
  // Best-effort, after the row is gone; `deleteObject` never throws and ignores inline data.
  await removeObject(removed.url);
  return { productionId: removed.productionId, removed: removed.id };
}

/**
 * Photo copy's answers, one per service booked on the shoot (Edit Project's allocations), or one for
 * the whole shoot (`serviceDefinitionId: null`) when it has none - every field but remarks required, every backup
 * person an active employee. The shape and the field limits are the controller's schema; this checks
 * that each service is answered exactly once and nothing else is. Returns the rows to write.
 */
async function photoCopyRows(tx, production, footage = [], statuses) {
  const keys = await photoCopyKeys(tx, production);
  const given = Array.isArray(footage) ? footage : [];
  const answered = given.map((entry) => entry.serviceDefinitionId ?? null);
  if (given.length !== keys.length || new Set(answered).size !== answered.length || !answered.every((key) => keys.includes(key))) {
    // No service of this shoot delivers files, so there is nothing to ask for and nothing to accept.
    if (!keys.length) throw fail(400, "No service on this shoot delivers files, so there is no photo copy to fill in.");
    throw fail(400, keys[0] === null ? "Fill in the photo copy for the shoot." : "Fill in the photo copy for every service of the shoot.");
  }
  const backups = [...new Set(given.map((entry) => entry.backedUpByEmployeeId))];
  const active = await tx.employee.findMany({ where: { id: { in: backups }, archivedAt: null, employmentStatus: { in: await statuses() } }, select: { id: true } });
  if (active.length !== backups.length) throw fail(400, "Choose an active employee for each footage backup.");
  return given.map((entry) => ({
    productionId: production.id,
    serviceDefinitionId: entry.serviceDefinitionId ?? null,
    footageUrl: entry.footageUrl,
    backedUpByEmployeeId: entry.backedUpByEmployeeId,
    fileCount: entry.fileCount,
    size: entry.size,
    firstFileName: entry.firstFileName,
    lastFileName: entry.lastFileName,
    remarks: String(entry.remarks || "").trim() || null,
  }));
}

/**
 * Clears the footage held for these services - and only these.
 *
 * `serviceDefinitionId` is nullable, and `IN (NULL)` matches nothing in SQL, so a shoot with no
 * services booked (its one answer carries no service) needs its own delete rather than a key in a
 * list. Nothing outside the list is touched: a row for a service the plan no longer books, or one
 * the old sheet imported under a name, keeps whatever it holds.
 */
async function clearFootage(tx, productionId, keys) {
  const ids = [...new Set(keys.filter((key) => key !== null))];
  if (ids.length) await tx.projectProductionFootage.deleteMany({ where: { productionId, serviceDefinitionId: { in: ids } } });
  if (keys.includes(null)) await tx.projectProductionFootage.deleteMany({ where: { productionId, serviceDefinitionId: null } });
}

/**
 * The services File in asks a copy for: the shoot's own, once each, and **only those that hand files
 * over** - Settings → Project → Services, "Deliverable added" (`deliverableAdded`). An LED wall or a
 * hired light brings nothing back to copy, and asking for a URL, a file count and a first and last
 * file name against it was five boxes somebody had to put something in to finish the step.
 *
 * Only an explicit Yes counts, which is how the quotation generator and the Settings table already
 * read the flag; a service nobody has answered it for is a No. So a studio that has not set it on
 * any service is asked for nothing here until it does.
 *
 * Three answers, and they are different things:
 *   - the services that deliver - a card each;
 *   - `[null]`, the single whole-shoot answer a shoot with **no services booked at all** gives, as
 *     it always has;
 *   - `[]`, a shoot whose services deliver nothing - there is no copy to make, and the step is
 *     finished by pressing it.
 */
async function photoCopyKeys(tx, production) {
  const booked = await tx.projectPostProductionAllocation.findMany({ where: { shootId: production.shootId, deletedAt: null, serviceDefinitionId: { not: null } }, select: { serviceDefinitionId: true, serviceDefinition: { select: { deliverableAdded: true } } } });
  if (!booked.length) return [null];
  return [...new Set(booked.filter((row) => row.serviceDefinition?.deliverableAdded === true).map((row) => row.serviceDefinitionId))];
}

/**
 * File in, saved as it stands: the services that have been filled in are kept and the step is left
 * where it is.
 *
 * Completing the step wants every service of the shoot answered, which is right - the step says the
 * whole shoot's footage is copied in. But the copying itself is done service by service, over hours,
 * sometimes by different people, and until this there was nowhere to put the first three while the
 * fourth card was still being read: the only button refused the lot, so the answers were kept on
 * paper and typed again at the end.
 *
 * **The row holds the service's answers as they stand.** Whatever is typed is written, and a box left
 * empty is written as empty (null - `20261024150000_footage_answers_nullable` made the five answers
 * nullable for this). A service with nothing at all in it has its row removed, which is how one
 * answered by mistake is taken back.
 *
 * It holds what is on the screen because that is what the person saving it means: they left this
 * card half filled, and reopening it has to show the card they left. An earlier version kept a
 * part-filled service's **saved** answers instead, on the reasoning that a row half written says a
 * copy was made that was not - but the effect was that clearing a box and saving brought the old
 * value back on the next open, which is the screen lying about what is stored. The rule that stops
 * a half-written row being read as a finished one belongs where the step finishes, not here:
 * `photoCopyRows` still wants every answer of every service before File in can be completed.
 *
 * So the save answers with how many services are fully answered and how many are still to come, and
 * the screen says so rather than claiming it all went.
 */
async function saveFootage(shootId, input, caller, deps = {}) {
  const { client = prisma, now = () => new Date(), statuses = workingEmployeeStatuses } = deps;
  return client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    if (!accessFor(production, caller).canRunSteps) throw fail(403, "Only the people named on this shoot who hold Production or Production Execution at Read / Write can fill in its File in.");
    const closed = S.executionRefusal(production, studioDateKey(now()));
    if (closed) throw fail(409, closed);
    const current = S.effectiveStep(production.currentStep, S.indoorOf(production));
    if (current !== "PHOTO_COPY") {
      throw fail(409, current === S.DONE ? "Every step of this shoot is already done." : `Finish "${S.STEP_LABELS[current]}" first.`);
    }

    const keys = await photoCopyKeys(tx, production);
    const given = Array.isArray(input.footage) ? input.footage : [];
    const answered = given.map((entry) => entry.serviceDefinitionId ?? null);
    if (new Set(answered).size !== answered.length || !answered.every((key) => keys.includes(key))) {
      throw fail(400, "Fill in the photo copy against the shoot's own services.");
    }

    const answerOf = (entry, field) => String(entry[field] ?? "").trim();
    const anyAnswer = (entry) => [...S.FOOTAGE_ANSWERS, "remarks"].some((field) => answerOf(entry, field));
    // Written as it stands; blank in every box, remarks included, is the service being taken back.
    const written = given.filter(anyAnswer);
    const emptied = given.filter((entry) => !anyAnswer(entry)).map((entry) => entry.serviceDefinitionId ?? null);
    const backups = [...new Set(written.map((entry) => Number(entry.backedUpByEmployeeId)).filter(Boolean))];
    if (backups.length) {
      const active = await tx.employee.findMany({ where: { id: { in: backups }, archivedAt: null, employmentStatus: { in: await statuses() } }, select: { id: true } });
      if (active.length !== backups.length) throw fail(400, "Choose an active employee for each footage backup.");
    }

    /*
     * The production's own row, locked and read as it stands, before anything is written.
     *
     * Two phones on the same shoot, or a save racing somebody's Complete photo copy: without this
     * both read a step of PHOTO_COPY and both wrote, one of them into a step that had just finished.
     * The update is conditional on the step not having moved, so the loser is told rather than
     * writing into a finished shoot, and the lock serialises two saves of the same service.
     */
    const { count: still } = await tx.projectProduction.updateMany({ where: { id: production.id, currentStep: production.currentStep }, data: { currentStep: production.currentStep } });
    if (!still) throw fail(409, "This step has just been completed by someone else.");

    // Written as a clear and a create, never a find and an update: a NULL service (a shoot with no
    // services booked) is not held to the unique key by MySQL, so two saves could answer it twice.
    await clearFootage(tx, production.id, [...emptied, ...written.map((entry) => entry.serviceDefinitionId ?? null)]);
    if (written.length) {
      const text = (entry, field) => answerOf(entry, field) || null;
      await tx.projectProductionFootage.createMany({
        data: written.map((entry) => ({
          productionId: production.id,
          serviceDefinitionId: entry.serviceDefinitionId ?? null,
          footageUrl: text(entry, "footageUrl"),
          backedUpByEmployeeId: Number(entry.backedUpByEmployeeId) || null,
          // The name beside the id is only for somebody the old sheet named who has left; an answer
          // given here names an employee, so the copy goes.
          backedUpByName: null,
          fileCount: Number(entry.fileCount) || null,
          size: text(entry, "size"),
          firstFileName: text(entry, "firstFileName"),
          lastFileName: text(entry, "lastFileName"),
          remarks: text(entry, "remarks"),
        })),
      });
    }

    // Fully answered, which is what the step is waiting for - a part-filled row is held but not done.
    const done = await tx.projectProductionFootage.count({
      where: { productionId: production.id, footageUrl: { not: null }, backedUpByEmployeeId: { not: null }, fileCount: { not: null }, size: { not: null }, firstFileName: { not: null }, lastFileName: { not: null } },
    });
    // Only where something actually moved: a form opened and saved untouched is not an event.
    // The label is the action's ("File in saved"), so the detail is the count alone.
    if (written.length || emptied.length) await logActivity(tx, production.id, "FOOTAGE_SAVED", `${done} of ${keys.length} ${keys.length === 1 ? "service" : "services"} filled in`, caller);
    /*
     * Three numbers, because they answer three different questions and the screen needs all of them:
     * `held` is how many services the save wrote - what was kept, whether finished or part way -,
     * `done` how many are fully answered, and `pending` how many the step is still waiting on. Only
     * `done` being 0 does not mean nothing was saved, which is what the notice used to say.
     */
    return { productionId: production.id, held: written.length, saved: done, pending: keys.length - done };
  });
}

/**
 * Completes the shoot's current step - only the current one, only after the plan is submitted,
 * only by somebody named on the shoot (`accessFor`). The update is conditional on the step still being
 * current, so two presses (or two phones) complete it once and send one message.
 */
async function completeStep(shootId, step, input, caller, deps = {}) {
  const { client = prisma, now = () => new Date(), statuses = workingEmployeeStatuses, notify = sendStepMessage } = deps;
  if (!S.STEPS.includes(step)) throw fail(400, "Unknown step.");
  const messageStep = S.MESSAGE_FOR_STEP[step] || null;

  let messageClaimed = false;
  const productionId = await client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    if (!accessFor(production, caller).canRunSteps) throw fail(403, "Only the people named on this shoot who hold Production or Production Execution at Read / Write can complete its steps.");
    const closed = S.executionRefusal(production, studioDateKey(now()));
    if (closed) throw fail(409, closed);
    // An indoor shoot has no travel steps, and one stored on a travel step is on its next step.
    const indoor = S.indoorOf(production);
    const current = S.effectiveStep(production.currentStep, indoor);
    if (!S.stepsFor(indoor).includes(step)) throw fail(400, `An indoor shoot has no "${S.STEP_LABELS[step]}" step.`);
    if (current !== step) {
      throw fail(409, current === S.DONE ? "Every step of this shoot is already done." : `Finish "${S.STEP_LABELS[current]}" first.`);
    }
    // A paused shoot is a shoot that has stopped: nothing moves on until somebody resumes it.
    if (S.isPaused(production)) throw fail(409, "This shoot is paused. Resume it before completing this step.");

    const data = { [S.STEP_TIME_FIELDS[step]]: now(), currentStep: S.nextStep(step, indoor) };
    /*
     * Happy clients **is** the end of the shoot, so it stamps the shoot Completed itself.
     *
     * The status was a step of its own until November 2026 - the coordinator said Completed after
     * having said the client was happy, which is the same fact twice. The column is still written
     * because everything downstream reads it: the project's own roll-up, the Shoot Board, the
     * production boards and the client's portal all ask whether a shoot is Completed, and none of
     * them should have to learn a new question.
     */
    if (step === S.COMPLETES_SHOOT) Object.assign(data, { shootStatus: S.COMPLETED_STATUS, shootStatusAt: now() });
    const photoKind = S.STEP_PHOTO_KINDS[step];
    if (photoKind) {
      const photos = await tx.projectProductionFile.count({ where: { productionId: production.id, kind: photoKind } });
      const needed = S.minPhotos(step);
      if (photos < needed) {
        throw fail(400, step === "PINEAPPLE_MEETING" ? "Add the pineapple meeting group photo."
          : needed > 1 ? `Add at least ${needed} ${S.STEP_LABELS[step].toLowerCase()} photos.` : `Add a photo for ${S.STEP_LABELS[step]}.`);
      }
    }
    const optionalRemarks = S.OPTIONAL_REMARK_FIELDS[step];
    if (optionalRemarks) data[optionalRemarks] = String(input.remarks || "").trim() || null;
    if (step === "PINEAPPLE_MEETING") {
      const remarks = String(input.remarks || "").trim();
      if (!remarks) throw fail(400, "Write the pineapple meeting remarks.");
      data.pineappleRemarks = remarks;
    }
    const footage = step === "PHOTO_COPY" ? await photoCopyRows(tx, production, input.footage, statuses) : null;

    // Conditional on the step as stored, so two presses complete it once.
    const { count } = await tx.projectProduction.updateMany({ where: { id: production.id, currentStep: production.currentStep }, data });
    if (!count) throw fail(409, "This step has just been completed by someone else.");
    // A pending save may already hold a row for some of these services: completing the step answers
    // for every one of them, so what it writes replaces those - and only those.
    if (footage) {
      await clearFootage(tx, production.id, footage.map((row) => row.serviceDefinitionId));
      await tx.projectProductionFootage.createMany({ data: footage });
    }
    await logActivity(tx, production.id, "STEP_COMPLETED", step, caller);
    // Atomic with completing the step: a process that dies anywhere after this commits still
    // leaves a row `retryMessage` can eventually reclaim, rather than a step nobody can retry. A
    // message switched off under Settings → Templates is not claimed, and so not sent.
    if (messageStep) messageClaimed = await claimSending(tx, production.id, messageStep);
    return production.id;
  });

  const message = messageClaimed ? await notifyAfter(notify, productionId, messageStep, caller, deps) : null;
  // The client's phone hears of it too - after the step is saved, never holding it up.
  if (CLIENT_PUSH[step]) clientPush.notifyShoot(shootId, (shoot) => ({ ...CLIENT_PUSH[step](shoot.shoot), data: { type: "shoot", step } }));
  return { productionId, message };
}


/**
 * Pause the shoot, or resume it.
 *
 * Not a step: a shoot stops where it stands and carries on from there, so this writes the status
 * across whichever step the shoot is on rather than moving it. A pause says **why** - the reason is
 * what the board, the Schedule and everybody waiting on the shoot actually need - and resuming says
 * why too, in the same box, since "it is going again" is as much a fact as the stop was.
 *
 * `shoot_status` and its remarks are the same columns Happy clients writes Completed into, so the
 * boards, the Shoot Board and the Schedule all read a paused shoot without being taught anything new.
 */
async function pauseShoot(shootId, input, caller, deps = {}) {
  const { client = prisma, now = () => new Date() } = deps;
  const paused = Boolean(input.paused);
  const remarks = String(input.remarks || "").trim();
  if (!remarks) throw fail(400, paused ? "Write why the shoot is paused." : "Write why the shoot is resuming.");

  return client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    if (!accessFor(production, caller).canRunSteps) throw fail(403, "Only the people named on this shoot who hold Production or Production Execution at Read / Write can pause it.");
    const closed = S.executionRefusal(production, studioDateKey(now()));
    if (closed) throw fail(409, closed);
    const refusal = S.pauseRefusal(production, paused);
    if (refusal) throw fail(409, refusal);

    // Read before the write: what the shoot was is what the log line says it changed from.
    const was = S.SHOOT_STATUS_LABELS[production.shootStatus] || "Running";
    const status = paused ? S.PAUSED_STATUS : S.RESUMED_STATUS;
    // Conditional on the status as stored, so two taps pause it once.
    const { count } = await tx.projectProduction.updateMany({
      where: { id: production.id, shootStatus: production.shootStatus },
      data: { shootStatus: status, shootStatusRemarks: remarks, shootStatusAt: now() },
    });
    if (!count) throw fail(409, "Somebody else has just changed this shoot's status.");
    await logActivity(tx, production.id, "SHOOT_STATUS_CHANGED", `${was} → ${S.SHOOT_STATUS_LABELS[status]}: ${remarks}`, caller);
    return { productionId: production.id, paused };
  });
}

module.exports = { saveFootage, addFiles, removeFile, defaultStore, storeTickets, storePhotos, completeStep, pauseShoot };
