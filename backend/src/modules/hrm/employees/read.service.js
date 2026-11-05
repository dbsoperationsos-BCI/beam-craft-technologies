const prisma = require("../../../config/db");
const { workingEmployeeStatuses, FALLBACK_WORKING_STATUSES } = require("../../../services/employeeOptionLists");

/**
 * Reading employees, for callers that are not an HTTP handler.
 *
 * The module's list logic lives inside `listEmployees(req, res)`, which cannot be called from
 * anywhere but a route. This is the same query as a function, so the assistant reads employees the
 * way the screens do rather than through a second set of rules invented for it.
 *
 * Additive on purpose: `controller.js` is untouched and still has its own copy. That is a
 * duplication and it is owed a follow-up - the controller should call this - but moving a working
 * production endpoint is its own change with its own review, not a side effect of adding AI.
 *
 * **What is not selected here is the point of the file.** An employee row carries Aadhaar and PAN
 * numbers, bank account and IFSC, salary, home address, and photographs of identity documents. None
 * of it is ever needed to answer "who is in the editing team", and all of it would end up in a
 * prompt if this returned rows. So the select list is explicit and short, and adding to it should
 * require someone to think about why.
 */

// What an assistant can answer questions about. Everything else stays in the database.
const SAFE_FIELDS = {
  id: true,
  employeeId: true,
  employeeName: true,
  employmentStatus: true,
  designation: true,
  department: true,
  vertical: true,
  workBaseLocation: true,
  currentWorkLocation: true,
  workType: true,
  dateOfJoining: true,
};

/**
 * The employment statuses that mean somebody is working here now.
 *
 * The same three the repository's Active tab groups, because there is one idea of "active" and two
 * lists of it would drift. Somebody onboarding is not one of them: they have been entered but have
 * not started, and offering them as the person to hand an asset to - or to name as a manager -
 * proposes work for somebody who is not there yet.
 */
/*
 * The statuses that mean somebody works here.
 *
 * Still exported, because several modules and a test read it by this name, but it is now the
 * *fallback* rather than the answer: the answer is the status list the studio maintains in
 * Settings → Field Settings, asked for through `workingEmployeeStatuses()` where a query is
 * actually built. Written out, this array had no way of hearing about a status being renamed.
 */
const WORKING_STATUSES = FALLBACK_WORKING_STATUSES;

// Bounded, so a search cannot put the whole company into a prompt.
const MAX_ROWS = 50;
const DEFAULT_ROWS = 20;

function boundedLimit(value) {
  const asked = Number(value);
  if (!Number.isFinite(asked) || asked < 1) return DEFAULT_ROWS;
  return Math.min(Math.floor(asked), MAX_ROWS);
}

/**
 * The employees in the branches a caller reaches.
 *
 * `null` is a Super Admin's reach and narrows nothing. An empty list is somebody reaching no branch,
 * and the honest answer is no employees - matched by an impossible id rather than `branchId: null`,
 * which on a nullable column would match everyone whose branch is not yet set.
 *
 * **Three columns, and any one of them is enough** - the same rule the repository screen reads, so
 * Nebula and the screen answer with the same people. `Employee.branchId` is the reference, and it
 * is NULL for anyone recorded before the column existed (DATA-SCOPE.md, Stage 6). The two free-text
 * work locations are compared against the reachable branches' names, exactly, the way
 * `accounts/cash-entries/read.service.js` compares its `branch`.
 *
 * The texts are read *beside* the reference rather than only where it is missing, because the
 * reference is **derived from them and can only hold one**: `referenceColumnsFor` recomputes
 * `branchId` on every write that touches either location, as Work Base Location *or else* Current
 * Work Location. So somebody based in one branch and posted to another carries the base branch
 * alone, and reading the reference first hid them from the branch they actually work in. An
 * employee with none of the three is nobody's to read under a branch scope, which is the same rule
 * as a user reaching no branch.
 */
async function branchWhere(branchIds) {
  if (branchIds === null || branchIds === undefined) return {};
  if (!branchIds.length) return { id: { in: [] } };
  const names = (await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { name: true } })).map((row) => row.name).filter(Boolean);
  return {
    OR: [
      { branchId: { in: branchIds } },
      ...(names.length ? [{ workBaseLocation: { in: names } }, { currentWorkLocation: { in: names } }] : []),
    ],
  };
}

/** Employees matching a search, in the safe shape. */
async function searchEmployees({ search, department, status, limit, branchIds, active } = {}) {
  // The branch rule sits under AND so the search's own OR below cannot stand in for it.
  const where = { archivedAt: null, AND: [await branchWhere(branchIds)], ...(active ? { employmentStatus: { in: await workingEmployeeStatuses() } } : {}) };

  const term = String(search || "").trim();
  if (term) {
    where.OR = [
      { employeeId: { contains: term } },
      { employeeName: { contains: term } },
      { designation: { contains: term } },
      { department: { contains: term } },
    ];
  }
  const inDepartment = String(department || "").trim();
  if (inDepartment) where.department = inDepartment;
  const employmentStatus = String(status || "").trim();
  if (employmentStatus) where.employmentStatus = employmentStatus;

  const take = boundedLimit(limit);
  const [rows, total] = await Promise.all([
    prisma.employee.findMany({ where, select: SAFE_FIELDS, orderBy: { employeeName: "asc" }, take }),
    // Counted in the database rather than by measuring the page, so "how many" is answerable
    // without fetching everybody.
    prisma.employee.count({ where }),
  ]);

  return { count: rows.length, total, limit: take, truncated: total > rows.length, items: rows };
}

/** One employee by their employee id or database id, in the safe shape. */
async function getEmployee({ employeeId, branchIds } = {}) {
  const id = String(employeeId || "").trim();
  if (!id) throw new Error("An employee id is required.");

  const row = await prisma.employee.findFirst({
    where: { archivedAt: null, AND: [await branchWhere(branchIds)], OR: [{ employeeId: id }, ...(Number.isFinite(Number(id)) ? [{ id: Number(id) }] : [])] },
    select: SAFE_FIELDS,
  });
  return row ? { found: true, employee: row } : { found: false };
}

/**
 * How many people there are, grouped.
 *
 * Aggregated in the database. The alternative - fetching everyone and counting in the model - is
 * both slower and how a headcount ends up wrong.
 */
async function getHeadcount({ branchIds } = {}) {
  const where = { archivedAt: null, AND: [await branchWhere(branchIds)] };
  const [byDepartment, byStatus, byVertical, total] = await Promise.all([
    prisma.employee.groupBy({ by: ["department"], where, _count: { _all: true } }),
    prisma.employee.groupBy({ by: ["employmentStatus"], where, _count: { _all: true } }),
    prisma.employee.groupBy({ by: ["vertical"], where, _count: { _all: true } }),
    prisma.employee.count({ where }),
  ]);

  const shape = (rows, key) => rows
    .map((row) => ({ value: row[key] || "(not set)", count: row._count._all }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    byDepartment: shape(byDepartment, "department"),
    byStatus: shape(byStatus, "employmentStatus"),
    byVertical: shape(byVertical, "vertical"),
  };
}

module.exports = { searchEmployees, getEmployee, getHeadcount, SAFE_FIELDS, MAX_ROWS, DEFAULT_ROWS, WORKING_STATUSES };
