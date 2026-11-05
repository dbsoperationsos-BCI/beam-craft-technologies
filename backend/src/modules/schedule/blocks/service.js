const prisma = require("../../../config/db");
const dataScope = require("../../../services/dataScope.service");
const iamService = require("../../../services/iam.service");

/*
 * Calendar → a day's ⋮ → Block Period: a branch's hours on one day held with nothing booked in them -
 * a repair, a walkthrough, a client still deciding. A branch, a day, a start and an end time ("HH:MM",
 * the end after the start) and why. Two blocks in one branch on one day never overlap; removing a
 * block frees its hours.
 *
 * A placeholder on the calendar and nothing more: it stops no booking - no meeting, shoot, project or
 * interview is refused for falling in its hours.
 *
 * Everything answers to `SALES / Block Period` and reaches the branches its roles grant: the
 * branches offered and the blocks shown at Read, a block made or removed at Read / Write (`dataScope`
 * on `branchId`, and `canUseBranchId` for the branch a new block names).
 */

const SCOPE = { module: "SALES", feature: "Block Period" };

const fail = (status, message) => Object.assign(new Error(message), { status });
const dayOf = (iso) => new Date(`${iso}T00:00:00Z`);
const isoOf = (date) => date.toISOString().slice(0, 10);

const blockSelect = {
  id: true, branchId: true, blockDate: true, startTime: true, endTime: true, reason: true,
  branch: { select: { id: true, name: true } },
  createdByUser: { select: { name: true } },
};

/** One block as the calendar reads it. */
function toBlock(row) {
  return {
    id: row.id,
    branchId: row.branchId,
    branchName: row.branch?.name || "",
    date: isoOf(row.blockDate),
    startTime: row.startTime,
    endTime: row.endTime,
    reason: row.reason,
    createdBy: row.createdByUser?.name || "",
  };
}

/** The branches a block may be made in - those this caller reaches for Block Period. */
function branchesFor(userId) {
  return iamService.reachableBranches(userId, SCOPE);
}

/**
 * The blocks between two days (either may be left open), in the branches the caller reaches -
 * for the calendar, which asks at Read.
 */
async function listBlocks({ userId, from = null, to = null }, client = prisma) {
  const scope = await dataScope.resolve({ userId, ...SCOPE, columns: { branch: "branchId" } });
  const blockDate = {};
  if (from) blockDate.gte = dayOf(from);
  if (to) blockDate.lte = dayOf(to);
  const rows = await client.calendarBlock.findMany({
    where: { ...(Object.keys(blockDate).length ? { blockDate } : {}), AND: [scope.where] },
    orderBy: [{ blockDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
    select: blockSelect,
  });
  return rows.map(toBlock);
}

/**
 * Blocks a period: a branch the caller may write in, an end after the start, and no other block in
 * that branch that day overlapping it - two blocks over the same hour would each have to be removed
 * to free it. The check and the write are one serializable transaction, so two people blocking the
 * same hour at once cannot both get through; the one that loses is told to try again.
 */
async function createBlock({ userId, branchId, date, startTime, endTime, reason }, client = prisma) {
  if (endTime <= startTime) throw fail(400, "The block must end after it starts.");
  if (!(await iamService.canUseBranchId(userId, branchId, { ...SCOPE, level: "READ_WRITE" }))) throw fail(403, "You cannot block periods in that branch.");
  try {
    const row = await client.$transaction(async (tx) => {
      const clash = await tx.calendarBlock.findFirst({
        where: { branchId, blockDate: dayOf(date), startTime: { lt: endTime }, endTime: { gt: startTime } },
        select: { startTime: true, endTime: true, reason: true },
      });
      if (clash) throw fail(409, `That branch is already blocked from ${clash.startTime} to ${clash.endTime} that day (${clash.reason}).`);
      return tx.calendarBlock.create({
        data: { branchId, blockDate: dayOf(date), startTime, endTime, reason, createdByUserId: userId || null },
        select: blockSelect,
      });
    }, { isolationLevel: "Serializable" });
    return toBlock(row);
  } catch (error) {
    if (error?.code === "P2034") throw fail(409, "Somebody blocked that branch at the same moment. Check the calendar and try again.");
    throw error;
  }
}

/** Frees a block's hours - only one in a branch the caller may write in. */
async function removeBlock({ userId, id }, client = prisma) {
  const scope = await dataScope.resolve({ userId, ...SCOPE, columns: { branch: "branchId" }, level: "READ_WRITE" });
  const current = await client.calendarBlock.findUnique({ where: { id }, select: { id: true, branchId: true } });
  if (!current || !scope.allows(current)) throw fail(404, "That block is not there any more.");
  await client.calendarBlock.delete({ where: { id } });
  return { id };
}

module.exports = { SCOPE, branchesFor, listBlocks, createBlock, removeBlock, toBlock };
