const { isShooter } = require("../production/crew");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");

/**
 * The shooters with nothing on, a day at a time - for the Shoot Board's day view.
 *
 * A shooter is a working employee in the Technical department (`production/crew.js`). One is free on a
 * date when no live shoot that date names them in any role on its production: Production Coordinator,
 * Production Team, or a service's person or assistant. Across the whole studio, not only the shoots
 * the viewer may see - being busy is a fact about the person, wherever the shoot is. By the date
 * alone, as the studio reads its days: a shoot that morning makes them busy for the day.
 */
const dayKeyOf = (date) => new Date(date).toISOString().slice(0, 10);

/** `{ "YYYY-MM-DD": [{ id, name }] }` for each day in `dayKeys`, names in order. */
async function freeShootersByDay(client, dayKeys, { statuses = workingEmployeeStatuses } = {}) {
  const days = [...new Set(dayKeys)].filter(Boolean).sort();
  if (!days.length) return {};
  const [employees, productions] = await Promise.all([
    client.employee.findMany({
      where: { archivedAt: null, employmentStatus: { in: await statuses() } },
      select: { id: true, employeeName: true, departments: { select: { department: { select: { name: true } } } } },
      orderBy: { employeeName: "asc" },
    }),
    client.projectProduction.findMany({
      where: {
        shoot: { deletedAt: null, dateCreated: { gte: new Date(`${days[0]}T00:00:00.000Z`), lte: new Date(`${days[days.length - 1]}T23:59:59.999Z`) } },
        salesProject: { deletedAt: null },
      },
      select: {
        productionCoordinatorEmployeeId: true,
        shoot: { select: { dateCreated: true } },
        teamMembers: { where: { employeeId: { not: null } }, select: { employeeId: true } },
        serviceCrew: { where: { employeeId: { not: null } }, select: { employeeId: true } },
      },
    }),
  ]);
  const shooters = employees
    .filter((employee) => isShooter((employee.departments || []).map((link) => link.department?.name)))
    .map((employee) => ({ id: employee.id, name: employee.employeeName }));

  const busy = new Map(days.map((day) => [day, new Set()]));
  for (const production of productions) {
    const taken = busy.get(dayKeyOf(production.shoot.dateCreated));
    if (!taken) continue;
    if (production.productionCoordinatorEmployeeId) taken.add(production.productionCoordinatorEmployeeId);
    for (const row of [...production.teamMembers, ...production.serviceCrew]) taken.add(row.employeeId);
  }
  return Object.fromEntries(days.map((day) => [day, shooters.filter((shooter) => !busy.get(day).has(shooter.id))]));
}

module.exports = { freeShootersByDay };
