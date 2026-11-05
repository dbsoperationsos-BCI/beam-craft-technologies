const crypto = require("node:crypto");
const { z } = require("zod");
const prisma = require("../config/db");

/*
 * The fields every new sign-in is created with - an employee's (Employee Preference → Credentials)
 * and a client's (Create Project → Client Credentials) - so the two cannot accept different
 * usernames, emails or starting passwords.
 */
const loginCredentialFields = {
  email: z.string().trim().email().max(191),
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, "Username may contain letters, numbers, dots, underscores, and hyphens only"),
  /*
   * The password the account starts on.
   *
   * The mixed-case-and-symbol rule that used to be here was relaxed because the studio's chosen
   * starting password does not meet it. Worth knowing what that leans on: the create paths set
   * `mustChangePassword: true`, but nothing reads that flag yet — no screen forces the change — so
   * this value stays a working password until its owner changes it by choice.
   *
   * A length is still required, because whatever arrives here is bcrypt-hashed and becomes a real
   * password until it is changed.
   */
  temporaryPassword: z.string().min(8).max(128),
};

/** The account's role for a client's sign-in. Refused everywhere but its own account routes (`protect`). */
const CLIENT_ROLE = "CLIENT";

/*
 * A client login's starting password: only the shape the form generates (`generateTemporaryPassword`
 * in frontend/src/lib/temporaryPassword.mjs - three groups of four from that alphabet, about 58 bits
 * of randomness), so a request sent around the form cannot give a client `12345678`. Test
 * `client-login.test.js` holds the two alphabets to each other.
 */
const TEMPORARY_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz346789";
const generatedTemporaryPassword = z.string().regex(
  new RegExp(`^([${TEMPORARY_PASSWORD_ALPHABET}]{4}-){2}[${TEMPORARY_PASSWORD_ALPHABET}]{4}$`),
  "Regenerate the temporary password on the form.",
);

/**
 * A starting password of that same shape, made on the server - for a login reopened when somebody
 * rejoins, where no form is open to generate one. `crypto.randomInt` is uniform, so no letter of the
 * alphabet is favoured.
 */
function newTemporaryPassword() {
  const group = () => Array.from({ length: 4 }, () => TEMPORARY_PASSWORD_ALPHABET[crypto.randomInt(TEMPORARY_PASSWORD_ALPHABET.length)]).join("");
  return [group(), group(), group()].join("-");
}

/**
 * Which of an email and a username another sign-in already holds: `"email"`, `"username"`, or
 * `null` when both are free. An account made without an email (a client's) asks about the username
 * alone. Checked before saving so the answer can name the field; the unique indexes still decide a
 * race.
 */
async function takenLoginField({ email, username }, client = prisma) {
  const [byEmail, byUsername] = await Promise.all([
    email ? client.user.findUnique({ where: { email }, select: { id: true } }) : null,
    client.user.findUnique({ where: { username }, select: { id: true } }),
  ]);
  if (byEmail) return "email";
  if (byUsername) return "username";
  return null;
}

module.exports = { loginCredentialFields, CLIENT_ROLE, TEMPORARY_PASSWORD_ALPHABET, generatedTemporaryPassword, newTemporaryPassword, takenLoginField };
