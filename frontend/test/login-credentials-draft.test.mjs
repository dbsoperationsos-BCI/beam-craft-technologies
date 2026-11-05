import test from "node:test";
import assert from "node:assert/strict";

import { draftFrom, mergeProposals, touchedByDraft } from "../src/components/employees/credentialDraft.js";

/*
 * Putting the Login Credentials page down and picking it up again.
 *
 * The rule worth testing is not that a draft saves — it is that a draft that has just been *loaded*
 * reads as unchanged. The page decides whether to offer Save Draft, and whether closing asks a
 * question, by comparing what is on screen against what is on the server; get that comparison wrong
 * in either direction and the screen misleads. Too loose and a page nobody touched opens offering to
 * save itself and refusing to close quietly; too tight and real work is thrown away by the × without
 * a word, which is the thing this whole feature exists to stop.
 *
 * The trap is that the two sides speak different languages: the form holds ids as strings, the
 * server stores and returns them as numbers.
 */

const record = {
  employeeName: "dhanush M M",
  alternative1EmployeeId: 6,
  leaveApprover1EmployeeId: 7,
};

/** The studio's own domain, from Settings, which is what login addresses are proposed at. */
const DOMAIN = "dontblinkstudioz.com";

/** What the page shows, given what the server sent back and what nobody has retyped. */
const asShown = (draft, domain = DOMAIN) => draftFrom(mergeProposals(record, { temporaryPassword: "pw", roleIds: [], branchId: "", ...(draft || {}) }, touchedByDraft(draft), domain));

test("a draft loaded straight back reads as unchanged", () => {
  const stored = { username: "probe.draft.name", email: `x@${DOMAIN}`, temporaryPassword: "pw", branchId: "3", roleIds: ["r1"], alternative1EmployeeId: 6, alternative2EmployeeId: "", leaveApproverIds: [7] };
  assert.equal(JSON.stringify(asShown(stored)), JSON.stringify(draftFrom({ ...stored })));
});

test("ids the server returns as numbers do not read as an edit", () => {
  // The one that would break it: `6` from the server against `"6"` on the form is a difference to
  // JSON and no difference at all to a person.
  const shown = asShown({ alternative1EmployeeId: 6, leaveApproverIds: [7, 8] });
  assert.equal(shown.alternative1EmployeeId, "6");
  assert.deepEqual(shown.leaveApproverIds, ["7", "8"]);
});

test("with no draft the page proposes from the record", () => {
  const shown = asShown(null);
  assert.equal(shown.username, "dhanush.m.m");
  assert.equal(shown.email, `dhanush.m.m@${DOMAIN}`);
  // Cover and approval the record already carries come across as its proposal too.
  assert.equal(shown.alternative1EmployeeId, "6");
  assert.deepEqual(shown.leaveApproverIds, ["7"]);
});

test("a username somebody changed is not replaced by the one the name would produce", () => {
  const shown = asShown({ username: "d.mm" });
  assert.equal(shown.username, "d.mm");
});

test("a field the draft deliberately emptied stays empty", () => {
  // The reason `touched` is tracked rather than inferred from the value: cleared is an answer, and
  // a blank read as "unanswered" would put the record's proposal straight back.
  const shown = asShown({ alternative1EmployeeId: "" });
  assert.equal(shown.alternative1EmployeeId, "");
});

test("nothing outside this page's ten answers is carried", () => {
  // `savedAt` is the draft's own bookkeeping and must not reach the form as a field. The list is
  // spelled out rather than counted, so adding an answer to this page is a decision taken here too.
  const shown = asShown({ username: "x", savedAt: "2026-09-08T00:00:00.000Z" });
  assert.equal("savedAt" in shown, false);
  assert.deepEqual(Object.keys(shown).sort(), ["alternative1EmployeeId", "alternative2EmployeeId", "branchId", "email", "leaveApproverIds", "permissionApproverEmployeeId", "roleIds", "temporaryPassword", "username", "whatsappAllowed"]);
});

/*
 * The domain is Settings' answer, and it arrives over the network like everything else on this page.
 *
 * The page works out what it shows and what "unchanged" means with the same call, so both have to
 * be given the same domain. This is what goes wrong when they are not: a domain that settles after
 * the baseline was fixed changes the proposal underneath it, and the page opens offering to save a
 * login nobody typed. `useCredentialForm` settles the domain alongside its other loads for exactly
 * this reason.
 */
test("the same domain on both sides is a page that opens unchanged", () => {
  const opened = asShown(null);
  assert.equal(JSON.stringify(asShown(null)), JSON.stringify(opened));
});

test("a domain arriving after the baseline is what a self-dirtying page looks like", () => {
  assert.notEqual(JSON.stringify(asShown(null, "beamcraft.com")), JSON.stringify(asShown(null, DOMAIN)));
});

test("an address somebody typed survives the domain being set afterwards", () => {
  // The field is editable, and a typed answer is an answer: changing the studio's domain must not
  // rewrite an address whoever is onboarding chose deliberately.
  assert.equal(asShown({ email: "founder@elsewhere.com" }, DOMAIN).email, "founder@elsewhere.com");
});
