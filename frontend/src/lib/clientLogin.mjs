import { renderMessageOr } from "./messageTemplate.mjs";
import { generateTemporaryPassword } from "./temporaryPassword.mjs";

/*
 * Create Project → Client Credentials, as data: a client login's starting state, the checks the
 * server will make (`clientLoginFor` in the backend), the body it takes, and the message that hands
 * it to the client - shown in Client Login Ready once the project is saved.
 *
 * The **username is the client's mobile number** - the ten digits of the project's Client Main
 * Number, without the country code - so it is never typed: the form shows it as it will be, and the
 * server works it out again from the number the project is saved with. A generated password, and no
 * email: a client signs in by username.
 */

/** A fresh client login: its password already generated. The username comes from the number. */
export const emptyClientLogin = () => ({ temporaryPassword: generateTemporaryPassword() });

/**
 * The username a client signs in with: the last ten digits of their Client Main Number, or "" while
 * the number is not yet a full one. The server's `clientUsernameFor` is the same rule.
 */
export function clientUsernameFor(clientMainNumber) {
  const digits = String(clientMainNumber ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/**
 * What is wrong with a client login, by field: a Client Main Number to make the username from, and
 * the generated password - the server's checks, said before the save.
 */
export function clientLoginProblems(login, { clientMainNumber } = {}) {
  const problems = {};
  if (!clientUsernameFor(clientMainNumber)) problems.username = "Add the client's 10-digit mobile number as the Client Main Number first.";
  if (!login?.temporaryPassword) problems.temporaryPassword = "Generate a temporary password.";
  return problems;
}

/**
 * The body the server takes. The username rides along for the handover message that follows the
 * save (Client Login Ready); the server makes its own from the project's number and ignores this one.
 */
export function clientLoginPayload(login, { clientMainNumber } = {}) {
  return { username: clientUsernameFor(clientMainNumber), temporaryPassword: login?.temporaryPassword || "" };
}

/** The template a client's login is handed over in: Settings → Message Templates → Client Login Credentials. */
export const CLIENT_LOGIN_TEMPLATE_KEY = "CLIENT_LOGIN_CREDENTIALS";

/**
 * The message that hands the client their login, in the studio's Client Login Credential wording,
 * filled in. Where the studio has no such template (a row somebody deleted), the wording it was
 * seeded with - the dialog must always have a usable message, since the password is never shown
 * again.
 */
export function clientLoginMessage(template, { projectName, username, temporaryPassword, loginLink }) {
  const values = {
    "project name": String(projectName || "").trim() || "your project",
    username: String(username || "").trim() || "—",
    password: temporaryPassword || "—",
    "login link": loginLink,
  };
  const fallback = [
    "Hi,",
    "",
    `Your login for ${values["project name"]} has been created. Sign in with:`,
    "",
    `Username: ${values.username}`,
    `Password: ${values.password}`,
    "",
    `Login here: ${loginLink}`,
    "",
    "Please do not share these details with anybody.",
  ].join("\n");
  return renderMessageOr(fallback, template, values);
}
