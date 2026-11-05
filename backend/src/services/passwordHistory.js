/**
 * Passwords a login has had before, and the refusal of one coming back.
 *
 * The user row keeps the bcrypt hashes of its previous passwords in `passwordHistory`, newest
 * first. Hashes, never the passwords: reuse is detected the way login is, by comparing the typed
 * password against each hash, so the history is no more useful to a reader of the database than
 * the current password column is.
 *
 * The list is capped, because the point is to stop somebody rotating between two favourites, not
 * to hold every password an account has ever had. The cap counts previous passwords; the current
 * one is checked as well, so the refusal covers the last PASSWORD_HISTORY_LIMIT + 1 passwords.
 */
const bcrypt = require("bcryptjs");

const PASSWORD_HISTORY_LIMIT = 5;

const PASSWORD_REUSED_MESSAGE =
  `This password has been used on this account before. Choose one that is not among your last ${PASSWORD_HISTORY_LIMIT + 1} passwords.`;

/** The stored history as an array of hashes, whatever shape the column came back in. */
function historyOf(value) {
  return Array.isArray(value) ? value.filter((hash) => typeof hash === "string" && hash) : [];
}

/**
 * The message refusing a new password that matches the current one or any in the history, or null
 * when it is genuinely new. Compared one hash at a time, since bcrypt has no batch form.
 */
async function passwordReuseProblem(password, currentHash, history) {
  const candidates = [currentHash, ...historyOf(history)].filter(Boolean);
  for (const hash of candidates) {
    if (await bcrypt.compare(String(password ?? ""), hash)) return PASSWORD_REUSED_MESSAGE;
  }
  return null;
}

/**
 * The history to store once `currentHash` is being replaced: it joins the front of the list and
 * the oldest falls off the end.
 */
function nextPasswordHistory(currentHash, history) {
  return [currentHash, ...historyOf(history)].filter(Boolean).slice(0, PASSWORD_HISTORY_LIMIT);
}

module.exports = { PASSWORD_HISTORY_LIMIT, PASSWORD_REUSED_MESSAGE, passwordReuseProblem, nextPasswordHistory };
