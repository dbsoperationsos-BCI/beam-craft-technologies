/**
 * Who a Google Sheet row's lead belongs to, decided by the studio's own rules.
 *
 * A sheet says who a lead is; it rarely says whose lead it is. The studio's answer to that has
 * always been a person reading a column - "anything from the Coimbatore page is Divya's" - and
 * doing it by hand, which is a job nobody can keep up with on a sheet that grows every hour. These
 * rules are that reading, written down once per linked sheet: a column, the value to look for, and
 * the employee whose lead it is when the two meet.
 *
 * Nothing here reads or writes anything. It answers one question about one row - "whose lead is
 * this?" - so the rules can be argued with directly in a test, the way `callRouting` answers the
 * same question for a Callyzer call. The database side is `google-sheet-links/rulesStore.js`, and
 * the single place the answer is used is `mapRowToCrmCandidate` in `googleSheetsService.js`.
 *
 * Three decisions worth knowing before changing anything here:
 *
 *   1. **A rule is one column matching one value, and nothing else.** No operators - no "contains",
 *      no "is any of", no catch-all. The studio asked for the matching column only, and two values
 *      going to the same person is two rules rather than a syntax to learn. What "matching" means
 *      is in `fold` below, and it is deliberately forgiving.
 *   1b. **A rule may name several people, each with a share.** The shares add to 100 and are
 *      exactly what the studio typed. A lead cannot be split, so the split only exists across a run
 *      of leads - see `chooseTarget`, which is what turns percentages into individual decisions.
 *   2. **Rules match the sheet's own headers, not the CRM fields the importer maps them to.** The
 *      columns a studio actually routes by - Page Name, Form Name, Team, Ad Account - are exactly
 *      the ones `CRM_FIELD_ALIASES` has no name for, so they arrive in `unmappedHeaders` and a rule
 *      written against a mapped field could never see them.
 *   3. **The first matching rule wins and evaluation stops.** Two rules that both match a row is
 *      not an error to report, it is a question the studio answers by ordering them - which is why
 *      `priority` is stored and editable rather than inferred from insertion order.
 */

/**
 * The shape everything here compares in: lowercase, alphanumerics only.
 *
 * The same rule `normalizeText` in `googleSheetsService` folds headers with, restated here so this
 * module stays free of that one. It is deliberately blunt - "Erode TN", "erode-tn" and "ERODE_TN"
 * are one value - because these rules are typed by hand against columns filled in by hand, and a
 * rule that fails on a hyphen looks to the studio like a rule that does not work.
 */
function fold(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Which of a rule's people takes the next lead.
 *
 * Whoever is furthest below their share: the smallest `assignedCount / percent`. Ties go to the
 * one listed first, so the answer never depends on the order rows came back from the database.
 *
 * That ratio is the whole of it. With 60/40 and nothing handed out, both are at 0 and the first
 * listed takes it; they are then at 1/60 against 0/40, so the next goes to the other; and so on,
 * arriving at exactly 6 and 4 after ten leads. A lead cannot be split - only a run of them can -
 * which is why this reads a running count rather than a proportion of one row.
 */
function chooseTarget(targets = []) {
  let chosen = null;
  let best = Infinity;
  for (const target of targets) {
    if (!target || !(target.percent > 0)) continue;
    const share = (Number(target.assignedCount) || 0) / target.percent;
    if (share < best) {
      best = share;
      chosen = target;
    }
  }
  return chosen;
}

/** A rule's people, in listed order, with anybody who could not take a lead dropped. */
function prepareTargets(rule) {
  const raw = Array.isArray(rule?.targets) ? rule.targets : [];
  return raw
    // Blank means the rule points at nobody - an employee deleted since it was written - and a
    // target that assigns nobody must not take a share, because writing "" into the lead's CRM
    // would read as a deliberate un-assignment rather than as a rule that has stopped working.
    .filter((target) => String(target?.employeeName || "").trim() && Number(target?.percent) > 0)
    .map((target, index) => ({
      employeeId: target.employeeId ?? null,
      crm: String(target.employeeName).trim(),
      percent: Number(target.percent),
      assignedCount: Number(target.assignedCount) || 0,
      position: Number.isFinite(Number(target.position)) ? Number(target.position) : index,
    }))
    .sort((a, b) => a.position - b.position || String(a.crm).localeCompare(String(b.crm)));
}

/** A rule as it can actually be evaluated, or null for one that could never fire. */
function prepareRule(rule, headerIndex) {
  const targets = prepareTargets(rule);
  if (!targets.length) return null;

  const columnHeader = String(rule?.columnHeader || "").trim();
  if (!columnHeader) return null;

  const matchValue = String(rule?.matchValue ?? "");
  const folded = fold(matchValue);
  if (!folded) return null;

  const key = fold(columnHeader);
  return {
    id: String(rule?.id || ""),
    priority: Number.isFinite(Number(rule?.priority)) ? Number(rule.priority) : 0,
    columnHeader,
    matchValue,
    folded,
    columnIndex: headerIndex.has(key) ? headerIndex.get(key) : -1,
    targets,
  };
}

/**
 * The rules compiled against one sheet's headers, ready to be asked of every row.
 *
 * Built once per sync rather than per row: resolving a column name to an index is the same answer
 * for all 14,000 rows of a sheet, and doing it per row is the difference between a sync that keeps
 * up with the two-minute poller and one that does not.
 *
 * `missingColumns` is the rules naming a column this sheet does not have. Reported rather than
 * silently dropped - a renamed column turns a working rule into leads quietly arriving unassigned,
 * which is precisely the failure that is invisible without being told.
 */
function buildAssignmentMatcher(headers = [], rules = []) {
  const headerIndex = new Map();
  headers.forEach((header, index) => {
    const key = fold(header);
    // First column wins, the way `resolveColumnMapping` resolves a duplicated header.
    if (key && !headerIndex.has(key)) headerIndex.set(key, index);
  });

  const prepared = [];
  const missingColumns = [];
  const ordered = [...(Array.isArray(rules) ? rules : [])].sort((a, b) => {
    const byPriority = (Number(a?.priority) || 0) - (Number(b?.priority) || 0);
    // Stable within a priority, so two rules the studio has not ordered still evaluate the same
    // way on every pass rather than depending on how the database happened to return them.
    return byPriority || String(a?.id || "").localeCompare(String(b?.id || ""));
  });

  for (const rule of ordered) {
    const ready = prepareRule(rule, headerIndex);
    if (!ready) continue;
    if (ready.columnIndex < 0) {
      missingColumns.push({ id: ready.id, columnHeader: ready.columnHeader });
      continue;
    }
    prepared.push(ready);
  }

  /**
   * The first rule whose column holds its value on this row, and which of its people takes it.
   *
   * **Counts forward as it goes.** The chosen target's `assignedCount` is incremented here so the
   * next row of the same sheet goes to somebody else - a pass that picked without counting would
   * give every row of a batch to the same person. These are working copies: what is written back
   * to the database is decided by `runGoogleSheetLinkSync` from the rows it actually created, so a
   * dry-run preview can show a realistic split without spending anybody's share.
   */
  function assign(row = []) {
    for (const rule of prepared) {
      if (fold(row?.[rule.columnIndex]) !== rule.folded) continue;
      const target = chooseTarget(rule.targets);
      if (!target) continue;
      target.assignedCount += 1;
      return {
        crm: target.crm,
        rule: {
          id: rule.id,
          columnHeader: rule.columnHeader,
          matchValue: rule.matchValue,
          targetEmployeeId: target.employeeId,
          targetEmployeeName: target.crm,
          // What the studio configured, so the preview can say "Vijay Kumar (60%)" rather than
          // leaving a split looking like a rule that keeps changing its mind.
          percent: target.percent,
        },
      };
    }
    return null;
  }

  return { assign, activeRules: prepared.length, missingColumns };
}

module.exports = { buildAssignmentMatcher, chooseTarget, fold };
