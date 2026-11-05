/**
 * What makes a Google Sheet lead-assignment rule complete, on the browser's side.
 *
 * A rule is a column, the value to look for in it, and the people who share the leads it matches —
 * each with the percentage they take. There are no conditions to choose between: the match is
 * always the column holding that value.
 *
 * The same questions are asked again by `validateRules` in
 * `backend/src/modules/sales/google-sheet-links/rulesStore.js`, which is the authority — this copy
 * exists so the studio is told beside the field, before a save that goes through a Google redirect
 * and comes back refused.
 */

/** How many people one rule may be shared between. Matches the backend's own cap. */
export const MAX_TARGETS = 20;

export const emptyTarget = (percent = 100) => ({ employeeId: "", percent: String(percent) });
export const emptyRule = () => ({ columnHeader: "", matchValue: "", targets: [emptyTarget()] });

/** A rule's shares as numbers, and what they add up to. */
export function shareTotal(rule) {
  return (rule?.targets || []).reduce((sum, target) => sum + (Number(target?.percent) || 0), 0);
}

/**
 * What is wrong with one share, or "" when nothing is.
 *
 * Keyed per share rather than rolled into the rule's message, so an unanswered picker is marked on
 * the box it belongs to instead of somewhere under a list of four people.
 */
export function targetIssue(target) {
  if (!target?.employeeId) return "Choose the employee.";
  const percent = Number(target?.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return "1 to 100.";
  return "";
}

/**
 * What is wrong with this rule, phrased for the person writing it, or "" when nothing is.
 *
 * The shares must add to 100. "60 and 30" is not a split that can be honoured — it is either a typo
 * or a claim that 10% of the leads belong to nobody, and guessing which would silently change what
 * somebody typed. The total is named, since that is the one thing needed to correct it.
 */
export function ruleIssue(rule) {
  if (!String(rule?.columnHeader || "").trim()) return "Choose the column to match.";
  if (!String(rule?.matchValue || "").trim()) return "Enter the value to match.";

  const targets = rule?.targets || [];
  if (!targets.length) return "Choose who these leads go to.";
  if (targets.some((target) => targetIssue(target))) return "Finish the shares below.";

  const ids = targets.map((target) => String(target.employeeId));
  if (new Set(ids).size !== ids.length) return "The same employee is listed twice. Give them one share instead.";

  const total = shareTotal(rule);
  if (total !== 100) return `The shares add up to ${total}%, not 100%.`;
  return "";
}

export function rulesHaveIssues(rules = []) {
  return rules.some((rule) => ruleIssue(rule) !== "");
}

/**
 * The shares re-spread evenly across however many people are now on the rule.
 *
 * Used when a person is added or removed, so the total lands back on 100 without anybody having to
 * do the arithmetic. The remainder goes to the first few, which is what keeps three people at
 * 34/33/33 rather than 33/33/33 and a percent nobody owns.
 */
export function evenShares(count) {
  if (count < 1) return [];
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
