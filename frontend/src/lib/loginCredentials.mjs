/*
 * The sign-in identity every new account is made with - an employee's (Employee Preference →
 * Credentials) and a client's (Create Project → Client Credentials) - checked by one set of rules,
 * the same the API enforces (`backend/src/services/loginCredentials.js`), so each problem is shown
 * against its own field before the server has to refuse it.
 */

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/**
 * What is wrong with a username, login email and temporary password, by field. `email: false` for a
 * sign-in made without one - a client's, which signs in by username alone.
 */
export function loginIdentityProblems({ username, email, temporaryPassword } = {}, { email: needsEmail = true } = {}) {
  const problems = {};
  const name = String(username ?? "").trim();
  const address = String(email ?? "").trim();
  if (!name) problems.username = "A username is required.";
  else if (name.length < 3) problems.username = "Use at least three characters.";
  else if (name.length > 50) problems.username = "Use at most 50 characters.";
  else if (!USERNAME_PATTERN.test(name)) problems.username = "Letters, numbers, dots, underscores and hyphens only.";
  if (needsEmail) {
    if (!address) problems.email = "A login email is required.";
    else if (!EMAIL_PATTERN.test(address) || address.length > 191) problems.email = "Enter a valid email address.";
  }
  if (!temporaryPassword) problems.temporaryPassword = "Generate a temporary password.";
  return problems;
}
