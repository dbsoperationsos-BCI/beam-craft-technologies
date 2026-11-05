const prisma = require("../../../config/db");
const { lookups } = require("../../../services/referenceMatchers");
const { resolvePeople } = require("../../../services/importPeople");
const access = require("./access");
const { logActivity } = require("./activity");
const { travelData, shootServices } = require("./plan");
const C = require("./crew");
const S = require("./steps");
const T = require("./travel");

/*
 * One row of Production → Import written to the database. Columns and cell rules are in
 * `importColumns.js`; the routes in `import.js`.
 *
 * The shoot is the one Pre Production → Import made, found by the sheet's Shoot ID; its production
 * record is the one that import raised once the project had a Production Manager. Nothing here
 * creates a project, a shoot or a production record - a row whose shoot is not there yet is refused
 * and says to import pre production first.
 *
 * What a row carries is held to the rules the board's own forms hold: a submitted plan has a
 * Production Coordinator and its travel detail, no step is past an unsubmitted plan, a shoot status
 * sits on the step that status belongs to, and a photo copy is the last step done.
 *
 * A second upload fills in what is still empty and never overwrites: a coordinator, a team, travel,
 * remarks or a photo copy already on the record are kept, and the step only ever moves forward, so
 * an upload cannot undo work recorded on the board since.
 *
 * Old shoots are history: the steps' own times and photos are not in the sheet and are left empty.
 * The board reads where a shoot stands from its step and status, so it shows them correctly.
 */

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Happy clients completes the shoot, so a shoot past it is Completed and nothing before it is.
const COMPLETES_AT = S.STEPS.indexOf(S.COMPLETES_SHOOT);

/**
 * The step and status a row sets, worked out from whichever it gives.
 *
 * Only **Completed** still means anything about where a shoot stands: Happy clients completes the
 * shoot, so a Completed shoot is past it - File in, or Done - and a shoot past it is Completed
 * whether the sheet says so or not. A photo copy is the last step.
 *
 * Paused, On Hold, Rejected and Started were the coordinator's to set and are set by nobody now. An
 * old sheet may still name one; it is written to the record as that shoot's history and pins no
 * step, since there is no longer a step for it to sit on.
 */
function progressOf(row) {
  const { shootStatus } = row;
  let step = row.currentStep;
  if (row.footageUrl && !step) step = S.DONE;
  if (!step && shootStatus === S.COMPLETED_STATUS) step = S.DONE;
  const index = step ? S.stepIndex(step) : -1;
  const status = shootStatus || (index > COMPLETES_AT ? S.COMPLETED_STATUS : undefined);

  if (row.footageUrl && step !== S.DONE) throw fail("Production Step: a photo copy is the last step - use Done, or leave it blank.");
  if (status === S.COMPLETED_STATUS && index <= COMPLETES_AT) throw fail(`Production Step: a Completed shoot is past ${S.STEP_LABELS.HAPPY_CLIENTS} - use ${S.STEP_LABELS.PHOTO_COPY} or Done.`);
  if (status && status !== S.COMPLETED_STATUS && index > COMPLETES_AT) throw fail(`Shoot Status: a shoot past ${S.STEP_LABELS.HAPPY_CLIENTS} is Completed.`);
  return { step, status };
}

/**
 * The production record this row names, refused unless the caller may change its plan - the same
 * rule the board's Save Plan answers to (`accessFor(...).canEditPlan`: the project's Production
 * Manager, a Super Admin, or Show All Projects at Read / Write). Being able to *see* a shoot on the
 * board is not enough.
 *
 * A missing shoot and one the caller may not change get the same answer, so a row learns nothing
 * about a shoot it cannot reach. Only somebody who reaches every shoot is told why one is missing.
 */
async function productionFor(transaction, { vertical, row, caller }) {
  const shoot = await transaction.projectShoot.findUnique({
    where: { sheetShootId: row.sheetShootId },
    select: {
      deletedAt: true,
      project: { select: { vertical: true, sheetEventId: true, deletedAt: true } },
      production: {
        select: {
          ...access.WRITE_SELECT,
          remarks: true,
          teamMembers: { select: { employeeId: true, employeeName: true } },
          // Each service's answers, to tell a finished photo copy from one saved part way: a sheet
          // fills only what the app has not answered, and a pending row is not an answer yet.
          footage: { select: Object.fromEntries(S.FOOTAGE_ANSWERS.map((field) => [field, true])) },
        },
      },
    },
  });
  const live = shoot && !shoot.deletedAt && !shoot.project.deletedAt;
  if (!live || !shoot.production || !access.accessFor(shoot.production, caller).canEditPlan) {
    const seesAll = caller.superAdmin || caller.allProjects;
    if (seesAll && !live) throw fail(`Shoot ID ${row.sheetShootId} has not been imported. Import Pre Production first.`);
    if (seesAll && !shoot.production) throw fail(`Shoot ID ${row.sheetShootId} has no production yet: its project needs a Production Manager (Pre Production import).`);
    throw fail(`Shoot ID ${row.sheetShootId} is not a shoot you can update.`);
  }
  if (shoot.project.vertical !== vertical) throw fail(`Shoot ID ${row.sheetShootId} is not a ${{ WED: "Dum Dum", QQ: "Qua Qua", CORP: "Corp" }[vertical]} shoot.`);
  if (row.sheetEventId && row.sheetEventId !== shoot.project.sheetEventId) throw fail(`Shoot ID ${row.sheetShootId} does not belong to Event ID ${row.sheetEventId}.`);
  return shoot.production;
}

async function importRow({ vertical, row, caller }, { client = prisma, references = lookups } = {}) {
  const progress = progressOf(row);
  try {
    await client.$transaction(async (transaction) => {
      const production = await productionFor(transaction, { vertical, row, caller });
      const refs = await references();
      const data = {};
      const changed = [];

      // A coordinator already on the record - linked, or named from an earlier sheet - is kept.
      if (row.productionCoordinatorCode && !production.productionCoordinatorEmployeeId && !production.productionCoordinatorName) {
        // Somebody who has left has no employee to link: the name is kept as the sheet wrote it.
        const [person] = await resolvePeople(transaction, refs, [row.productionCoordinatorCode]);
        if (person.id) data.productionCoordinatorEmployeeId = person.id;
        else data.productionCoordinatorName = person.name;
        changed.push("coordinator");
      }
      if (row.travelMode && !production.travelMode) {
        if (row.travelMode === T.OFFICE_VEHICLE) throw fail("Travel Mode: an office vehicle is chosen from Asset Management - set it on the board.");
        Object.assign(data, await travelData(transaction, production, { travelMode: row.travelMode, travelModeOther: row.travelModeOther, vehicleNumberPlate: row.vehicleNumberPlate }));
        changed.push("travel");
      }
      if (row.remarks && !production.remarks) { data.remarks = row.remarks; changed.push("remarks"); }

      // Submitted when the sheet says so, or - left blank - when it names a coordinator, since that
      // is what a plan is submitted for. A plan already submitted stays submitted.
      const coordinator = data.productionCoordinatorEmployeeId ?? production.productionCoordinatorEmployeeId
        ?? data.productionCoordinatorName ?? production.productionCoordinatorName;
      const submit = !production.planSubmittedAt && (row.planSubmitted ?? Boolean(row.productionCoordinatorCode));
      if (submit) {
        if (!coordinator) throw fail("Plan Submitted: a submitted plan needs a Production Coordinator Employee Code.");
        // As on the board: every service booked for the shoot needs its person before the plan is
        // submitted. Imported shoots carry no services, so this bites only on one given them since.
        const crew = await transaction.projectProductionServiceCrew.findMany({ where: { productionId: production.id }, select: { serviceDefinitionId: true, role: true, employeeId: true, vendorId: true } });
        const unstaffed = C.missingLead(crew, await shootServices(transaction, production));
        if (unstaffed) throw fail(`Plan Submitted: assign a person to ${unstaffed} on the board before submitting.`);
        Object.assign(data, { planSubmittedAt: new Date(), planSubmittedByUserId: caller.userId });
      }
      const submitted = Boolean(production.planSubmittedAt || submit);

      // Forward only: a step the board has already passed is never taken back.
      if (progress.step && S.stepIndex(progress.step) > S.stepIndex(production.currentStep)) {
        if (!submitted) throw fail("Production Step: the plan has to be submitted before any step is done.");
        data.currentStep = progress.step;
        changed.push("step");
      }
      if (progress.status && progress.status !== production.shootStatus && (data.currentStep || production.currentStep) === (progress.step || production.currentStep)) {
        if (!submitted) throw fail("Shoot Status: the plan has to be submitted first.");
        Object.assign(data, { shootStatus: progress.status, ...(row.shootStatusRemarks ? { shootStatusRemarks: row.shootStatusRemarks } : {}) });
        changed.push("shoot status");
      }
      if (Object.keys(data).length) {
        // Conditional on the record being as it was read, the way completing a step is on the board:
        // a step recorded there while this file was uploading is never overwritten.
        const saved = await transaction.projectProduction.updateMany({
          where: { id: production.id, currentStep: production.currentStep, planSubmittedAt: production.planSubmittedAt },
          data,
        });
        if (!saved.count) throw fail("This shoot changed on the board while the file was importing. Upload the file again.");
      }

      if (row.teamCodes?.length && !production.teamMembers.some((member) => member.employeeId || member.employeeName)) {
        const people = await resolvePeople(transaction, refs, row.teamCodes);
        // Once each: a person written twice, or two spellings of one name, is one member.
        const seen = new Set();
        const members = people.filter((person) => {
          const key = person.id ? `id:${person.id}` : `name:${person.name.toLowerCase()}`;
          return seen.has(key) ? false : seen.add(key);
        });
        await transaction.projectProductionTeamMember.createMany({
          data: members.map((person) => ({ productionId: production.id, employeeId: person.id, employeeName: person.id ? null : person.name })),
        });
        changed.push("team");
      }
      /*
       * One photo copy for the whole shoot: imported shoots carry no services to split it by.
       *
       * Skipped only where the app already holds a **finished** answer. A File in saved part way on
       * the board (Mark as pending) is not one, and the sheet's answer replaces it - otherwise the
       * import dropped the footage silently while still moving the step to DONE (`progressOf`),
       * leaving a shoot marked done with a half-written row.
       */
      const filedIn = (production.footage || []).some((held) => S.FOOTAGE_ANSWERS.every((field) => held[field] !== null && held[field] !== undefined));
      if (row.footageUrl && !filedIn) {
        const [backup] = await resolvePeople(transaction, refs, [row.footageBackupCode]);
        // The whole-shoot row is one (the key does not hold NULLs apart in MySQL), so a pending
        // answer of its own is cleared rather than left beside the one being written.
        await transaction.projectProductionFootage.deleteMany({ where: { productionId: production.id, serviceDefinitionId: null } });
        await transaction.projectProductionFootage.create({
          data: { productionId: production.id, serviceDefinitionId: null, footageUrl: row.footageUrl, backedUpByEmployeeId: backup.id, backedUpByName: backup.id ? null : backup.name, fileCount: row.fileCount, size: row.size, firstFileName: row.firstFileName, lastFileName: row.lastFileName, remarks: row.footageRemarks || null },
        });
        changed.push("photo copy");
      }

      if (changed.length) await logActivity(transaction, production.id, submit ? "PLAN_SUBMITTED" : "PLAN_SAVED", `Imported from the production sheet: ${changed.join(", ")}`, caller);
    });
  } catch (error) {
    if (error?.status) throw error;
    // A database error names tables and columns; the row is told only that it was not saved.
    console.error("Production import row failed:", error?.code || error?.name || "unknown", error?.meta?.target || "");
    throw fail("This row could not be saved.", 500);
  }
}

module.exports = { importRow, progressOf, productionFor };
