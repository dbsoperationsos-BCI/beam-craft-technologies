const { z } = require("zod");
const { syncShootLinkedDueDates } = require("../../../services/shootLinkedDueDates");
const prisma = require("../../../config/db");
const { Prisma } = require("@prisma/client");
const { lookups } = require("../../../services/referenceMatchers");
// Through the module rather than destructured, so a test can stand the scope in.
const projectScope = require("../../../services/projectScope");
const { NAME_BY_CODE } = require("../../../services/salesVertical");
const projects = require("../../sales/projects/controller");
const { preProductionUpdateSchema } = require("./controller");
const { ensureProjectPreProduction } = require("./service");
const { ensureProjectProduction } = require("../production/service");
const clientStorage = require("../../assets/client-storage.service");
const clientStorageFlow = require("../../assets/client-storage.controller");
const importPeople = require("../../../services/importPeople");
const { importColumns, PEOPLE, NOT_PRE_PRODUCTION } = require("./importColumns");

/*
 * One row of Pre Production → Import written to the database. The columns, the cell parsers and
 * the row's schema are in `importColumns.js`; the routes in `import.js`.
 *
 * 1. The project is found by the sheet's Event ID (`sheetEventId`), or created **under that Event
 *    ID** - the booking keeps the number the studio has always known it by, rather than taking a new
 *    one from the app's counter. Every shoot row of one booking lands on the same project.
 * 2. The shoot is found by the sheet's Shoot ID (`sheetShootId`), or created under it the same way.
 *
 *    A project or shoot that was **already in the app** - typed there, found by its client name, or
 *    a shoot of that project with the same name - keeps its own ID and is given the sheet's beside
 *    it (`sheet_event_id` / `sheet_shoot_id`), so it holds both. What then happens to its details
 *    differs by what the record is for: a **project** keeps what the app holds and the sheet only
 *    fills what is empty (its name, its payments and its gallery are the app's business), while a
 *    **shoot** is written from the sheet - the old sheet is the record of when and where a shoot
 *    ran, so a date, place or timing it gives replaces the app's, and only a cell it leaves empty
 *    is left alone. The two ID shapes cannot meet: the sheet's are `DBS-EVT-05640` /
 *    `DBS-SID-5845`, the app's `DBS-BK-DD-ERD-000001` / `DBS-SID-DD-ERD-000001`. An ID already
 *    held by another row is refused by name rather than left to the unique index.
 * 3. The people are named by Employee Code, or by a name that is exactly one active employee's; a
 *    name that is nobody's working here now - somebody who has left - is kept as written with
 *    nothing linked (`resolvePeople`). The project is started, which is what raises its pre
 *    production row (`ensureProjectPreProduction`).
 * 4. That row is filled in through the board's own save schema.
 *
 * Uploading the same file twice therefore updates rather than duplicates. A second upload is a way
 * to finish what the first left blank, not a second way to edit a project: it reaches only projects
 * the caller could edit by hand, it names people only where nobody is named yet, and it never moves
 * a project's status or branch.
 *
 * There is no enquiry: these bookings predate the CRM, so `enquiryId` is left null, which the column
 * allows for exactly this kind of legacy row (`npm run report:lead-keys` lists them). Nor is there a
 * reserved WhatsApp group name: the sheet's Client Name is stored as the group name's text, and the
 * Client Name column on the board shows it as it is.
 */

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** A zod failure on one of the reused schemas, named by the column heading the studio reads. */
function refusal(error, labels) {
  const issue = error.issues[0];
  const label = labels.get(issue.path?.[0]) || String(issue.path?.[0] || "");
  return label ? `${label}: ${issue.message}` : issue.message;
}

/*
 * Each people cell to the person it names (`services/importPeople.js`, shared with Production →
 * Import). An Employee Code, or a name that is exactly one working employee's, links that employee.
 * Anybody else - somebody who has left, whose name the old sheet still carries - is kept as the name
 * alone with nothing linked: the name column is the copy the board prints, and with no id beside it
 * it is shown as written (`resolvedNames`).
 */
async function resolvePeople(transaction, row, refs) {
  const named = PEOPLE.filter(({ field }) => row[field]);
  const resolved = await importPeople.resolvePeople(transaction, refs, named.map((person) => row[person.field]));
  return named.map((person, index) => ({ ...person, ...resolved[index] }));
}

/** The sheet's ID for this row, unless another project or shoot already holds it. */
async function claimSheetId(model, column, value, ownId, label) {
  const holder = await model.findUnique({ where: { [column]: value }, select: { id: true } });
  if (holder && holder.id !== ownId) throw fail(`${label} ${value} is already used by another ${label === "Event ID" ? "project" : "shoot"} in the app.`);
  return value;
}

/*
 * Restore: a project or shoot deleted in the app, named again by a re-uploaded row, is brought back
 * - only when "Restore deleted projects and shoots" is ticked. Unticked, the row is refused as it
 * always was: somebody deleted it, and an old file uploaded again must not quietly undo that.
 *
 * Restored means undeleted - the same row, the same IDs - and then updated from the sheet like any
 * other row, so a restore never makes a duplicate. A restored project comes back with **only the
 * shoots the file names**: deleting a project hid its shoots without marking them, so they are
 * marked deleted as it is restored, and each row then restores its own shoot (`restoreShoot`). A
 * shoot the file no longer lists stays deleted, rather than returning with the project unasked.
 * Only what the import itself made comes back:
 * deleting a project also turned off its client's login, hid its Image Selection gallery and took
 * its hard discs off Client Storage, and deleting a shoot took its deliverables and allocations
 * with it. None of that is the sheet's to put back, so a project or shoot that carried any of it is
 * refused by name, to be restored by hand. Restoring a project answers to the rule that deleting
 * one does (`mayDeleteProject`), as Replace does.
 */
async function restoreProject(transaction, project, restore) {
  if (!restore) throw fail(`Event ID ${project.sheetEventId} was deleted in the app. Tick "Restore deleted projects and shoots" to bring it back.`);
  if (!(await projects.mayDeleteProject(project, restore.user))) throw fail(`Event ID ${project.sheetEventId} was deleted, and you may not restore it.`);
  const [galleries, logins, discs] = await Promise.all([
    transaction.imageSelectionProject.count({ where: { salesProjectId: project.id } }),
    transaction.user.count({ where: { clientProjectId: project.id } }),
    transaction.clientStorage.count({ where: { projectId: project.id } }),
  ]);
  const holds = [galleries && "an Image Selection gallery", logins && "a client login", discs && "client storage"].filter(Boolean);
  if (holds.length) throw fail(`Event ID ${project.sheetEventId} was deleted with ${holds.join(" and ")}, so it is not restored. Restore it by hand.`);
  const restored = await transaction.salesProject.updateMany({ where: { id: project.id, deletedAt: { not: null } }, data: { deletedAt: null, deletedByUserId: null } });
  if (restored.count !== 1) throw fail(`Event ID ${project.sheetEventId} was changed meanwhile. Upload the file again.`);
  // Its shoots stay deleted until a row names them - see the comment above.
  await transaction.projectShoot.updateMany({ where: { projectId: project.id, deletedAt: null }, data: { deletedAt: new Date() } });
  // A payment that followed one of them waits until a row brings its shoot back.
  await syncShootLinkedDueDates(transaction, project.id);
  restore.onRestored?.({ kind: "Project", id: project.sheetEventId, name: project.whatsappGroupName });
}

async function restoreShoot(transaction, shoot, restore) {
  if (!restore) throw fail(`Shoot ID ${shoot.sheetShootId} was imported before and has since been deleted. Tick "Restore deleted projects and shoots" to bring it back.`);
  const where = { shootId: shoot.id, deletedAt: { not: null } };
  const [deliverables, allocations, workflows] = await Promise.all([
    transaction.projectShootDeliverable.count({ where }),
    transaction.projectPostProductionAllocation.count({ where }),
    transaction.projectPostProductionWorkflowAllocation.count({ where }),
  ]);
  if (deliverables + allocations + workflows) throw fail(`Shoot ID ${shoot.sheetShootId} was deleted with its deliverables and post production, so it is not restored. Restore it by hand.`);
  const restored = await transaction.projectShoot.updateMany({ where: { id: shoot.id, deletedAt: { not: null } }, data: { deletedAt: null } });
  if (restored.count !== 1) throw fail(`Shoot ID ${shoot.sheetShootId} was changed meanwhile. Upload the file again.`);
  restore.onRestored?.({ kind: "Shoot", id: shoot.sheetShootId, name: shoot.shoot });
}

const peopleData = (people) => Object.fromEntries(people.flatMap((person) => [[person.idField, person.id], [person.nameField, person.name]]));

/*
 * What the sheet says about the **booking** rather than the shoot: the sales note each stage reads,
 * the General panel's two gifts, and whether the booking needs client storage. Each is the studio's
 * own answer or words, so on a project already in the app only one it has not given is filled in
 * (`unanswered` below) - the sheet never overrules a studio that has since said otherwise.
 */
const projectAnswers = (row) => ({
  ...(row.salesPreProductionRemarks ? { salesPreProductionRemarks: row.salesPreProductionRemarks } : {}),
  ...(row.salesProductionRemarks ? { salesProductionRemarks: row.salesProductionRemarks } : {}),
  ...(row.salesPostProductionRemarks ? { salesPostProductionRemarks: row.salesPostProductionRemarks } : {}),
  ...(row.welcomeGift ? { welcomeGift: row.welcomeGift } : {}),
  ...(row.shootCompletedGift ? { shootCompletedGift: row.shootCompletedGift } : {}),
  ...(row.storageNeeded ? { storageNeeded: row.storageNeeded } : {}),
  ...(row.projectValidityMonths ? { projectValidityMonths: row.projectValidityMonths } : {}),
});

/*
 * A gift answer carries its tracking with it, through the General panel's own `applyGiftTracking`:
 * an Applicable gift with no status yet is set Pending, which is what puts it on the Client Gifts tab,
 * and a Not Applicable one clears the status, the dates and the assignee - so a sheet saying "no gift"
 * cannot leave an assignee named on a gift nobody is giving. Reused rather than copied, or the import
 * and the panel would drift.
 *
 * No `project_applicability_change` row is written: that history records a studio **switching** an
 * answer, and a first answer - which is all the import ever gives, since an answer already there is
 * left alone - is not a switch. The panel writes none for one either.
 */
const withGiftTracking = (answers, project) => projects.applyGiftTracking(answers, project);

/** Which gift each late people cell is the assignee of (`PEOPLE`'s `late` entries). */
const GIFT_OF = { welcomeGiftCode: "welcomeGift", shootCompletedGiftCode: "shootCompletedGift" };

/**
 * The people to write, less an assignee for a gift that is not being given: `applyGiftTracking`
 * clears that assignee, and writing one back from the sheet's code column would leave somebody named
 * on a gift nobody is giving. The answer read is the one that will stand - the sheet's where it gives
 * one, else the project's own.
 */
const giftablePeople = (people, answers, project) => people.filter((person) => {
  const gift = GIFT_OF[person.field];
  return !gift || (answers[gift] ?? project[gift]) !== "Not Applicable";
});

/** Whether this project is one the caller could edit by hand - the same rule Edit Project answers to. */
async function mayUpdate(transaction, projectId, userId) {
  const reachable = await transaction.salesProject.findFirst({
    where: { id: projectId, deletedAt: null, AND: [await projectScope.projectAccessWhere({ userId, forWrite: true })] },
    select: { id: true },
  });
  return Boolean(reachable);
}

/** The project a row lands on: the one its Event ID was imported as before, or a new one. */
async function projectForRow(transaction, { vertical, row, userId, refs, people, clientMainNumber, replace = null, restore = null, onLinked = null }) {
  const details = {
    whatsappGroupName: row.whatsappGroupName,
    clientMainNumber,
    ...(row.initialConvertedValue !== undefined ? { initialConvertedValue: row.initialConvertedValue } : {}),
    // The sheet's own day for the booking, which is what the date-ordered lists read (`createdAt`).
    ...(row.projectCreatedAt ? { createdAt: row.projectCreatedAt } : {}),
    ...withGiftTracking(projectAnswers(row), {}),
  };
  const existing = await transaction.salesProject.findUnique({ where: { sheetEventId: row.sheetEventId } });

  /*
   * A project already holding this row's Event ID - one imported before, or one typed into the app and
   * linked to the sheet by its client name (below). A second upload finishes what the first left
   * blank and edits nothing else: the group name is the key a client is found by and is left as it is,
   * and a client number or value already there is kept - the sheet fills them only when they are empty.
   */
  const updateExisting = async (existing) => {
    if (existing.deletedAt) await restoreProject(transaction, existing, restore);
    // Decided by the project's own branch and scope, never by the Branch the row names: a row is
    // not a way to reach a project in somebody else's branch by quoting its Event ID.
    if (!(await mayUpdate(transaction, existing.id, userId))) {
      throw fail(`Event ID ${row.sheetEventId} is not a project you can update.`);
    }
    await projects.validateSourceBranch(transaction, existing.sourceBranch, userId);
    // A project typed into the app may hold the vertical's name ("Dum Dum") where the import holds its
    // code, or only the vertical's key.
    const verticalId = refs.verticalId(vertical);
    if (![vertical, NAME_BY_CODE[vertical]].includes(existing.vertical) && !(verticalId && existing.verticalId === verticalId)) {
      throw fail(`Event ID ${row.sheetEventId} was imported as ${NAME_BY_CODE[existing.vertical] || existing.vertical}, not ${NAME_BY_CODE[vertical]}.`);
    }
    // Somebody already named stays named; reassigning is Edit Project's, with its own permission.
    const unnamed = people.filter((person) => !existing[person.idField]);
    // The project keeps its own Event ID: the sheet's is held beside it (`sheet_event_id`), so a project
    // that was in the app before keeps the number the app gave it as well as the sheet's.
    const unanswered = Object.fromEntries(Object.entries(projectAnswers(row)).filter(([field]) => !existing[field]));
    const answered = withGiftTracking(unanswered, existing);
    const empty = {
      ...answered,
      /*
       * The booking's day is the sheet's to give, on a project it created and on one it is linked to:
       * nothing in the app edits `created_at`, so there is no answer of the studio's to keep here -
       * only the import's own upload day, which is what this column exists to correct.
       */
      ...(row.projectCreatedAt ? { createdAt: row.projectCreatedAt } : {}),
      ...(clientMainNumber && !existing.clientMainNumber ? { clientMainNumber } : {}),
      ...(details.initialConvertedValue && !Number(existing.initialConvertedValue || 0) ? { initialConvertedValue: details.initialConvertedValue } : {}),
    };
    return transaction.salesProject.update({ where: { id: existing.id }, data: { ...empty, ...peopleData(giftablePeople(unnamed, answered, existing)) } });
  };
  if (existing) return updateExisting(existing);

  // The studio's own spelling of the branch, so "erode tn" files under "Erode TN"; then the same
  // check a typed project answers to.
  const sourceBranch = refs.branchName(row.sourceBranch);
  await projects.validateSourceBranch(transaction, sourceBranch, userId);

  /*
   * A booking already typed into the app has no sheet Event ID to be found by, so its rows would
 * otherwise come in as a second copy of it. One in the same vertical with the same client number,
 * or the same client name as written (the group name; the column compares without regard to case,
 * and the sheet's own spacing is tried as well as single-spaced), is found instead. One by name is
 * kept and linked to the sheet (or, with Replace, deleted for the sheet's); one by number alone, or a
 * name on two projects, is refused - and a project is named only to somebody who may see it. The
 * name matters because many old rows carry no number at all.
 */
  const clientName = row.whatsappGroupName.trim();
  const sameVertical = { OR: [{ vertical: { in: [vertical, NAME_BY_CODE[vertical]] } }, ...(refs.verticalId(vertical) ? [{ verticalId: refs.verticalId(vertical) }] : [])] };
  const typedSelect = { id: true, eventId: true, whatsappGroupName: true, ...Object.fromEntries(projects.PROJECT_STAFF_FIELDS.map((field) => [field, true])) };
  // By the name first: it is what decides a replace, and more than one is a question for a person.
  const named = await transaction.salesProject.findMany({
    where: { sheetEventId: null, deletedAt: null, AND: [sameVertical, { whatsappGroupName: { in: [...new Set([clientName, clientName.replace(/\s+/g, " ")])] } }] },
    select: typedSelect,
    take: 5,
  });
  if (named.length > 1) {
    const seen = [];
    for (const project of named) if (await mayUpdate(transaction, project.id, userId)) seen.push(project.eventId);
    throw fail(`This client name is on ${named.length} projects in the app${seen.length ? ` (${seen.join(", ")})` : ""}, so nothing is replaced. Remove this row, or delete the extra ones first.`);
  }
  if (named.length === 1) {
    const typed = named[0];
    if (!(await mayUpdate(transaction, typed.id, userId))) throw fail("This client already has a project in the app. Remove this row.");
    /*
     * Replace only where it can: ticked, allowed to delete this project, and the project holds nothing a
     * delete would lose - payments, an Image Selection gallery. Anywhere else the app's project is kept
     * and **linked**: given the sheet's Event ID beside its own, and the sheet's details added where the
     * app has none (`updateExisting`). Its rows then follow the sheet's IDs, which is
     * what Production and Post Production imports find a shoot by.
     */
    const blocked = replace ? await replaceBlockers(transaction, typed, replace.user) : null;
    if (!replace || blocked) {
      const linked = await transaction.salesProject.update({ where: { id: typed.id }, data: { sheetEventId: row.sheetEventId } });
      onLinked?.({ eventId: typed.eventId, sheetEventId: row.sheetEventId, clientName: typed.whatsappGroupName, reason: blocked || null });
      return updateExisting(linked);
    }
    await replaceProject(transaction, typed, { userId, replace });
  } else {
    // The number alone is never replaced: one client can book twice, under two names. Without a
    // number there is nothing to match - every project with none would otherwise look the same.
    const byNumber = clientMainNumber ? await transaction.salesProject.findFirst({ where: { sheetEventId: null, deletedAt: null, clientMainNumber, AND: [sameVertical] }, select: { id: true, eventId: true } }) : null;
    if (byNumber) {
      throw fail(await mayUpdate(transaction, byNumber.id, userId)
        ? `This client's number is already on project ${byNumber.eventId} under another name, so it is not imported. Remove this row or check the number.`
        : "This client already has a project in the app. Remove this row.");
    }
  }

  return transaction.salesProject.create({
    data: {
      ...details,
      ...peopleData(giftablePeople(people, projectAnswers(row), {})),
      initialConvertedValue: row.initialConvertedValue ?? 0,
      // The project form's own default; the old sheet does not say.
      deliverables: "As per Quote",
      enquiryId: null,
      vertical,
      verticalId: refs.verticalId(vertical),
      sourceBranch,
      branchId: refs.branchId(sourceBranch),
      eventId: await claimSheetId(transaction.salesProject, "eventId", row.sheetEventId, null, "Event ID"),
      sheetEventId: row.sheetEventId,
      projectStatus: row.projectStatus || "In Progress",
      createdByUserId: userId,
    },
  });
}

/*
 * Replace: the project already in the app for this client is deleted and the sheet's booking is
 * imported in its place, chosen by ticking "Replace projects that already exist" in the dialog.
 *
 * Only on the **client name**: a project found only by its number is still refused, because one
 * client can book twice. And only a project that holds nothing that cannot be brought back - a
 * project with payments recorded against it, or an Image Selection gallery, is kept and linked
 * instead (`replaceBlockers`), because deleting it would hide those payments and erase those photos
 * for good. The caller must also be allowed to delete it, by the same rule as the Delete button
 * (`mayDeleteProject`); one they may not is linked the same way.
 *
 * The project is deleted the way the Delete button deletes one (`retireProjectWithin`), inside the
 * row's transaction - so a row that fails afterwards leaves the old project standing.
 */
/** What a project holds that a delete would lose, or that the caller may not delete it - said in a phrase, or null. */
async function replaceBlockers(transaction, typed, user) {
  if (!(await projects.mayDeleteProject(typed, user))) return "you may not delete it";
  const holds = await holdsOf(transaction, typed.id);
  return holds.length ? `it has ${holds.join(" and ")}` : null;
}

async function holdsOf(transaction, projectId) {
  const [payments, galleries] = await Promise.all([
    transaction.cashEntry.count({ where: { projectId, deletedAt: null } }),
    transaction.imageSelectionProject.count({ where: { salesProjectId: projectId, deletedAt: null } }),
  ]);
  return [payments && `${payments} payment${payments === 1 ? "" : "s"}`, galleries && "an Image Selection gallery"].filter(Boolean);
}

async function replaceProject(transaction, typed, { userId, replace }) {
  if (!(await projects.mayDeleteProject(typed, replace.user))) throw fail(`Project ${typed.eventId} matches, but you may not delete it, so it is not replaced.`);
  // Claimed the way the Delete button claims it - only if nobody has deleted it meanwhile - so two
  // uploads, or an upload and the button, cannot both replace one project.
  const deletedAt = new Date();
  const claimed = await transaction.salesProject.updateMany({ where: { id: typed.id, deletedAt: null }, data: { deletedAt } });
  if (claimed.count !== 1) throw fail(`Project ${typed.eventId} was changed meanwhile, so it is not replaced. Upload the file again.`);
  // Counted after the claim, in the same transaction: a payment recorded a moment ago is seen, and
  // the throw takes the claim back with it.
  const holds = await holdsOf(transaction, typed.id);
  // Seen only when one was added between the check above and this claim: the row is undone, and an
  // upload again then keeps and links the project.
  if (holds.length) throw fail(`Project ${typed.eventId} took ${holds.join(" and ")} while this file was importing, so it is not replaced. Upload the file again.`);
  await projects.retireProjectWithin(transaction, typed.id, { userId, deletedAt });
  replace.onReplaced?.({ eventId: typed.eventId, clientName: typed.whatsappGroupName });
}

/*
 * The shoot as the sheet gives it. Only its name is required - the column cannot be empty; the
 * place, district, state, type and session timing are kept when the sheet has them and left empty
 * when it does not, to be filled in on the shoot form, rather than refusing the row or inventing a
 * value. The shoot form's own checks still apply to every shoot saved there.
 */
function importedShoot(row, vertical, { lenient = false } = {}) {
  const name = String(row.shoot || "").trim();
  if (!name) throw fail("Shoot Name is required.");
  const text = (value, max) => (value === undefined || value === null ? null : String(value).trim().slice(0, max) || null);
  const types = Array.isArray(row.shootTypes) ? row.shootTypes : [];
  const timings = Array.isArray(row.sessionTimings) ? row.sessionTimings : [];
  let hours = null;
  if (row.sessionDurationHours !== undefined) {
    hours = Number(row.sessionDurationHours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 24) {
      if (!lenient) throw fail("Session Hours: enter the hours as a whole number.");
      hours = null;
    }
  }
  const hourly = timings.includes("Hourly");
  return {
    dateCreated: row.dateCreated || null,
    shoot: name.slice(0, 100),
    shootPlace: text(row.shootPlace, 191),
    district: text(row.district, 191),
    state: text(row.state, 191),
    shootTypes: types.length ? types : null,
    shootType: types[0] || null,
    sessionTimings: timings.length ? timings : null,
    sessionTiming: timings[0] || null,
    // The day's length, worked out the way the shoot form works it out from the timing.
    sessionDurationHours: hourly ? hours : timings.includes("Full Session") ? 12 : timings.includes("Half Session") ? 5 : hours,
    sessionDurationMinutes: hourly ? 0 : null,
    isMainEvent: Boolean(row.isMainEvent),
    // A wedding covers one side or both; every other vertical is "Both", as the shoot form has it.
    preference: vertical === "WED" && ["Groom", "Bride", "Both"].includes(row.preference) ? row.preference : "Both",
  };
}

/**
 * A mobile number as the app stores it. Indian numbers are the rule: "9443634232" and
 * "919443634232" are "+91 9443634232". A number from abroad written without its "+" - a Malaysian
 * "60166802197" - cannot be split into its country code and the rest with certainty, so it is kept
 * as written with the "+" in front, to be corrected on the project; anything that is not a phone
 * number at all is refused.
 */
function indianNumber(raw) {
  /*
   * An old sheet writes a second number into the same cell ("9443634232 / 9876543210", "... or ..."),
   * and the project holds one Client Number. Each is read in turn and the first that can be read is
   * taken, the rest left to the project's own form - trying each rather than only the first, so a
   * cell whose first entry is unreadable still gives the number beside it.
   */
  const parts = String(raw ?? "").trim().split(/\s*(?:[,/;&]|\bor\b|\band\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      const read = indianNumber(part);
      if (read) return read;
    }
    return null;
  }
  const value = String(raw ?? "").trim();
  const compact = value.replace(/[\s-]/g, "");
  if (compact.startsWith("+91")) return projects.normalizeClientMainNumber(value);
  // Another country's code is kept as written: where it ends is not something to guess.
  if (compact.startsWith("+")) return /^\+\d{8,15}$/.test(compact) ? compact : null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+91 ${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2)}`;
  if (digits.length >= 8 && digits.length <= 15 && digits === value.replace(/[\s-]/g, "")) return `+${digits}`;
  return null;
}

// Thrown to roll a preview's transaction back once the row has been worked through in full.
const PREVIEW = Symbol("preview");

const sameText = (a, b) => String(a || "").trim().replace(/\s+/g, " ").toLowerCase() === String(b || "").trim().replace(/\s+/g, " ").toLowerCase();
const dayOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/**
 * A shoot of this project that was added in the app, not yet given a sheet Shoot ID, which this row
 * is: the same name on the same day. The row then gives it the sheet's Shoot ID and fills it in.
 *
 * Only one is ever taken. Two with the name are told apart by the day; if that still leaves more
 * than one, or the one with the name is on another day, nothing is guessed and the row says so -
 * linking it is then done by hand, rather than the sheet's shoot landing on the wrong one or
 * becoming a second copy of it.
 */
async function appShootFor(transaction, projectId, row, shoot) {
  const candidates = (await transaction.projectShoot.findMany({
    where: { projectId, deletedAt: null, sheetShootId: null },
    select: { id: true, shoot: true, dateCreated: true },
    // A fixed order, so which of several of a name a row takes is the same on every upload.
    orderBy: [{ dateCreated: "asc" }, { createdAt: "asc" }],
  })).filter((candidate) => sameText(candidate.shoot, shoot.shoot));
  if (!candidates.length) return null;
  // One shoot of the name **is** the sheet's shoot, whatever date either side holds: the row then
  // updates it from the sheet, its date included. The old sheet is the record of when a shoot ran,
  // and a date it corrects is the reason to take the sheet's.
  if (candidates.length === 1) return candidates[0];
  /*
   * Several of the name - a booking with three "Rituals" - are told apart by the day where it says,
   * and otherwise the first unlinked one is taken. A project's three Rituals rows then pair with its
   * three Rituals shoots one for one, because each shoot linked here carries the sheet's Shoot ID
   * afterwards and is no longer offered: which of the three a row lands on does not matter, since the
   * row writes the shoot from the sheet either way.
   */
  const wanted = dayOf(shoot.dateCreated);
  const sameDay = candidates.filter((candidate) => wanted && candidate.dateCreated && dayOf(candidate.dateCreated) === wanted);
  if (sameDay.length) return sameDay[0];
  // No day says which. One of them with no date of its own is taken before one that has a date, so a
  // row of an unknown day fills a blank rather than writing its day over a day the app already holds.
  return candidates.find((candidate) => !candidate.dateCreated) || candidates[0];
}

/** What a re-upload writes to a shoot already there: only what the sheet gave. An empty cell never erases. */
function shootUpdate(shoot, row) {
  const given = Object.fromEntries(Object.entries(shoot).filter(([, value]) => value !== null && value !== undefined));
  // Defaults the import made up for a new shoot are not the sheet speaking.
  if (row.isMainEvent === undefined) delete given.isMainEvent;
  if (!["Groom", "Bride", "Both"].includes(row.preference)) delete given.preference;
  // A timing and its minutes are one answer: a timing given that is not Hourly clears stale minutes.
  if (given.sessionTimings) given.sessionDurationMinutes = shoot.sessionDurationMinutes ?? null;
  // A place the sheet gives replaces the shoot's, so any place-per-shoot it held no longer stands.
  if (given.shootPlace || given.district || given.state) given.shootLocations = Prisma.DbNull;
  return given;
}

/*
 * The project's Client Storage record, where the booking needs one: raised by the register's own
 * `ensureProjectClientStorage`, which numbers it and links it to the project and its earliest shoot -
 * the same call a project starting in the app makes, so a disc imported and one booked here are the
 * same record.
 *
 * "Received The Storage" = Yes then marks it **Delivered**, the end of the register's flow. Written
 * straight rather than walked through the eight moves in between, because the sheet is the record of
 * a disc already seen through and the moves it would log never happened in the app; the record
 * therefore carries no hand-in, backup or transit detail, which is the cost of importing it at all.
 *
 * Delivered only where the register would let a disc rest there: a project with a shoot still to come
 * sends a delivered disc back round for that shoot (`shootStatusPendingFor`, the rule the status-change
 * guard answers to), so an upcoming booking keeps its record at "Yet to Receive" rather than being
 * written to a state the register would never have allowed. A record the studio has moved on already,
 * or removed with a reason, is left exactly as it is.
 */
async function storageForRow(transaction, projectId, row, userId) {
  const record = await clientStorage.ensureProjectClientStorage(transaction, projectId, { userId });
  if (!record || !row.storageReceived || record.isDeleted || record.status !== "Yet to Receive") return;
  if (await clientStorageFlow.shootStatusPendingFor({ projectId }, transaction)) return;
  await transaction.clientStorage.update({ where: { id: record.id }, data: { status: "Delivered", updatedBy: userId } });
}

/*
 * The sheet's Studio Start Date and Time are Production's now (`ProjectProduction.studioStart*`), so
 * they go on the shoot's production row, replacing what it holds as every other answer the sheet gives
 * does. A shoot whose production is not raised yet keeps them on pre production's old columns, which
 * are carried over when it is (`ensureProjectProduction`).
 */
const studioStartSchema = z.object({
  studioStartDate: z.date({ message: "Enter a date as DD/MM/YYYY." }).nullable().optional(),
  studioStartTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time as HH:MM").nullable().optional(),
});

async function studioStartForRow(transaction, shootId, { studioStartDate, studioStartTime }) {
  const data = Object.fromEntries(Object.entries({ studioStartDate, studioStartTime }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  if (!Object.keys(data).length) return;
  const { count } = await transaction.projectProduction.updateMany({ where: { shootId }, data });
  if (!count) await transaction.projectPreProduction.updateMany({ where: { shootId }, data });
}

async function importRow({ vertical, row, userId, replace: replaceOption = null, restore: restoreOption = null, preview = false, lenient = false, onLinked: onLinkedOption = null }) {
  let replace = replaceOption;
  let restore = restoreOption;
  let onLinked = onLinkedOption;
  const labels = new Map(importColumns(vertical).map((c) => [c.field, c.label]));

  const shoot = importedShoot(row, vertical, { lenient });

  /*
   * The event's start and end are taken as the sheet writes them - a reception from 10 PM to 4 AM
   * ends the next morning, which the board's own check (end after start) would refuse - so they are
   * read beside the rest of the pre production answers rather than through that check.
   */
  const { eventStartTime, eventEndTime, studioStartDate, studioStartTime, ...rest } = row;
  const preProduction = preProductionUpdateSchema.safeParse(Object.fromEntries(Object.entries(rest).filter(([field]) => !NOT_PRE_PRODUCTION.has(field))));
  if (!preProduction.success) throw fail(refusal(preProduction.error, labels));
  const { eventStartTime: _start, eventEndTime: _end, ...answers } = preProduction.data;
  // Production's now, but read from this sheet: held to the plan's own rules, and refused by name.
  const studioStart = studioStartSchema.safeParse({ studioStartDate, studioStartTime });
  if (!studioStart.success) throw fail(refusal(studioStart.error, labels));

  // Empty when the sheet has none, to be added on the project; see `indianNumber` for the rest.
  const clientMainNumber = row.clientMainNumber ? indianNumber(row.clientMainNumber) : null;
  // `lenient` is the dialog's "Import rows with errors": a cell this cannot read comes in empty and the
  // row still imports, rather than the row being thrown away for it (`services/tableImport.js`).
  if (row.clientMainNumber && !clientMainNumber && !lenient) throw fail("Client Number: write a mobile number - 10 digits, or with its country code.");
  // A booking cannot have been made after today: a mistyped year would file the project ahead of every
  // live one in the date-ordered registers, where nothing in the app can correct it.
  if (row.projectCreatedAt && row.projectCreatedAt.getTime() > Date.now()) {
    if (!lenient) throw fail("Date Created: the booking cannot have been made in the future.");
    delete row.projectCreatedAt;
  }

  /*
   * What the row linked, replaced and restored is said only once the row has gone through (or been
   * previewed): a row that fails later rolls all of it back, and must not be reported as having done it.
   */
  const said = [];
  const later = (callback) => (callback ? (item) => said.push(() => callback(item)) : null);
  const reportAll = () => { for (const report of said) report(); };
  replace = replace && { ...replace, onReplaced: later(replace.onReplaced) };
  restore = restore && { ...restore, onRestored: later(restore.onRestored) };
  onLinked = later(onLinked);

  try {
    await prisma.$transaction(async (transaction) => {
      const refs = await lookups();
      const people = await resolvePeople(transaction, row, refs);
      const project = await projectForRow(transaction, { vertical, row, userId, refs, people, clientMainNumber, replace, restore, onLinked });

      const shootData = { ...shoot, eventStartTime: eventStartTime ?? undefined, eventEndTime: eventEndTime ?? undefined };
      const byId = await transaction.projectShoot.findUnique({ where: { sheetShootId: row.sheetShootId } });
      if (byId && byId.projectId !== project.id) throw fail(`Shoot ID ${row.sheetShootId} belongs to a different Event ID.`);
      if (byId?.deletedAt) await restoreShoot(transaction, byId, restore);
      // Not seen before: the same shoot may already be in the app, added there - then it is linked.
      const existingShoot = byId || await appShootFor(transaction, project.id, row, shoot);
      /*
       * The shoot keeps its own Shoot ID - the app's, where the app had it - with the sheet's held
       * beside it, and is written from the sheet: the sheet is the record of the shoot itself, so a
       * date, place or timing it gives replaces what the app holds. A cell the sheet leaves empty
       * changes nothing (`shootUpdate`).
       */
      const given = shootUpdate(shootData, row);
      // A shoot the sheet renames is no longer the names its place-per-name was kept for.
      if (existingShoot && given.shoot && given.shoot !== existingShoot.shoot) given.shootLocations = Prisma.DbNull;
      let savedShoot;
      if (existingShoot) {
        savedShoot = await transaction.projectShoot.update({ where: { id: existingShoot.id }, data: { ...given, sheetShootId: row.sheetShootId } });
      } else {
        const shootId = await claimSheetId(transaction.projectShoot, "shootId", row.sheetShootId, null, "Shoot ID");
        savedShoot = await transaction.projectShoot.create({ data: { ...shootData, projectId: project.id, sheetShootId: row.sheetShootId, shootId } });
      }

      // The project's Main Event Date is its main shoot's, worked out the way every shoot save in the
      // app works it out - never typed onto the project, where the next shoot edit would undo it.
      await projects.syncProjectMainEvent(transaction, project.id, savedShoot);

      // Started with a Pre Production Coordinator, so this raises the shoot's row - the same call the
      // Start Project form makes. And the production row, once a Production Manager is named.
      await ensureProjectPreProduction(transaction, project.id, { userId });
      await ensureProjectProduction(transaction, project.id);
      await studioStartForRow(transaction, savedShoot.id, studioStart.data);
      await storageForRow(transaction, project.id, row, userId);

      /*
       * A pre production row exists once the project has a Pre Production Coordinator and has started
       * (`ensureProjectPreProduction`). Without one there is nowhere to put the sheet's pre production
       * answers, and the row is still worth having: the project and its shoot are saved, and naming a
       * coordinator later and uploading the file again stores the answers then.
       */
      const preRow = await transaction.projectPreProduction.findUnique({ where: { shootId: savedShoot.id }, include: { concepts: { select: { id: true } } } });
      if (!preRow) {
        if (preview) throw PREVIEW;
        return;
      }
      const concept = row.conceptReference || row.conceptRemarks;
      // Written from the sheet, as the shoot is: an answer the sheet gives replaces the app's, and a
      // question it leaves empty is left as the app has it (`preProductionUpdateSchema` drops those).
      if (Object.keys(answers).length || concept) {
        // A venue the sheet gives is the shoot's one address, so any venue-per-name it held no longer stands.
        const oneVenue = answers.locationAddress || answers.locationLink ? { locations: Prisma.DbNull } : {};
        await transaction.projectPreProduction.update({
          where: { id: preRow.id },
          data: { ...answers, ...oneVenue, ...(concept ? { conceptsNeeded: true } : {}), updatedByUserId: userId },
        });
      }
      // One concept from the sheet, added once: a second upload must not stack a copy of it.
      if (concept && !preRow.concepts.length) {
        await transaction.projectPreProductionConcept.create({ data: { preProductionId: preRow.id, reference: row.conceptReference || null, remarks: row.conceptRemarks || null, position: 0 } });
      }
      // A preview has done everything a real import would, refusals included - and keeps none of it.
      if (preview) throw PREVIEW;
    });
    reportAll();
  } catch (error) {
    if (error === PREVIEW) { reportAll(); return; }
    if (error?.status) throw error;
    // Two uploads (or two rows of one file) reached for the same ID at the same moment.
    if (error?.code === "P2002") throw fail("This Event ID or Shoot ID was taken by another upload at the same moment. Upload the file again.", 409);
    // A database error names tables and columns; the row is told only that it was not saved.
    // Logged by code and target only: a Prisma message can carry the row's own values.
    console.error("Pre production import row failed:", error?.code || error?.name || "unknown", error?.meta?.target || "");
    throw fail("This row could not be saved.", 500);
  }
}

module.exports = { importRow, projectForRow, resolvePeople, appShootFor, shootUpdate, storageForRow, importedShoot, indianNumber };
