import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const GENERAL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", "PreProductionGeneral.js"), "utf8");

test("General shows a gift, the hard disk and the CRD document only when the saved project has them, or they were switched off with a reason", () => {
  assert.match(GENERAL, /const shownOnGeneral = \(item, project\) => APPLIES\[item\]\(project\[item\]\) \|\| Boolean\(notApplicableRemarks\(item, project\.applicabilityChanges\)\);/);
  for (const [item, marker] of [["welcomeGift", 'giftSection("welcome-kit"'], ["shootCompletedGift", 'giftSection("shoot-completed-gift"'], ["storageNeeded", 'id: "hard-disk"'], ["crdDocumentStatus", 'id: "crd-document"']]) {
    const at = GENERAL.indexOf(marker);
    assert.ok(GENERAL.slice(Math.max(0, at - 120), at).includes(`shownOnGeneral("${item}", project) &&`), `${item} section is gated`);
    assert.match(GENERAL, new RegExp(`shownOnGeneral\\("${item}", project\\) && \\["`), `${item} bar item is gated`);
  }
  assert.match(GENERAL, /\]\.filter\(Boolean\), \[canWrite, project\]\);/);
});

test("General saves through the pre production routes, under the screen's own permission", () => {
  assert.doesNotMatch(GENERAL, /saveProjectDraft|updateClientGiftStatus|getClientStorageRecord|getClientStorageOptions/);
  // The disk is read here and moved nowhere: one status, set from the shoot that hands it over.
  assert.doesNotMatch(GENERAL, /changePreProductionStorageStatus/);
  assert.match(GENERAL, /await getPreProductionStorageRecord\(project\.projectId, project\.storageRecordId\);/);
  assert.match(GENERAL, /await savePreProductionGeneral\(project\.projectId, payload\);/);
  assert.match(GENERAL, /await savePreProductionGiftStatus\(gift, project\.projectId, form\[statusField\]\);/);
});

test("the switch reasons are cleared only after the saved project has been reloaded", () => {
  // Cleared before the reload, the reason box came back empty and required, and the panel said
  // "Complete required fields" before "General saved".
  const submit = GENERAL.slice(GENERAL.indexOf("async function submit(event)"));
  const reloaded = submit.indexOf('await onSaved?.("General saved.");');
  const cleared = submit.indexOf('!key.endsWith("Reason")');
  assert.ok(reloaded > -1 && cleared > reloaded);
});
