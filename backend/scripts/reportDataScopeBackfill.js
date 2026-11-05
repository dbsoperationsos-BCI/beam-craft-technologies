/**
 * The match report: what every free-text branch, vertical and owner column holds, and which row of
 * the table it should reference each value would map to - or fail to.
 *
 * Read-only, and safe to run against production: SELECT and nothing else. It exists because the
 * brief is explicit that no reference column is backfilled until this output has been read and the
 * matching rule approved (DATA-SCOPE.md, Stage 6). The rule proposed for each column is stated
 * beside its numbers, so approving is approving something concrete.
 *
 *   node scripts/reportDataScopeBackfill.js
 *
 * The rules live in `src/services/referenceMatchers.js`, shared with the write paths and the invariant
 * test. `auditBranchValues.js` is the earlier, narrower version of this for the branch columns alone.
 */
const prisma = require("../src/config/db");
const { branchMatcher, verticalMatcher, employeeMatcher } = require("../src/services/referenceMatchers");

async function distinct(table, column, extraWhere = "") {
  // Identifiers come from the fixed lists below, never from input.
  return prisma.$queryRawUnsafe(`SELECT \`${column}\` AS value, COUNT(*) AS n FROM \`${table}\` ${extraWhere} GROUP BY \`${column}\` ORDER BY n DESC`);
}

function report(label, rows, match, describe) {
  const totals = { rows: 0, matched: 0, blank: 0, unmatched: 0, ambiguous: 0 };
  const lines = [];
  for (const row of rows) {
    const n = Number(row.n);
    totals.rows += n;
    const hit = match(row.value);
    if (hit.kind === "blank") { totals.blank += n; lines.push(`   ${String(n).padStart(6)}  (blank)`); continue; }
    if (hit.kind === "ambiguous") { totals.ambiguous += n; lines.push(`   ${String(n).padStart(6)}  ${String(row.value).padEnd(28)} -> AMBIGUOUS (more than one employee has this name)`); continue; }
    if (hit.kind === "unmatched") { totals.unmatched += n; lines.push(`   ${String(n).padStart(6)}  ${String(row.value).padEnd(28)} -> UNMATCHED`); continue; }
    totals.matched += n;
    lines.push(`   ${String(n).padStart(6)}  ${String(row.value).padEnd(28)} -> ${describe(hit.target)}  [${hit.kind}]`);
  }
  console.log(`${label}`);
  console.log(`   rows ${totals.rows} · matched ${totals.matched} · blank ${totals.blank} · unmatched ${totals.unmatched}${totals.ambiguous ? ` · ambiguous ${totals.ambiguous}` : ""}`);
  if (!rows.length) console.log("   (no rows)");
  for (const line of lines) console.log(line);
  console.log("");
  return totals;
}

async function main() {
  const [branches, verticals, employees] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true, code: true } }),
    prisma.vertical.findMany({ select: { id: true, name: true, code: true, documentCode: true, identifierCode: true } }),
    prisma.employee.findMany({ select: { id: true, employeeId: true, employeeName: true, loginUsername: true, archivedAt: true } }),
  ]);
  const branch = branchMatcher(branches);
  const vertical = verticalMatcher(verticals);
  const employee = employeeMatcher(employees);
  const b = (t) => `branch ${t.id} (${t.name})`;
  const v = (t) => `vertical ${t.id} (${t.name})`;
  const e = (t) => `employee ${t.id} (${t.employeeName}, ${t.employeeId}${t.loginUsername ? `, ${t.loginUsername}` : ""}${t.archivedAt ? ", archived" : ""})`;

  console.log(`\nBranches: ${branches.map((x) => x.name).join(", ")}`);
  console.log(`Verticals: ${verticals.map((x) => `${x.name} [${x.code}${x.documentCode ? ` / ${x.documentCode} / ${x.identifierCode}` : ""}]`).join(", ")}`);
  console.log(`Employees: ${employees.map((x) => `${x.employeeName} (${x.employeeId}${x.loginUsername ? `, ${x.loginUsername}` : ""})`).join(", ")}\n`);

  console.log("══ BRANCH columns → branch_id   (rule: exact name, else the first word of the name; 'Vizag' → Visakhapatnam)\n");
  const branchColumns = [
    ["sales_crm_lead", "assigned_branch", "WHERE deleted_at IS NULL"],
    ["sales_project", "source_branch", "WHERE deleted_at IS NULL"],
    ["sales_quotation", "source_branch", ""],
    ["cash_entry", "branch", "WHERE deleted_at IS NULL"],
    ["payment_request", "branch", ""],
    ["hrm_task", "branch", ""],
    ["sales_whatsapp_group_name", "branch", ""],
    ["employee", "work_base_location", "WHERE archived_at IS NULL"],
    ["employee", "current_work_location", "WHERE archived_at IS NULL"],
  ];
  for (const [table, column, where] of branchColumns) {
    let rows; try { rows = await distinct(table, column, where); } catch (error) { console.log(`${table}.${column}  — skipped (${error.message.split("\n")[0]})\n`); continue; }
    report(`${table}.${column}`, rows, branch, b);
  }

  console.log("══ VERTICAL columns → vertical_id   (rule: the name, the code, the document code or the identifier code, spelling folded)\n");
  const verticalColumns = [
    ["sales_crm_lead", "branch", "WHERE deleted_at IS NULL"],
    ["sales_project", "vertical", "WHERE deleted_at IS NULL"],
    ["sales_whatsapp_group_name", "vertical", ""],
    ["sales_project_crd_document", "vertical", ""],
    ["employee", "vertical", "WHERE archived_at IS NULL"],
  ];
  for (const [table, column, where] of verticalColumns) {
    let rows; try { rows = await distinct(table, column, where); } catch (error) { console.log(`${table}.${column}  — skipped (${error.message.split("\n")[0]})\n`); continue; }
    report(`${table}.${column}`, rows, vertical, v);
  }

  console.log("══ OWNER columns → owner_employee_id   (rule: the employee's full name or employee id, exactly - never a first name alone)\n");
  const ownerColumns = [
    ["sales_crm_lead", "crm", "WHERE deleted_at IS NULL"],
    ["sales_quotation", "followed_by", ""],
    ["sales_project", "crm_name", "WHERE deleted_at IS NULL AND crm_employee_id IS NULL"],
    ["sales_project", "project_manager", "WHERE deleted_at IS NULL AND project_manager_employee_id IS NULL"],
  ];
  for (const [table, column, where] of ownerColumns) {
    let rows; try { rows = await distinct(table, column, where); } catch (error) { console.log(`${table}.${column}  — skipped (${error.message.split("\n")[0]})\n`); continue; }
    report(`${table}.${column}${where.includes("_employee_id IS NULL") ? "  (rows whose employee id is not already set)" : ""}`, rows, employee, e);
  }

  console.log("══ TASKS: assigned between logins, not employees\n");
  const [taskTotals] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS tasks,
           SUM(t.assigned_to_user_id IS NULL) AS unassigned,
           SUM(t.assigned_to_user_id IS NOT NULL AND u1.linked_employee_id IS NULL) AS assignee_without_employee,
           SUM(t.assigned_by_user_id IS NOT NULL AND u2.linked_employee_id IS NULL) AS assigner_without_employee
      FROM hrm_task t
      LEFT JOIN user u1 ON u1.id = t.assigned_to_user_id
      LEFT JOIN user u2 ON u2.id = t.assigned_by_user_id`);
  const unlinked = await prisma.user.findMany({ where: { status: "ACTIVE", linkedEmployeeId: null }, select: { id: true, name: true, email: true, role: true } });
  console.log(`   tasks ${Number(taskTotals.tasks)} · unassigned ${Number(taskTotals.unassigned)} · assignee's login has no employee ${Number(taskTotals.assignee_without_employee)} · assigner's login has no employee ${Number(taskTotals.assigner_without_employee)}`);
  console.log(`   active logins with no linked employee: ${unlinked.length}${unlinked.length ? " - " + unlinked.map((u) => `${u.name} <${u.email}> (${u.role})`).join(", ") : ""}\n`);
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
