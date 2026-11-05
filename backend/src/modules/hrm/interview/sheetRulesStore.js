const prisma = require("../../../config/db");
const { fold } = require("../../sales/crm-leads/leadAssignmentRules");
const { validateRules } = require("../../sales/google-sheet-links/rulesStore");

/**
 * The assignment rules of a linked Interview sheet, read and written.
 *
 * The same rules the CRM's linked sheets carry - a column, the value to look for in it, and the
 * people who share the candidates it matches - stored on the Interview module's own two tables.
 * `validateRules` is reused from the CRM's store unchanged: what makes a rule complete is the same
 * question on both sides, and answering it twice is how two answers drift. What differs is only the
 * storage, which is Prisma here rather than the raw SQL the CRM's tables needed for their bootstrap.
 *
 * The shape every reader gets is the CRM's, so `buildAssignmentMatcher` and the Settings panel read
 * an Interview rule exactly as they read a Sales one.
 */

/** The names of the employees these rules point at, keyed by id. */
async function employeeNames(ids) {
  const wanted = [...new Set(ids.filter((value) => Number.isInteger(value) && value > 0))];
  if (!wanted.length) return new Map();
  const rows = await prisma.employee.findMany({ where: { id: { in: wanted } }, select: { id: true, employeeName: true } });
  return new Map(rows.map((row) => [row.id, row.employeeName || ""]));
}

function mapTarget(row, names) {
  const current = row.employeeId ? names.get(row.employeeId) : "";
  return {
    id: String(row.id),
    position: Number(row.position) || 0,
    employeeId: row.employeeId ?? null,
    // The roster's spelling where the employee is still on it, the stored copy where they are not.
    employeeName: String(current || row.employeeName || ""),
    percent: Number(row.percent) || 0,
    assignedCount: Number(row.assignedCount) || 0,
    employeeMissing: !current,
  };
}

/** The rules of one link, in the order they are evaluated. */
async function listRulesForLink(linkId) {
  const id = String(linkId || "").trim();
  if (!id) return [];
  const rules = await prisma.hrmInterviewGoogleSheetAssignmentRule.findMany({
    where: { linkId: id },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });
  if (!rules.length) return [];
  const targets = await prisma.hrmInterviewGoogleSheetAssignmentRuleTarget.findMany({
    where: { ruleId: { in: rules.map((rule) => rule.id) } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  const names = await employeeNames(targets.map((target) => target.employeeId));
  const byRule = new Map();
  for (const target of targets) {
    if (!byRule.has(target.ruleId)) byRule.set(target.ruleId, []);
    byRule.get(target.ruleId).push(mapTarget(target, names));
  }
  return rules.map((rule) => ({
    id: String(rule.id),
    linkId: String(rule.linkId),
    priority: Number(rule.priority) || 0,
    columnHeader: String(rule.columnHeader || ""),
    matchValue: String(rule.matchValue ?? ""),
    targets: byRule.get(rule.id) || [],
  }));
}

/** The key a share's running count is carried across a save by: what the rule is, and who it is. */
const countKey = (columnHeader, matchValue, employeeId) => `${fold(columnHeader)}|${fold(matchValue)}|${employeeId}`;

/**
 * Replace a link's rules with the list given - the whole ordered list, since order is part of the
 * answer. The split counters survive on the natural key a share has (column, value, employee), so
 * editing a percentage keeps the balance and re-pointing the rule starts it afresh.
 */
async function replaceRulesForLink(linkId, rules) {
  const id = String(linkId || "").trim();
  if (!id) return [];

  const current = await listRulesForLink(id);
  const carried = new Map();
  for (const rule of current) {
    for (const target of rule.targets) carried.set(countKey(rule.columnHeader, rule.matchValue, target.employeeId), target.assignedCount);
  }
  const names = await employeeNames(rules.flatMap((rule) => rule.targets.map((target) => target.employeeId)));
  const stamp = Date.now().toString(36);

  const ruleRows = [];
  const targetRows = [];
  rules.forEach((rule, index) => {
    const ruleId = `${id}-${index}-${stamp}`;
    ruleRows.push({ id: ruleId, linkId: id, priority: index, columnHeader: rule.columnHeader, matchValue: rule.matchValue });
    rule.targets.forEach((target, position) => {
      targetRows.push({
        id: `${ruleId}-t${position}`,
        ruleId,
        position,
        employeeId: target.employeeId,
        employeeName: names.get(target.employeeId) || "",
        percent: target.percent,
        assignedCount: carried.get(countKey(rule.columnHeader, rule.matchValue, target.employeeId)) || 0,
      });
    });
  });

  await prisma.$transaction([
    prisma.hrmInterviewGoogleSheetAssignmentRuleTarget.deleteMany({ where: { ruleId: { in: current.map((rule) => rule.id) } } }),
    prisma.hrmInterviewGoogleSheetAssignmentRule.deleteMany({ where: { linkId: id } }),
    ...(ruleRows.length ? [prisma.hrmInterviewGoogleSheetAssignmentRule.createMany({ data: ruleRows })] : []),
    ...(targetRows.length ? [prisma.hrmInterviewGoogleSheetAssignmentRuleTarget.createMany({ data: targetRows })] : []),
  ]);
  return listRulesForLink(id);
}

/**
 * Note that these targets have taken these candidates, so the next pass carries on from here.
 * `counts` is keyed `"<ruleId>::<employeeId>"`, as the sync builds it. Reporting, not the work: a
 * lost count costs a slightly uneven split, never a candidate, so it is logged rather than thrown.
 */
async function recordAssignedCounts(counts) {
  const entries = [...(counts instanceof Map ? counts : new Map())].filter(([, n]) => n > 0);
  if (!entries.length) return;
  try {
    await prisma.$transaction(entries.map(([key, n]) => {
      const [ruleId, employeeId] = String(key).split("::");
      return prisma.hrmInterviewGoogleSheetAssignmentRuleTarget.updateMany({
        where: { ruleId, employeeId: Number(employeeId) },
        data: { assignedCount: { increment: n } },
      });
    }));
  } catch (error) {
    console.warn("Unable to record the interview assignment split counts:", error?.message || error);
  }
}

/** Deleting a link takes its rules, and their people, with it. */
async function deleteRulesForLink(linkId) {
  const id = String(linkId || "").trim();
  if (!id) return;
  const rules = await prisma.hrmInterviewGoogleSheetAssignmentRule.findMany({ where: { linkId: id }, select: { id: true } });
  await prisma.$transaction([
    prisma.hrmInterviewGoogleSheetAssignmentRuleTarget.deleteMany({ where: { ruleId: { in: rules.map((rule) => rule.id) } } }),
    prisma.hrmInterviewGoogleSheetAssignmentRule.deleteMany({ where: { linkId: id } }),
  ]);
}

module.exports = { listRulesForLink, replaceRulesForLink, deleteRulesForLink, recordAssignedCounts, validateRules };
