/**
 * What counts as an acceptable password, and the one place that decides it.
 *
 * The reset form shows the same five rules and ticks them off as somebody types, which is what makes
 * the rules usable — but that list is a courtesy, not a gate. A browser can be bypassed, so the
 * answer that matters is this one, checked on the way in.
 *
 * The mirror of this list lives in `frontend/src/components/auth/ResetPasswordForm.js`. Two copies is
 * one more than ideal; a single shared module would have to be importable from both a CommonJS
 * backend and an ESM frontend that do not share a package, and until that exists the rules are kept
 * side by side and the test below is what stops them drifting apart silently.
 */
const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (value) => value.length >= 8 },
  { label: "One upper case letter", test: (value) => /[A-Z]/.test(value) },
  { label: "One lower case letter", test: (value) => /[a-z]/.test(value) },
  { label: "One number", test: (value) => /[0-9]/.test(value) },
  { label: "One special character", test: (value) => /[^A-Za-z0-9]/.test(value) },
];

/**
 * The first rule a password fails, or null when it meets them all.
 *
 * One rule at a time rather than a list of every failing rule: the form already shows the whole list
 * with its ticks, so a message here only has to name what to fix next.
 */
function passwordProblem(password) {
  const value = String(password ?? "");
  const failed = PASSWORD_RULES.find((rule) => !rule.test(value));
  return failed ? `Password needs ${failed.label.toLowerCase()}.` : null;
}

module.exports = { PASSWORD_RULES, passwordProblem };
