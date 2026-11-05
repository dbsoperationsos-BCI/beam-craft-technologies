const employees = require("../../../modules/hrm/employees/read.service");
const dataScope = require("../../dataScope.service");

/**
 * The branches an employee read is narrowed to. An employee record is not a business record with
 * somebody assigned to it - the employee *is* the person - so this is the branch limb alone.
 * `null` means unnarrowed (a Super Admin) and `[]` means none, which is what the read service
 * already understands.
 */
async function employeeBranchIds(session) {
  const scope = await dataScope.resolve({ userId: session?.userId, module: "HRM", feature: "Employee Management", columns: { branch: "branchId" } });
  return scope.unlimited ? null : (scope.branchIds || []);
}

/**
 * Read-only tools for HRM / Employee Management.
 *
 * Through `read.service.js`, which selects an explicit and short list of columns. An employee row
 * carries Aadhaar and PAN numbers, bank account and IFSC, salary, home address and photographs of
 * identity documents; none of it is needed to answer "who is in the editing team", and all of it
 * would reach a prompt if these returned rows.
 *
 * There is no tool for payroll, payment requests or separations. Those are the module's sensitive
 * corners, they have no service layer yet, and "the assistant could not read that" is a better
 * outcome than the alternative.
 */

const TOOLS = [
  {
    name: "hrm.getHeadcount",
    module: "HRM",
    risk: "READ",
    // The module's standing summary, fetched before the question so figures are never guessed.
    summary: true,
    description:
      "How many people work here, grouped by department, employment status and vertical. Use this "
      + "for any question about how many, rather than searching and counting.",
    schema: { type: "object", properties: {} },
    execute: async (_args, session) => employees.getHeadcount({ branchIds: await employeeBranchIds(session) }),
    renderSummary: (result) => [
      `Employees: ${result.total}`,
      result.byDepartment.length ? `By department:\n${result.byDepartment.map((row) => `- ${row.value}: ${row.count}`).join("\n")}` : "",
      result.byStatus.length ? `By status:\n${result.byStatus.map((row) => `- ${row.value}: ${row.count}`).join("\n")}` : "",
    ].filter(Boolean).join("\n"),
  },

  {
    name: "hrm.searchEmployees",
    module: "HRM",
    risk: "READ",
    description:
      "Find employees by name, employee id, designation or department. Returns a bounded list with "
      + "their role and status - never personal, bank or salary details.",
    schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of a name, employee id, designation or department." },
        department: { type: "string" },
        status: { type: "string", description: "Employment status, for example Active." },
        limit: { type: "integer", description: "Up to 50; defaults to 20." },
      },
    },
    execute: async (args, session) => employees.searchEmployees({ ...args, branchIds: await employeeBranchIds(session) }),
  },

  {
    name: "hrm.getEmployee",
    module: "HRM",
    risk: "READ",
    description: "One employee's role, department, location and joining date. No personal or financial details.",
    schema: {
      type: "object",
      properties: { employeeId: { type: "string", description: "The employee id, for example DBS001." } },
      required: ["employeeId"],
    },
    execute: async (args, session) => employees.getEmployee({ ...args, branchIds: await employeeBranchIds(session) }),
  },
];

module.exports = { TOOLS };
