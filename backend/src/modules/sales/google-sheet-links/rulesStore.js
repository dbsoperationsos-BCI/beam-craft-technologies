const prisma = require("../../../config/db");
const { fold } = require("../crm-leads/leadAssignmentRules");

/**
 * The assignment rules of a linked sheet, read and written.
 *
 * A rule is a column, the value to look for in it, and the employee whose lead a matching row is.
 * Kept apart from `controller.js` because the sync reads them and the controller writes them, and
 * the controller already requires the sync - importing it back would be a cycle. The decision the
 * rules drive is in `crm-leads/leadAssignmentRules.js`, which touches no database at all; this
 * module is only the storage half.
 *
 * A rule's **people live on their own table**, one row each with the share they take, so a column
 * value two people work between them can be written down. `employee_name` is stored beside
 * `employee_id` on purpose: the id is the target's real subject - it answers "which splits name the
 * person who just left?" - while the name is what goes into the lead's `crm` column, since that
 * column holds an employee's name and the board's own picker is built from names. The name is
 * refreshed from the roster on every read, so renaming an employee follows through; the stored copy
 * is the fallback for an employee row that no longer exists.
 */

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`sales_google_sheet_assignment_rule\` (
  \`id\`                   VARCHAR(191) NOT NULL,
  \`link_id\`              VARCHAR(191) NOT NULL,
  \`priority\`             INT          NOT NULL DEFAULT 0,
  \`column_header\`        VARCHAR(255) NOT NULL DEFAULT '',
  \`match_value\`          VARCHAR(500) NOT NULL DEFAULT '',
  \`created_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  INDEX \`sales_google_sheet_assignment_rule_link_id_idx\` (\`link_id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`;

const CREATE_TARGET_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`sales_google_sheet_assignment_rule_target\` (
  \`id\`             VARCHAR(191) NOT NULL,
  \`rule_id\`        VARCHAR(191) NOT NULL,
  \`position\`       INT          NOT NULL DEFAULT 0,
  \`employee_id\`    INT          NULL,
  \`employee_name\`  VARCHAR(150) NOT NULL DEFAULT '',
  \`percent\`        INT          NOT NULL DEFAULT 100,
  \`assigned_count\` INT          NOT NULL DEFAULT 0,
  \`created_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`sales_google_sheet_rule_target_rule_employee\` (\`rule_id\`, \`employee_id\`),
  INDEX \`sales_google_sheet_rule_target_rule_id_idx\` (\`rule_id\`),
  INDEX \`sales_google_sheet_rule_target_employee_id_idx\` (\`employee_id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`;

/**
 * The tables, created where an environment has not migrated yet.
 *
 * **Creates only.** It used to drop the columns an earlier shape of these tables left behind, and
 * that was a mistake with teeth: this runs from an ordinary `GET /google-sheet-links`, so it raced
 * the migration that was supposed to copy those columns into the new table first - and won, taking
 * the employee off a rule that had one. Removing a column is a migration's job, where it happens
 * once, in order, after whatever reads it.
 */
async function ensureRulesTableExists() {
  await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
  await prisma.$executeRawUnsafe(CREATE_TARGET_TABLE_SQL);
}

/** A rule as the API speaks it, from a database row plus its people. */
function mapRule(row, targets) {
  return {
    id: String(row.id),
    linkId: String(row.linkId),
    priority: Number(row.priority) || 0,
    columnHeader: String(row.columnHeader || ""),
    matchValue: String(row.matchValue ?? ""),
    targets,
  };
}

/** One person's share of a rule. */
function mapTarget(row) {
  return {
    id: String(row.id),
    position: Number(row.position) || 0,
    employeeId: row.employeeId === null || row.employeeId === undefined ? null : Number(row.employeeId),
    // The roster's spelling where the employee is still on it, the stored copy where they are not.
    employeeName: String(row.currentEmployeeName || row.employeeName || ""),
    percent: Number(row.percent) || 0,
    assignedCount: Number(row.assignedCount) || 0,
    // So the panel can say "this share points at somebody who is no longer an employee" rather
    // than showing a name that no picker offers.
    employeeMissing: !row.currentEmployeeName,
  };
}

/** Every rule's people, keyed by rule id. One query rather than one per rule. */
async function loadTargets(ruleIds) {
  const byRule = new Map();
  if (!ruleIds.length) return byRule;
  const placeholders = ruleIds.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT
      t.id, t.rule_id AS ruleId, t.position, t.employee_id AS employeeId,
      t.employee_name AS employeeName, t.percent, t.assigned_count AS assignedCount,
      e.employee_name AS currentEmployeeName
    FROM \`sales_google_sheet_assignment_rule_target\` t
    LEFT JOIN \`employee\` e ON e.id = t.employee_id
    WHERE t.rule_id IN (${placeholders})
    ORDER BY t.position ASC, t.id ASC
  `,
    ...ruleIds,
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row.ruleId);
    if (!byRule.has(key)) byRule.set(key, []);
    byRule.get(key).push(mapTarget(row));
  }
  return byRule;
}

/**
 * The rules of one link, in the order they are evaluated.
 *
 * A missing table is answered with no rules rather than an error: the sync runs every two minutes
 * against every link, and an environment that has not migrated yet must go on importing leads
 * unassigned rather than stop importing altogether.
 */
async function listRulesForLink(linkId) {
  const id = String(linkId || "").trim();
  if (!id) return [];
  try {
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT id, link_id AS linkId, priority, column_header AS columnHeader, match_value AS matchValue
      FROM \`sales_google_sheet_assignment_rule\`
      WHERE link_id = ?
      ORDER BY priority ASC, id ASC
    `,
      id,
    );
    const list = Array.isArray(rows) ? rows : [];
    const targetsByRule = await loadTargets(list.map((row) => String(row.id)));
    return list.map((row) => mapRule(row, targetsByRule.get(String(row.id)) || []));
  } catch (error) {
    if (isMissingTable(error)) return [];
    console.warn(`Unable to read assignment rules for sheet link ${id}:`, error?.message || error);
    return [];
  }
}

/** A table this environment has not created yet - the migration has not been run here. */
function isMissingTable(error) {
  return error?.code === "P2021" || /doesn't exist|no such table/i.test(String(error?.message || ""));
}

/**
 * What a rule has to be to be stored.
 *
 * Validated here rather than in the panel alone, because the panel is not the authority: the same
 * payload can arrive from anything holding a token. A rule missing any of its three answers could
 * never fire, and is refused rather than saved - a stored rule that does nothing is
 * indistinguishable to the studio from one that is broken.
 */
function validateRules(rules) {
  const issues = [];
  const cleaned = [];
  const list = Array.isArray(rules) ? rules : [];

  list.forEach((rule, index) => {
    const at = `Rule ${index + 1}`;
    const columnHeader = String(rule?.columnHeader ?? "").trim();
    if (!columnHeader) {
      issues.push(`${at}: choose the spreadsheet column to match.`);
      return;
    }
    const matchValue = String(rule?.matchValue ?? "").trim();
    if (!matchValue) {
      issues.push(`${at}: enter the value to match.`);
      return;
    }

    const rawTargets = Array.isArray(rule?.targets) ? rule.targets : [];
    if (!rawTargets.length) {
      issues.push(`${at}: choose at least one employee these leads are assigned to.`);
      return;
    }
    if (rawTargets.length > 20) {
      issues.push(`${at}: a rule can be shared between at most 20 people.`);
      return;
    }

    const targets = [];
    const seen = new Set();
    let total = 0;
    let bad = false;
    rawTargets.forEach((target, position) => {
      const employeeId = Number(target?.employeeId);
      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        issues.push(`${at}, share ${position + 1}: choose the employee.`);
        bad = true;
        return;
      }
      // One person appears once on a rule. Two rows for the same person are one total typed twice,
      // and the unique index would refuse them anyway - said here, where it can be read.
      if (seen.has(employeeId)) {
        issues.push(`${at}: the same employee is listed twice. Give them one share instead.`);
        bad = true;
        return;
      }
      seen.add(employeeId);
      const percent = Number(target?.percent);
      if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
        issues.push(`${at}, share ${position + 1}: the percentage must be a whole number between 1 and 100.`);
        bad = true;
        return;
      }
      total += percent;
      targets.push({ position, employeeId, percent });
    });
    if (bad) return;

    /*
     * The shares must add to 100.
     *
     * "60 and 30" is not a split this can honour - it is either a typo or a claim that 10% of the
     * leads belong to nobody, and guessing which would mean silently changing what somebody typed.
     * Refused with the total named, since that is the one thing needed to correct it.
     */
    if (total !== 100) {
      issues.push(`${at}: the shares add up to ${total}%, not 100%.`);
      return;
    }

    cleaned.push({
      priority: index,
      columnHeader: columnHeader.slice(0, 255),
      matchValue: matchValue.slice(0, 500),
      targets,
    });
  });

  return { valid: issues.length === 0, issues, rules: cleaned };
}

/**
 * Replace a link's rules with the list given.
 *
 * Replace rather than merge: the panel edits the whole ordered list at once and order is part of
 * the answer, so sending back the list the studio is looking at is the only shape that cannot
 * disagree with what they saw. Ids are re-issued on every save, which is why nothing outside these
 * two tables refers to a rule by id.
 *
 * ── What survives the replace ──
 *
 * The split counters do. `assignedCount` is what makes 60/40 come out as 60/40 rather than drifting,
 * and a replace that reset it would restart every balance whenever anything on the link was saved -
 * editing the sheet's tab, or a second rule, would quietly hand the next several leads to whoever
 * is listed first. They are carried across on the natural key a person's share actually has:
 * **column, value and employee**, folded the same forgiving way the matcher folds them. Change the
 * percentages and the balance is kept; point the rule at a different column and it starts afresh,
 * which is right - it is a different rule by then.
 */
async function replaceRulesForLink(linkId, rules) {
  const id = String(linkId || "").trim();
  if (!id) return [];
  await ensureRulesTableExists();

  const carried = await carriedCounts(id);
  const names = await employeeNames(rules.flatMap((rule) => rule.targets.map((target) => target.employeeId)));
  const stamp = Date.now().toString(36);
  const writes = [
    prisma.$executeRawUnsafe(
      "DELETE t FROM `sales_google_sheet_assignment_rule_target` t JOIN `sales_google_sheet_assignment_rule` r ON r.id = t.rule_id WHERE r.link_id = ?",
      id,
    ),
    prisma.$executeRawUnsafe("DELETE FROM `sales_google_sheet_assignment_rule` WHERE link_id = ?", id),
  ];

  rules.forEach((rule, index) => {
    const ruleId = `${id}-${index}-${stamp}`;
    writes.push(prisma.$executeRawUnsafe(
      `
      INSERT INTO \`sales_google_sheet_assignment_rule\`
        (\`id\`, \`link_id\`, \`priority\`, \`column_header\`, \`match_value\`, \`created_at\`, \`updated_at\`)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `,
      ruleId,
      id,
      index,
      rule.columnHeader,
      rule.matchValue,
    ));
    rule.targets.forEach((target, position) => {
      writes.push(prisma.$executeRawUnsafe(
        `
        INSERT INTO \`sales_google_sheet_assignment_rule_target\`
          (\`id\`, \`rule_id\`, \`position\`, \`employee_id\`, \`employee_name\`, \`percent\`, \`assigned_count\`, \`created_at\`, \`updated_at\`)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      `,
        `${ruleId}-t${position}`,
        ruleId,
        position,
        target.employeeId,
        names.get(target.employeeId) || "",
        target.percent,
        carried.get(countKey(rule.columnHeader, rule.matchValue, target.employeeId)) || 0,
      ));
    });
  });

  await prisma.$transaction(writes);
  return listRulesForLink(id);
}

/** The key a share's running count is carried across a save by: what the rule is, and who it is. */
function countKey(columnHeader, matchValue, employeeId) {
  return `${fold(columnHeader)}|${fold(matchValue)}|${employeeId}`;
}

/** This link's split counters as they stand, keyed the way `countKey` describes. */
async function carriedCounts(linkId) {
  const carried = new Map();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT r.column_header AS columnHeader, r.match_value AS matchValue,
             t.employee_id AS employeeId, t.assigned_count AS assignedCount
      FROM \`sales_google_sheet_assignment_rule_target\` t
      JOIN \`sales_google_sheet_assignment_rule\` r ON r.id = t.rule_id
      WHERE r.link_id = ?
    `,
      linkId,
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      carried.set(countKey(row.columnHeader, row.matchValue, Number(row.employeeId)), Number(row.assignedCount) || 0);
    }
  } catch (error) {
    // A balance that cannot be read starts again, which is a fair split from today rather than a
    // save that fails over bookkeeping.
    if (!isMissingTable(error)) console.warn(`Unable to carry split counts for sheet link ${linkId}:`, error?.message || error);
  }
  return carried;
}

/**
 * Note that these targets have taken these leads, so the next pass picks up where this one left off.
 *
 * Called once after a sync's writes, with the rows it actually created - never for a dry-run
 * preview, and never for a row that failed. The allocator advances its own working copies during a
 * pass so the rows of one batch go to different people; this is what makes that survive the pass.
 */
async function recordAssignedCounts(counts) {
  const entries = [...(counts instanceof Map ? counts : new Map())].filter(([, n]) => n > 0);
  if (!entries.length) return;
  try {
    await prisma.$transaction(entries.map(([key, n]) => {
      const [ruleId, employeeId] = String(key).split("::");
      return prisma.$executeRawUnsafe(
        "UPDATE `sales_google_sheet_assignment_rule_target` SET `assigned_count` = `assigned_count` + ? WHERE `rule_id` = ? AND `employee_id` = ?",
        n,
        ruleId,
        Number(employeeId),
      );
    }));
  } catch (error) {
    // Reporting, not the work: the leads are already written, and a lost count costs a slightly
    // uneven split rather than a lead.
    console.warn("Unable to record the assignment split counts:", error?.message || error);
  }
}

/** The names of the employees these rules point at, keyed by id. */
async function employeeNames(ids) {
  const wanted = [...new Set(ids.filter((value) => Number.isInteger(value) && value > 0))];
  if (!wanted.length) return new Map();
  const rows = await prisma.employee.findMany({ where: { id: { in: wanted } }, select: { id: true, employeeName: true } });
  return new Map(rows.map((row) => [row.id, row.employeeName || ""]));
}

/** Deleting a link takes its rules, and their people, with it - the way the row ledger goes. */
async function deleteRulesForLink(linkId) {
  const id = String(linkId || "").trim();
  if (!id) return;
  try {
    await prisma.$executeRawUnsafe(
      "DELETE t FROM `sales_google_sheet_assignment_rule_target` t JOIN `sales_google_sheet_assignment_rule` r ON r.id = t.rule_id WHERE r.link_id = ?",
      id,
    );
    await prisma.$executeRawUnsafe("DELETE FROM `sales_google_sheet_assignment_rule` WHERE link_id = ?", id);
  } catch (error) {
    if (!isMissingTable(error)) {
      console.warn(`Unable to delete assignment rules for sheet link ${id}:`, error?.message || error);
    }
  }
}

module.exports = { ensureRulesTableExists, listRulesForLink, replaceRulesForLink, deleteRulesForLink, recordAssignedCounts, validateRules };
