const prisma = require("../../../config/db");
const { studioDateKey } = require("../../../services/studioTime");
const { shiftDirectReportsUp } = require("../../../services/reportingLine");
const { closeLogin } = require("./controller");
const whatsappGroups = require("../whatsapp-groups/service");

/**
 * The day after somebody's last working day, their notice is served: the separation's status -
 * Relieved, Fired or Absconded - is put on them, their login is closed, their team is moved up to
 * the nearest manager still working, and the repository moves them from Serving Notice to InActive.
 *
 * Until then `createSeparation` / `updateSeparation` leave both alone (`servesNotice`). This looks
 * every few minutes for separations not yet relieved (`relievedAt` null) whose proposed last working
 * day is before today on the studio's calendar. Each is claimed by stamping `relievedAt` only where
 * it is still null, so two processes - a restart overlapping the old one - cannot both relieve it.
 *
 * ── Why the reporting line moves here ──
 *
 * Because this is the day they stop being anybody's manager. It used to happen when the separation
 * was *recorded*, which for somebody serving notice is weeks early: their team was moved off them
 * while they were still coming in and still running it, and a resignation could be refused outright
 * because nobody above them was free to take their reports - a question about a day that had not
 * arrived. A separation saved now is relieved the day it is saved, so `recordSeparation` does it
 * then; this only does it for the older rows still serving notice.
 */

const TICK_MS = 5 * 60 * 1000;

async function relieveServedNotices({ now = new Date(), client = prisma } = {}) {
  const today = new Date(`${studioDateKey(now)}T00:00:00.000Z`);
  const due = await client.employeeSeparation.findMany({
    where: { relievedAt: null, proposedLastWorkingDate: { lt: today } },
    select: { id: true, employeeId: true, employmentStatus: true },
  });
  let relieved = 0;
  // Whose team could not be moved up, said once at the end rather than per row inside a loop.
  const unmovedReports = [];
  for (const separation of due) {
    await client.$transaction(async (tx) => {
      const { count } = await tx.employeeSeparation.updateMany({ where: { id: separation.id, relievedAt: null }, data: { relievedAt: now } });
      if (!count) return;
      await tx.employee.update({ where: { id: separation.employeeId }, data: { employmentStatus: separation.employmentStatus } });
      await closeLogin(tx, separation.employeeId);
      /*
       * Their team goes up to the nearest manager still working - and a failure here does **not**
       * take the relieving with it.
       *
       * `shiftDirectReportsUp` refuses when there is nobody above them still working, which is the
       * right answer to HR on a screen: somebody can reassign the team and try again. Here there is
       * nobody to tell and nothing to try again with, and the relieving is the time-critical half -
       * the login must close on the right day whatever the org chart looks like. So the reports are
       * attempted, and a refusal is logged by name for HR to resolve in the org chart rather than
       * left to block the exit for ever.
       */
      try {
        await shiftDirectReportsUp(separation.employeeId, tx);
      } catch (error) {
        unmovedReports.push(`employee ${separation.employeeId}: ${error.message}`);
      }
      relieved += 1;
    });
    /*
     * Out of every WhatsApp group they are in - queued **after** the transaction, for the same reason
     * the reports are attempted outside it: the relieving is the time-critical half and the login
     * must close on the right day whatever WhatsApp is doing. The rows are a queue, worked through
     * thirty seconds apart, so a leaver in a dozen groups does not read as automation from the
     * studio's number. It never throws.
     */
    const left = await whatsappGroups.removeEmployeeFromAllGroups(separation.employeeId);
    if (left.queued) console.log(`[separations] employee ${separation.employeeId}: queued out of ${left.queued} WhatsApp ${left.queued === 1 ? "group" : "groups"}`);
  }
  if (relieved) console.log(`[separations] ${relieved} ${relieved === 1 ? "employee" : "employees"} relieved after serving notice`);
  for (const problem of unmovedReports) console.warn(`[separations] relieved, but their reports were left in place - ${problem}`);
  return relieved;
}

let timer = null;
let running = false;

/** At start, then every five minutes - so the day turning over relieves them within minutes. */
function startSeparationRelieving() {
  if (timer) return timer;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await relieveServedNotices(); } catch (error) { console.warn(`[separations] ${error.message}`); } finally { running = false; }
  };
  timer = setInterval(tick, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  tick();
  return timer;
}

function stopSeparationRelieving() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { relieveServedNotices, startSeparationRelieving, stopSeparationRelieving };
