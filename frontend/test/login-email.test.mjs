import test from "node:test";
import assert from "node:assert/strict";

import { FALLBACK_LOGIN_EMAIL_DOMAIN, loginEmail, loginEmailDomain, loginUsername } from "../src/lib/employeeName.mjs";

/** What every case below is written against when it is not testing the domain itself. */
const LOGIN_EMAIL_DOMAIN = FALLBACK_LOGIN_EMAIL_DOMAIN;

/*
 * The address an employee signs in with.
 *
 * It used to be their Work Email ID, typed on the credentials page and filed back onto the record -
 * so a studio sign-in depended on somebody typing a studio address correctly, and on there being
 * one at all. It is built from the name now, and the rule is here because getting it wrong is an
 * account somebody cannot sign into and a credential email sent to an address that is not theirs.
 */

test("the address is the first name, a dot, and three letters of the last", () => {
  assert.equal(loginEmail("John Smith"), `john.smi@${LOGIN_EMAIL_DOMAIN}`);
  assert.equal(loginEmail("Shanmugam Parimalavalli"), `shanmugam.par@${LOGIN_EMAIL_DOMAIN}`);
});

test("a middle name keeps its place, the way the username does", () => {
  // The two halves of one person's sign-in have to agree about what their name is.
  assert.equal(loginUsername("Rajesh Kumar Nair"), "rajesh.kumar.nair");
  assert.equal(loginEmail("Rajesh Kumar Nair"), `rajesh.kumar.nai@${LOGIN_EMAIL_DOMAIN}`);
});

test("a last name shorter than three letters gives what it has", () => {
  // The studio's own names run to initials - "dhanush M M" - and padding one would invent letters.
  assert.equal(loginEmail("dhanush M M"), `dhanush.m.m@${LOGIN_EMAIL_DOMAIN}`);
  assert.equal(loginEmail("Priya S"), `priya.s@${LOGIN_EMAIL_DOMAIN}`);
});

test("a one-word name has no last name, and no trailing dot before the @", () => {
  assert.equal(loginEmail("Madonna"), `madonna@${LOGIN_EMAIL_DOMAIN}`);
});

test("anything that is not a letter or digit is folded away", () => {
  // A typed name arrives with whatever punctuation and spacing somebody used; an address cannot.
  assert.equal(loginEmail("  A.B  Chandra-Sekhar "), `a.b.cha@${LOGIN_EMAIL_DOMAIN}`);
  assert.equal(loginEmail("Ravi   Kumar"), `ravi.kum@${LOGIN_EMAIL_DOMAIN}`);
});

test("no name is no address, rather than a bare @domain", () => {
  for (const name of ["", "   ", null, undefined]) assert.equal(loginEmail(name), "");
});

/*
 * ── The domain ────────────────────────────────────────────────────────────────────────────────
 *
 * It was a constant in this file, which made the product's source the place one studio's identity
 * lived. It is Settings → Global → Login Credential Name now, and these say what that field is
 * allowed to be typed as and what happens when it is typed as something else - getting it wrong is
 * a studio's whole staff issued addresses at a domain nobody chose.
 */
test("the studio's own domain is what the address is issued at", () => {
  assert.equal(loginEmail("John Smith", "dontblinkstudioz.com"), "john.smi@dontblinkstudioz.com");
  assert.equal(loginEmail("dhanush M M", "example.co.in"), "dhanush.m.m@example.co.in");
});

test("the field is read forgivingly, because it is typed by hand", () => {
  for (const typed of [" DontBlinkStudioz.com ", "@dontblinkstudioz.com", "www.dontblinkstudioz.com", "https://dontblinkstudioz.com/", "https://www.dontblinkstudioz.com/contact"]) {
    assert.equal(loginEmailDomain(typed), "dontblinkstudioz.com", typed);
  }
});

test("nothing set falls back to the domain the application ships with", () => {
  for (const empty of ["", "   ", null, undefined]) assert.equal(loginEmailDomain(empty), FALLBACK_LOGIN_EMAIL_DOMAIN);
  assert.equal(FALLBACK_LOGIN_EMAIL_DOMAIN, "beamcraft.com");
  assert.equal(loginEmail("John Smith"), "john.smi@beamcraft.com");
});

test("a value that is not a domain falls back rather than being guessed at", () => {
  // A studio that typed its name there meant the name. Turning "Don't Blink Studios" into a domain
  // would issue every employee an address at one nobody chose, found out an account at a time.
  for (const notADomain of ["Don't Blink Studios", "DBS Operations OS", "localhost", "no dots here", "-leading.hyphen.com", "trailing-.com"]) {
    assert.equal(loginEmailDomain(notADomain), FALLBACK_LOGIN_EMAIL_DOMAIN, notADomain);
  }
});

test("no name is still no address, whatever the domain", () => {
  assert.equal(loginEmail("", "dontblinkstudioz.com"), "");
});
