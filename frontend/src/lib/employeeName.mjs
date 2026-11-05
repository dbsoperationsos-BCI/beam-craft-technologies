/**
 * How an employee's one stored name is taken apart, and the login username built from it.
 *
 * The repository keeps a single `employeeName`. Two screens need it in halves — the employee form,
 * which asks for a first and last name separately, and the login username, which is built from them
 * — so the split is written once here. Two copies of this rule would put a person's own record and
 * their sign-in name out of step over something as ordinary as a middle name.
 */

/**
 * Everything before the last word is the first name; the last word is the last name.
 *
 * A one-word name is all first name and no last: "Madonna" is not a surname, and guessing that it
 * is would file the person under it.
 */
export function splitEmployeeName(employeeName) {
  const parts = String(employeeName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

/** Lowercase, and anything that is not a letter or digit becomes the separator the username uses. */
const slug = (value) => String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");

/** The longest a username may be, matching the column it is stored in. */
const MAX_USERNAME = 50;

/**
 * The username an employee signs in with: first name, a dot, then last name — `john.smith`.
 *
 * The name in the order it is written. It was surname-first for a while, which reads correctly for
 * a Western-style name and badly for the studio's own: the repository is full of names like
 * "dhanush M M", where the trailing word is an initial rather than a surname, so leading with it
 * produced `m.dhanush.m` — a username beginning with a bare letter that nobody would guess at.
 *
 * A middle name or an initial keeps its place, joined by the same dot, since a username has no room
 * for a space: "Rajesh Kumar Nair" becomes `rajesh.kumar.nair` and "dhanush M M" becomes
 * `dhanush.m.m`. A one-word name is used as it stands.
 *
 * **Not unique by construction.** The employee id used to be tacked on the end, which made it so;
 * the studio signs in by name, and two people who share one will collide. That is not silent — the
 * API refuses the second with "A user already exists with this username" and the field is editable,
 * so whoever is onboarding picks something else.
 */
export function loginUsername(employeeName) {
  const { firstName, lastName } = splitEmployeeName(employeeName);
  const username = [slug(firstName), slug(lastName)].filter(Boolean).join(".");
  return username.slice(0, MAX_USERNAME);
}

/**
 * The domain every login address is issued under, when the studio has not named one.
 *
 * It was the studio's own domain, written here as a constant — which made the product's source the
 * place a studio's identity lived, and meant a second studio running this OS issued its people
 * addresses at somebody else's domain. The domain is now **Settings → Global → Login Credential
 * Name**; this is what stands in until one is set. Not a mailbox anybody reads either way: a login
 * address is an identifier, and the mail that carries it goes to the person's own address.
 */
export const FALLBACK_LOGIN_EMAIL_DOMAIN = "beamcraft.com";

/**
 * The domain to issue login addresses under, from whatever Settings holds.
 *
 * The field is typed by hand, so it is read forgivingly: a scheme, a leading `@`, a `www.`, a
 * trailing path or slash and any spacing are all taken off, and the rest is lowercased. What is
 * left has to *look* like a domain — labels of letters, digits and hyphens with a dot between them
 * — before it is used.
 *
 * Anything else falls back rather than being turned into a domain. A studio that has typed its
 * name there ("Don't Blink Studios") means the name, not a guess at a domain: inventing
 * `dontblinkstudios.com` from it would issue every employee an address at a domain nobody chose,
 * and it would be found out one account at a time. The fallback is visible on the credentials page
 * before anything is created, and the field is editable.
 */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function loginEmailDomain(configured) {
  const candidate = String(configured ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^@/, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .trim();
  return DOMAIN_PATTERN.test(candidate) ? candidate : FALLBACK_LOGIN_EMAIL_DOMAIN;
}

/** How much of the last name the address carries. */
const LAST_NAME_LETTERS = 3;

/**
 * The address an employee signs in with: `john.smi@<the studio's domain>`.
 *
 * First name, a dot, and the first three letters of the last name. It is **built, not asked for**:
 * the login address used to be the employee's Work Email ID, typed on the credentials page and
 * filed back onto the record - which meant the sign-in for a studio account depended on somebody
 * typing a studio address correctly, and on there being one at all.
 *
 * The first name keeps its shape from `loginUsername`, so the two halves of one person's sign-in
 * agree: "Rajesh Kumar Nair" is `rajesh.kumar` plus `nai`, and "dhanush M M" is `dhanush.m` plus
 * `m` - a last name shorter than three letters gives what it has rather than being padded.
 *
 * A one-word name has no last name, and the address is the first name alone - `madonna@...` -
 * rather than a trailing dot before the @.
 *
 * **Not unique by construction**, for the same reason the username is not: two people who share a
 * name land on one address. The API refuses the second and the field is editable, so it is noticed
 * and changed rather than silently wrong.
 */
export function loginEmail(employeeName, domain) {
  const { firstName, lastName } = splitEmployeeName(employeeName);
  const first = slug(firstName);
  const last = slug(lastName).replace(/\./g, "").slice(0, LAST_NAME_LETTERS);
  const local = [first, last].filter(Boolean).join(".");
  return local ? `${local}@${loginEmailDomain(domain)}` : "";
}
