import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { whatsappLinkNeeded } from "../src/lib/whatsappGate.mjs";

/*
 * The application, held shut until this account's WhatsApp is linked.
 *
 * Everybody except an administrator must pair before they may use it. What keeps that safe rather
 * than reckless is the set of exceptions - an administrator is never held, a named person can be
 * released, a WhatsApp switch that is off lifts it, and a failed read never holds anybody - and the
 * fact that the answer is read live rather than carried on the login. Each of those is pinned here.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const GATE = read("components", "sales", "WhatsappRequiredGate.js");
const SHELL = read("components", "app-shell", "AppShell.js");
const CONFIG = read("constants", "employeeCredentialConfig.js");
const FORM = read("components", "employees", "useCredentialForm.js");

test("held for a user, never for an administrator", () => {
  assert.equal(whatsappLinkNeeded({ status: "disconnected", isAdmin: false }), true, "an unlinked user is not held");
  assert.equal(whatsappLinkNeeded({ status: "disconnected", isAdmin: true }), false, "an administrator is held");
  assert.equal(whatsappLinkNeeded({ status: "connected", isAdmin: false }), false, "a linked user is still held");
});

test("nobody is held at a door they have no key to", () => {
  // Both switches, and a read that did not come back. Locking somebody out of the application on the
  // strength of a request that failed is the one failure this must never have.
  assert.equal(whatsappLinkNeeded({ status: "disconnected", chatEnabled: false }), false, "the studio switch being off still holds");
  assert.equal(whatsappLinkNeeded({ status: "disconnected", userChatEnabled: false }), false, "a switched-off account is still held");
  assert.equal(whatsappLinkNeeded(null), false, "a failed read holds the application shut");
});

test("the server decides who is held, and it is read live", () => {
  /*
   * `linkRequired` is the server's answer for this account - false for an administrator and false for
   * anyone released in Login Credentials. Read per poll rather than taken from the login: a rule
   * carried on the token only changes when somebody signs in again, and a person this is holding
   * cannot sign out to collect it.
   */
  assert.match(GATE, /session\?\.linkRequired !== true\) return null;/);
  assert.doesNotMatch(GATE, /getAuthenticatedUser/, "the gate is back on the stored login");
});

test("a reply that omits the rule cannot unlock the application", () => {
  // It could: the gate replaced its session with whatever a call answered, and the pairing reply
  // carried no `linkRequired` - so Refresh code let go of the very thing the code was for.
  assert.match(GATE, /setSession\(\(current\) => \(\{ \.\.\.\(current \|\| \{\}\), \.\.\.next \}\)\)/, "the pairing reply replaces the session again");
  assert.match(GATE, /setSession\(\(current\) => \(\{ \.\.\.\(current \|\| \{\}\), \.\.\.response\.data \}\)\)/, "the status poll replaces the session again");

  const merge = (current, next) => ({ ...(current || {}), ...next });
  const held = merge(null, { status: "disconnected", isAdmin: false, chatEnabled: true, userChatEnabled: true, linkRequired: true });
  const up = (s) => s?.linkRequired === true && whatsappLinkNeeded(s);
  assert.equal(up(held), true);
  assert.equal(up({ status: "pairing", qr: "AAA" }), false, "check this test still describes the bug");
  assert.equal(up(merge(held, { status: "pairing", qr: "AAA" })), true, "Refresh code unlocks the application again");
  assert.equal(up(merge(held, { status: "connected", qr: "" })), false, "a successful scan no longer opens it");
});

test("one lapse asks to pair once, and never faster than the cooldown", () => {
  /*
   * The automatic request used to guard on "no QR yet" and depend on the session - a fresh object
   * after every poll and every reply - so a socket that had not produced a code asked again on each,
   * spending a whole rate-limit budget in about a second. Nothing counts attempts on the server now,
   * which makes this the only pacing there is: each request is a real registration against the
   * studio's WhatsApp number.
   *
   * It was then *once per visit*, which paced it correctly and locked people out: WhatsApp stops
   * issuing codes after a few minutes unscanned, and the ref that would have asked for another had
   * already been spent. Once per **lapse** is the rule now - see whatsapp-gate-recovers.test.mjs -
   * and what still has to hold is that a session busy producing codes asks for nothing.
   */
  assert.match(GATE, /if \(askedRef\.current \|\| starting\) return;/);
  assert.match(GATE, /if \(session\.status === "pairing" \|\| session\.status === "connected"\) \{/);
  assert.match(GATE, /if \(starting \|\| Date\.now\(\) < nextAllowedRef\.current\) return;/);
  // How long that cooldown has to be is the server's business, not this test's - see
  // whatsapp-gate-pacing.test.mjs, which holds it to `MIN_CONNECT_GAP_MS`.
  assert.match(GATE, /const PAIRING_COOLDOWN_MS = \d+ \* 1000;/);
  // And it says how long rather than refusing silently, which reads as broken and invites a retry.
  assert.match(GATE, /disabled=\{starting \|\| waiting > 0\}/);
});

test("it reads whether it is holding somebody from the route every signed-in account may read", () => {
  /*
   * `/session` sits behind `SALES / CRM Leads` - it is the CRM dashboard's own read, over every
   * CRM at once. This gate is a different question, about the one account asking, and has to be
   * answerable by anybody `whatsappRequired` can be ticked for - which is not only Sales. Reading
   * `/session` instead meant a poll from outside CRM Leads came back 403, which this gate reads
   * exactly like a network hiccup and holds nobody for - so a tick that should have held somebody
   * silently did nothing, for as long as they lacked that one unrelated permission.
   */
  assert.match(GATE, /getMyWhatsappSession/, "the gate must read /my-session, which sits above the CRM Leads guard");
  assert.doesNotMatch(GATE, /getWhatsappSession\b/, "the gate must not read /session, which CRM Leads guards");
});

test("it cannot be dismissed, and gates from the shell", () => {
  const dialog = GATE.slice(GATE.indexOf("return <Dialog"));
  assert.doesNotMatch(dialog, /onClose=/, "the gate can be dismissed again");
  assert.match(SHELL, /<WhatsappRequiredGate \/>/, "the shell no longer mounts the gate");
});

test("Login Credentials carries the release, after Roles", () => {
  const sections = CONFIG.slice(CONFIG.indexOf("export const credentialSections"));
  const roles = sections.indexOf('id: "roles"');
  const whatsapp = sections.indexOf('id: "whatsapp"');
  const alternative = sections.indexOf('id: "alternative"');
  assert.ok(roles > 0 && whatsapp > 0, "the WhatsApp section is gone");
  assert.ok(roles < whatsapp && whatsapp < alternative, "the WhatsApp section moved out from between Roles and Alternative");
  /*
   * Off unless somebody ticks it, on the form and in the column alike. Nobody is held to WhatsApp
   * until the studio says so about a named person - that is what makes the rule safe to ship, and
   * a default that drifted back on would gate a whole studio on a deploy.
   */
  assert.match(FORM, /whatsappAllowed: false,/, "the tick defaults on again, which would gate every new account");
  assert.match(FORM, /whatsappAllowed: found\.whatsappRequired === true,/, "the form no longer opens on what the account carries");
  assert.match(FORM, /checked=\{shown\.whatsappAllowed === true\}/, "the checkbox is ticked for a value nobody set");
  assert.equal((FORM.match(/whatsappRequired: shown\.whatsappAllowed === true,/g) || []).length, 2,
    "the rule is not sent on both the create and the update");
});
