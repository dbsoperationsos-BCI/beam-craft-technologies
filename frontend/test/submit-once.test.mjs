import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * **One press, one request.**
 *
 * Two clicks on a Confirm that posts a new record make two records. The enquiry id, the candidate
 * code and the vendor number are minted on the **server**, so the second write is not a duplicate
 * the database can refuse - it is a second, equally real row, with its own id, that somebody has to
 * find and delete. On a slow connection the window is seconds wide, which is exactly when people
 * press again.
 *
 * Two halves, and the tests below are about the second one being remembered:
 *
 *   * `disabled={busy}` is the half everyone writes. It is what the reader sees.
 *   * **the ref** is the half that works. React state updates are asynchronous, so two clicks in the
 *     same tick - which is what a double-click is - both read `busy === false` and both fire before
 *     the re-render that would have greyed the button out.
 *
 * A **delay** on the button is not a third option: whatever delay is chosen, a save slower than it
 * is still double-postable, and every ordinary save is made to feel sluggish to pay for it.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const HOOK = src("components", "shared", "useSubmitOnce.js");
const CRM = src("components", "sales", "CRMPage.js");
const BULK = src("components", "sales", "BulkImportLeadsDialog.js");

test("the guard is a ref, written before anything awaits", () => {
  // The whole point. A state-only guard is read again by the second click before React has
  // re-rendered, so both presses pass it.
  assert.match(HOOK, /const running = useRef\(false\);/);
  assert.match(HOOK, /if \(running\.current\) return undefined;\s*\n\s*running\.current = true;\s*\n\s*setBusy\(true\);/);
});

test("it is released whatever happened, so a failed save is not a locked form", () => {
  /*
   * A network blip that left `busy` true would lock somebody out of the form until they reloaded -
   * and reloading loses what they typed, which is a worse failure than the double-post this exists
   * to prevent.
   */
  assert.match(HOOK, /\} finally \{[\s\S]*?running\.current = false;\s*\n\s*setBusy\(false\);/);
});

test("a press it ignored is tellable from a save that failed", () => {
  // `undefined` for a refused press, the work's own answer otherwise - so a caller that acts on the
  // result can tell "it never ran" from "it ran and said no".
  assert.match(HOOK, /return undefined;/);
  assert.match(HOOK, /return await work\(\);/);
});

test("Add Lead cannot post twice — the one that makes duplicate records", () => {
  /*
   * The enquiry id comes from the server, so two posts are two leads with two ids. This was the
   * only dialog in the CRM with no in-flight guard at all: a plain `<Button onClick>` with nothing
   * disabling it, which is why it was the one producing duplicates.
   */
  assert.match(CRM, /const \{ busy: addingLead, run: runAddLead \} = useSubmitOnce\(\);/);
  assert.match(CRM, /void runAddLead\(\(\) => saveLead\(committed\)\);/);
  assert.match(CRM, /busy=\{addingLead\}\s*\n\s*busyLabel="Adding\.\.\."/);
  // Cancel stands down too: closing the form mid-post would leave the lead landing behind a dialog
  // that is no longer on screen.
  assert.match(CRM, /onClick=\{requestCloseAddLead\} disabled=\{addingLead\}>Cancel<\/Button>/);
  // Drawn through the shared prop, not a ternary of its own - the CRM must not be the exception to
  // the rule it is the reason for.
  assert.equal(CRM.includes('{addingLead ? "Adding'), false, "Add Lead should use Button's busy prop");
  /*
   * And the duplicate-phone warning reaches the **same** save by a second route - "go on with it
   * anyway" - so it takes the same guard. Guarding only the button would leave that path open.
   */
  assert.equal(CRM.split("runAddLead(() => saveLead(committed))").length - 1, 2, "both ways into the save must be guarded");
});

test("the lead popup cannot skip two leads on one double-click", () => {
  /*
   * Not the duplicate-record problem: writing the same values twice leaves the lead as it was. It is
   * **Update and Proceed Next**, which advances the board - pressed twice it saves one lead and
   * steps past two, and the skipped one is the one nobody then works.
   */
  assert.match(CRM, /const \{ busy: updatingLead, run: runUpdateLead \} = useSubmitOnce\(\);/);
  // Refused at the top of `attemptSave`, before the phone-clash dialog or the note commit can run
  // a second time.
  assert.match(CRM, /function attemptSave\(closeAfter, advanceAfter, forcedStatus, moveConfirmed = false\) \{[\s\S]{0,700}?if \(updatingLead\) return;/);
  assert.match(CRM, /void runUpdateLead\(\(\) => saveWithCommittedNote\(/);
  // All three buttons stand down, including CNA, which is the one that fires fastest in practice.
  assert.equal(CRM.split("busy={updatingLead}").length - 1, 3, "every button that saves the popup must stand down");
  assert.equal(CRM.includes('{updatingLead ? "Saving'), false, "the popup should use Button's busy prop too");
});

test("Bulk Entry had the state and not the ref", () => {
  /*
   * It always disabled its button while saving, which is why it was never the one producing
   * duplicates - but a double-click is two clicks in one tick, and the state guard is applied on
   * the next render. Much narrower window than Add Lead's, the same class of bug.
   */
  assert.match(BULK, /const savingRef = useRef\(false\);/);
  assert.match(BULK, /if \(savingRef\.current\) return;\s*\n\s*savingRef\.current = true;\s*\n\s*setSaving\(true\);/);
  assert.match(BULK, /\} finally \{\s*\n\s*savingRef\.current = false;\s*\n\s*setSaving\(false\);/);
});

test("the busy state is one prop on Button, not a convention each screen re-invents", () => {
  /*
   * The inconsistency this replaced: some buttons greyed **and** said "Saving...", some only greyed,
   * and a few said nothing at all. Those read as three different things to somebody waiting - and a
   * greyed button with no word reads as *refused* rather than *working*, which is the reading that
   * makes people press again.
   *
   * `busy` is now the whole of it: it disables the button, flips the label to the verb the button
   * already leads with, and says so to a screen reader. `busyLabel` overrides the verb where the
   * obvious word is not the honest one.
   */
  const BUTTON = src("components", "shared", "Button.js");
  assert.match(BUTTON, /busy = false,\s*\n\s*busyLabel,/);
  assert.match(BUTTON, /if \(isBusy\) buttonProps\.disabled = true;/);
  assert.match(BUTTON, /aria-busy/);
  assert.match(BUTTON, /\{isBusy \? \(busyLabel \|\| busyTextFor\(children\)\) : children\}/);
  /*
   * The verb follows the button. `Add Lead` becomes `Adding...`, `Send Screening Form` becomes
   * `Sending...`, and `Update and Close` becomes `Updating...` - none of them written twice. A label
   * this cannot read falls back to `Saving...`, which is true of nearly every write and is the
   * application's own most common word for it by a factor of five.
   */
  const verbFor = (label) => {
    const rules = [...BUTTON.matchAll(/\[(\/\^[^/]+\/i), "([^"]+)"\]/g)]
      .map(([, pattern, word]) => [new RegExp(pattern.slice(1, -2), "i"), word]);
    return (rules.find(([re]) => re.test(label)) || [null, "Saving..."])[1];
  };
  assert.equal(verbFor("Add Lead"), "Adding...");
  assert.equal(verbFor("Save Changes"), "Saving...");
  assert.equal(verbFor("Update and Close"), "Updating...");
  assert.equal(verbFor("Send Screening Form"), "Sending...");
  assert.equal(verbFor("Confirm"), "Saving...", "an unreadable label still says something true");
  // Three dots, not an ellipsis character: the application writes "Saving..." in 183 places and
  // "Saving…" in 26, and one of the two had to win.
  assert.equal(BUTTON.includes("…\""), false, "the busy words should use ... like the rest of the app");
});

test("no action button in the app was left with a delay instead of a guard", () => {
  /*
   * A `setTimeout` around a submit is the fix somebody reaches for when the button double-posts, and
   * it does not work: a save slower than the delay is still double-postable. Pinned as an absence so
   * the next person to hit this reaches for `useSubmitOnce` instead.
   */
  const dir = path.join(HERE, "..", "src", "components");
  const offenders = [];
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        const text = fs.readFileSync(full, "utf8");
        // A timer wrapped directly around something that saves.
        if (/setTimeout\(\s*\(\)\s*=>\s*(?:void\s+)?(?:save|submit|confirm|create|add)[A-Z(]/.test(text)) {
          offenders.push(path.relative(dir, full));
        }
      }
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [], `these delay a submit instead of guarding it:\n${offenders.join("\n")}`);
});
