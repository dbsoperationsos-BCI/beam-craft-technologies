import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Every field on the Create Onboarding Invite form is answered before an invite exists.
 *
 * Two of them were optional - the Intended Designation and the Expiry Date - so an invite could be
 * raised naming neither the role the candidate is being taken on for nor when their link stops
 * working. Seven of the studio's eight existing invites have no designation, which is what that
 * costs.
 *
 * The rule has three parts and all three have to hold together, which is why they are tested
 * together: the form asks, the server refuses, and **Re-invite** - which posts without going
 * through the form at all - cannot be the hole in the middle.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
const DIALOG = read("src", "components", "employees", "OnboardingInviteDialog.js");
const CONTROLLER = read("..", "backend", "src", "modules", "hrm", "onboarding-invites", "controller.js");

test("the form marks every field required", () => {
  for (const control of ['label="Candidate Name"', 'label="Candidate Email"', 'label="Candidate Phone"', 'label="Intended Designation"', 'label="Expiry Date"']) {
    const element = DIALOG.match(new RegExp(`<[A-Za-z]+[^>]*${control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*/>|<[A-Za-z]+[\\s\\S]{0,400}?${control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]{0,400}?/>`));
    assert.ok(element, `the invite form no longer draws ${control}`);
    assert.match(element[0], /\brequired\b/, `${control} is not marked required`);
  }
});

test("there is no option whose job is to leave the designation empty", () => {
  /*
   * "Not specified" was the first entry, put there so a mis-click could be undone while the field
   * was optional. Kept, it is a way round the rule rather than a choice - the field would be marked
   * required and still submittable blank.
   */
  // Read from the options the control is given, not from the file: the comment above it explains
  // why the entry went, and a whole-file search would fail on the explanation.
  const options = DIALOG.match(/options=\{([^}]*)\}[\s\S]{0,200}?placeholder="Select the designation"/);
  assert.ok(options, "the designation Dropdown no longer declares its options");
  assert.equal(options[1].trim(), "designations", "the list is the designations alone, with no unanswering entry in front of it");
});

test("the form refuses before it posts, and marks each outstanding box", () => {
  // The two that matter are a Dropdown and a DateField, neither of which is a native input the
  // browser will refuse for us. Each problem is said under its own box (useFormErrors).
  assert.match(DIALOG, /if \(!fields\.check\(inviteProblems\(\)\)\) return;/);
  for (const field of ["candidateName", "candidateEmail", "candidatePhone", "intendedDesignation", "expiresAt"]) {
    assert.match(DIALOG, new RegExp(`${field}: [^\\n]+`), `${field} is not among the fields the form checks`);
    assert.match(DIALOG, new RegExp(`error=\\{fields\\.errors\\.${field}\\}`), `${field} does not show its own error`);
  }
});

test("the server holds the same rule", () => {
  // Otherwise it is a rule the one screen that can break it is the only thing keeping.
  assert.match(CONTROLLER, /intendedDesignation: z\.string\(\{ message: "Intended Designation is required\." \}\)\.trim\(\)\.min\(1/);
  assert.match(CONTROLLER, /expiresAt: z\.coerce\.date\(\{ message: "Expiry Date is required\." \}\)/);
});

test("and the expiry has no server-side default left under it", () => {
  /*
   * The server used to fall back to seven days for a request that left `expiresAt` out. A default
   * under a required field is a way for that field to go unanswered - and it is what Re-invite was
   * relying on.
   */
  assert.equal(/expiresAt = parsed\.data\.expiresAt \|\|/.test(CONTROLLER), false);
  assert.match(CONTROLLER, /const expiresAt = parsed\.data\.expiresAt;/);
});

test("Re-invite sends a complete invite, or opens the form rather than failing", () => {
  /*
   * It posted directly, with no expiry - deliberately, because the server had one - and with the
   * old invite's designation "or undefined". Both of those are now refusals. An invite that has
   * everything is still one press; one that does not opens the form carrying what is known, because
   * this must not invent a designation and must not hand the reader the server's raw complaint.
   */
  const start = DIALOG.indexOf("async function resendInvite(");
  const body = DIALOG.slice(start, DIALOG.indexOf("function inviteAction(", start));
  assert.match(body, /if \(!String\(invite\.intendedDesignation \|\| ""\)\.trim\(\)\) \{/, "an invite with no designation must not be posted");
  assert.match(body, /setMode\("create"\)/, "it opens the form instead");
  assert.match(body, /intendedDesignation: invite\.intendedDesignation,/, "and a complete one sends the designation it has");
  assert.match(body, /expiresAt: new Date\(`\$\{initialForm\(\)\.expiresAt\}T23:59:59`\)\.toISOString\(\)/, "with an expiry of its own, there being no server default now");
});
