const { liveWhere } = require("./access");

/**
 * Who is already out on another shoot at the same time - for the plan's service crew, the people who
 * actually go to a shoot (each service's person and assistants).
 *
 * **Time only, never the day.** A shoot runs from its date and start time to its end time, and an end
 * earlier than the start is the next morning: 7:00 pm to 1:00 am. Two shoots clash only when those
 * stretches overlap, so somebody whose shoot ends at 1:00 am is free for another at 7:00 pm, and one
 * ending at 2:00 pm is free for one starting at 2:00 pm. A shoot without both a start and an end time
 * cannot clash with anything - it neither hides anybody nor is hidden from.
 *
 * Only crew counts. Being a shoot's Production Coordinator or on its Production Team does not take
 * anybody off another shoot's crew - a coordinator is often a service's person too.
 */
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function minutesOf(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** `{ start, end }` in ms for a shoot with a date and both times; null otherwise. */
function shootWindow(shoot) {
  const date = shoot?.dateCreated ? new Date(shoot.dateCreated) : null;
  const start = minutesOf(shoot?.eventStartTime);
  const end = minutesOf(shoot?.eventEndTime);
  if (!date || Number.isNaN(date.getTime()) || start === null || end === null) return null;
  // The shoot's calendar day, as stored (midnight UTC), with the times laid on it as written.
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const from = day + start * MINUTE;
  const to = day + end * MINUTE + (end <= start ? DAY : 0);
  return { start: from, end: to };
}

/** Whether two windows share any time; touching ends (2:00 pm and 2:00 pm) do not. */
const overlaps = (a, b) => Boolean(a && b) && a.start < b.end && b.start < a.end;

/**
 * Who and what is already out on another shoot at an overlapping time: the employees named as a
 * service's person or assistant, and the cameras those services carry. A camera is one object - it
 * cannot be on two shoots at once any more than a person can - so both are read in the one pass.
 * `production` is `{ id, shoot: { dateCreated, eventStartTime, eventEndTime } }`.
 */
async function busyCrew(client, production) {
  const window = shootWindow(production?.shoot);
  if (!window) return { employeeIds: [], cameraAssetIds: [] };
  // A shoot that overlaps this one starts within a day either side of it - a night shoot can run
  // into the next morning, and one from the evening before can run into this one.
  const day = window.start - minutesOf(production.shoot.eventStartTime) * MINUTE;
  const others = await client.projectProduction.findMany({
    where: {
      id: { not: production.id },
      ...liveWhere,
      shoot: { deletedAt: null, dateCreated: { gte: new Date(day - DAY), lte: new Date(day + DAY) }, eventStartTime: { not: null }, eventEndTime: { not: null } },
    },
    select: {
      shoot: { select: { dateCreated: true, eventStartTime: true, eventEndTime: true } },
      serviceCrew: { select: { employeeId: true, cameras: { select: { cameraAssetId: true } } } },
      // The shoot's Assist - its Production Team - is out on that shoot as much as a service's person.
      teamMembers: { where: { employeeId: { not: null } }, select: { employeeId: true } },
    },
  });
  const employeeIds = new Set();
  const cameraAssetIds = new Set();
  for (const other of others) {
    if (!overlaps(window, shootWindow(other.shoot))) continue;
    for (const row of other.serviceCrew) {
      if (row.employeeId) employeeIds.add(row.employeeId);
      for (const camera of row.cameras || []) cameraAssetIds.add(camera.cameraAssetId);
    }
    for (const member of other.teamMembers || []) employeeIds.add(member.employeeId);
  }
  return { employeeIds: [...employeeIds], cameraAssetIds: [...cameraAssetIds] };
}

module.exports = { minutesOf, shootWindow, overlaps, busyCrew };
