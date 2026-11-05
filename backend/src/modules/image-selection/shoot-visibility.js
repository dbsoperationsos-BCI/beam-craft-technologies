const { STUDIO_OFFSET_MS } = require("../../services/dashboardRange");
const { studioDayKey } = require("../../services/studioDay");

// A Project Management shoot joins the Image Selection workspace on its own day, in the studio's
// clock (Asia/Kolkata): a Wedding dated 28 Oct appears - root folder, photos and selection items -
// from 00:00 on 28 Oct India time, and a Reception dated 29 Oct from 00:00 on the 29th. Each shoot
// is asked about on its own, so a Wedding already reached is never held back by a Reception still
// to come, and nothing about the project's status (Production, Pre Production or any other) is read.
//
// The shoot's day is the studio day its stored moment falls on (`studioDayKey`), which is the date
// the studio typed whichever way it was stored: the Add Shoot form stores midnight UTC (05:30 in
// India, the same day), and a date stored as India's own midnight (18:30 UTC the day before) is
// that same day too.
function shootDayKey(dateValue) {
  if (!dateValue) return "";
  return studioDayKey(dateValue);
}

function shootDayReached(dateValue, now = new Date()) {
  /*
   * No date means the shoot has not been scheduled, so its day cannot have come. A date nobody can
   * read is treated the same way: content is never shown for a shoot that cannot be placed on a day,
   * and is shown the moment a real date is put on it.
   */
  const day = shootDayKey(dateValue);
  if (!day) return false;
  return studioDayKey(now) >= day;
}

/*
 * The same rule as a database condition on `ProjectShoot.dateCreated`: a shoot is reached when it
 * was stored before the first moment of tomorrow, studio time. An undated shoot fails `lt` in SQL,
 * so it is held back here exactly as `shootDayReached` holds it back.
 */
function firstMomentOfTomorrow(now = new Date()) {
  const [year, month, day] = studioDayKey(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1) - STUDIO_OFFSET_MS);
}
const reachedShootWhere = (now = new Date()) => ({ dateCreated: { lt: firstMomentOfTomorrow(now) } });

/*
 * Selection items a client may see and pick into, as a condition on `ImageSelectionDeliverableConfig`:
 * a studio-typed item (no deliverable behind it), or one whose deliverable's shoot has reached its
 * day. A held item keeps its row, its picks and its submission untouched - it is only not offered
 * until its shoot's day, and is offered again the moment the day comes.
 */
const reachedConfigWhere = (now = new Date()) => ({
  OR: [{ projectShootDeliverableId: null }, { shootDeliverable: { is: { shoot: { is: reachedShootWhere(now) } } } }],
});

/*
 * The folders held back with their shoot: every shoot folder whose shoot has not reached its day,
 * and everything nested under one. `folders` carry `id`, `parentId` and `projectShoot` (with
 * `dateCreated`, or null for a folder the studio made by hand, which is never held). The rows stay
 * as they are - photos, picks and all - and come back the day the shoot does.
 */
function heldShootFolderIds(folders, now = new Date()) {
  const held = new Set(folders
    .filter((folder) => folder.projectShoot && !shootDayReached(folder.projectShoot.dateCreated, now))
    .map((folder) => folder.id));
  if (!held.size) return held;
  for (let changed = true; changed;) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && held.has(folder.parentId) && !held.has(folder.id)) { held.add(folder.id); changed = true; }
    }
  }
  return held;
}

/*
 * The Sales projects that have at least one shoot in the workspace yet - by `shootDayReached` and
 * nothing else, so a project starts showing on exactly the day its first shoot's folder would.
 * `shoots` is `{ projectId, dateCreated }` per live shoot, `projectId` being the Sales project's.
 */
function salesProjectsWithShootDayReached(shoots = [], now = new Date()) {
  return new Set(shoots.filter((shoot) => shootDayReached(shoot.dateCreated, now)).map((shoot) => shoot.projectId));
}

/*
 * The Image Selection projects that are listed yet: a project linked to a Sales project only once
 * one of its shoots has reached the workspace, so an in-progress booking whose shoots are all
 * ahead (or has none) is not listed empty. Held back only - the row, its folders and its photos
 * are untouched, and it is listed the day its first shoot arrives. A manual project has no shoots,
 * and an archived one is something somebody chose to put away, so both are listed as before.
 *
 * The Projects sidebar and the dashboard both list through this, so a project the sidebar does not
 * show is never a number on the dashboard either. `listShootDates` is the repository's batched
 * read of `{ projectId, dateCreated }` for the given Sales project ids - one query per list.
 */
async function projectsWithAShootReached(rows, listShootDates, now = new Date()) {
  const salesProjectIds = [...new Set(rows.filter((row) => row.salesProjectId && !row.archivedAt).map((row) => row.salesProjectId))];
  const ready = salesProjectsWithShootDayReached(salesProjectIds.length ? await listShootDates(salesProjectIds) : [], now);
  return rows.filter((row) => row.archivedAt || !row.salesProjectId || ready.has(row.salesProjectId));
}

module.exports = { shootDayKey, shootDayReached, reachedShootWhere, reachedConfigWhere, heldShootFolderIds, salesProjectsWithShootDayReached, projectsWithAShootReached };
