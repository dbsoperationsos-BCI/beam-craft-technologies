import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Settings → Project: each dialog writes its row when Add, Update or Remove is pressed, and nothing
 * is held for a page-level Save.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", "components", ...parts), "utf8");
const PANEL = read("project-management", "ProjectSettingsPanel.js");
const SERVICE_DIALOG = read("project-management", "ServiceDefinitionDialog.js");
const DELIVERABLE_DIALOG = read("project-management", "DeliverableDefinitionDialog.js");
const OVERLAY = read("settings", "SettingsOverlay.js");

const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
const WRITE = between(PANEL, "const writeDefinition = ", "const removeDefinition = ");
const REMOVE = between(PANEL, "const removeDefinition = ", "function closeDefinitionDialog(");

test("nothing is staged: there is no pending area and no discard question", () => {
  for (const gone of [/setPending\(/, /function saveAll\(/, /useImperativeHandle/, /Discard unsaved changes\?/, /stageSubmit\(/, /stagedServices/, /stagedDeliverables/]) {
    assert.doesNotMatch(PANEL, gone);
  }
  // The host is told whether a write is running, never a dirty flag.
  assert.match(PANEL, /onEmbeddedStateChange\?\.\(\{ busy: saving, error, loading \}\)/);
});

test("the footer Save finishes the session: it closes Settings, and never under a running write", () => {
  const footer = between(OVERLAY, "footer={isProjectSection(openSection.id) ? <>", "</> : undefined}");
  assert.match(footer, /onClick=\{requestCloseSettings\}\s*disabled=\{projectSettingsState\.busy\}\s*>\s*\{projectSettingsState\.busy \? "Saving\.\.\." : "Save"\}/);
  // Nothing of Project Settings' is ever unsaved, so it never makes the close ask.
  assert.doesNotMatch(OVERLAY, /projectSettingsState\.dirty/);
  assert.doesNotMatch(OVERLAY, /projectSettingsRef/);
  assert.match(OVERLAY, /const sectionHoldsUnsavedEdits = \(id\) => Boolean\(unsavedRefFor\(id\)\?\.current\);/);
  // Closing still asks the question every other way out asks.
  assert.match(OVERLAY, /const requestCloseSettings = \(\) => \{\s*if \(sectionHoldsUnsavedEdits\(activeSection\)\) \{ setPendingSection\(\{ kind: "close" \}\); return; \}\s*closeSettings\(\);/);
});

test("Add and Update write through the server, and the dialog closes only after it answers", () => {
  // One press, one request: the ref inside useSubmitOnce is the guard against a double-click.
  assert.match(PANEL, /const \{ busy: saving, run \} = useSubmitOnce\(\);/);
  assert.match(WRITE, /^const writeDefinition = \(section, draft, values, close\) => run\(async \(\) => \{/);
  const update = WRITE.indexOf("await writer.update(id, values);");
  const close = WRITE.indexOf("close();");
  const success = WRITE.indexOf("showSuccess(");
  assert.ok(update > 0 && close > update && success > close, "update, then close, then the notice");
  // A refusal is shown in the dialog, which stays open with what was typed.
  const failure = WRITE.slice(WRITE.indexOf("} catch (saveError) {"));
  assert.match(failure, /const reason = saveError\.message/);
  assert.match(failure, /setDialogError\(/);
  assert.doesNotMatch(failure, /close\(\)/);
  assert.doesNotMatch(failure, /showSuccess/);
  // The table is read again in place rather than swapped for a loader.
  assert.match(WRITE, /await load\(\{ quiet: true \}\);/);
  assert.match(PANEL, /if \(!quiet\) setLoading\(true\);/);
});

test("a new row whose settings write failed is patched on retry, never created twice", () => {
  assert.match(WRITE, /let id = draft\?\.id \|\| createdIdRef\.current;/);
  assert.match(WRITE, /if \(!id\) \{\s*id = \(await writer\.create\(\{ name: values\.name \}\)\)\?\.data\?\.id;/);
  assert.match(WRITE, /createdIdRef\.current = id;/);
  // Cancelling after that refusal reads the lists again, so the row the create made is shown.
  const leave = between(PANEL, "function closeDefinitionDialog(", "function submitService(");
  assert.match(leave, /if \(!orphaned\) return;\s*\/\/[^\n]*\n\s*void load\(\{ quiet: true \}\)\.then\(\(\) => setError\(/);
  // And a retry's refusal says the row already exists, so Add is understood to finish it.
  assert.match(WRITE, /setDialogError\(createdIdRef\.current\s*\? `The \$\{writer\.label\.toLowerCase\(\)\} was added, but its settings were not saved/);
});

test("both dialogs are told when a write is running and why one was refused", () => {
  for (const section of ["ServiceDefinitionDialog", "DeliverableDefinitionDialog"]) {
    const props = between(PANEL, `<${section}`, "/>}");
    assert.match(props, /saving=\{saving\}/, section);
    assert.match(props, /error=\{dialogError\}/, section);
  }
  for (const dialog of [SERVICE_DIALOG, DELIVERABLE_DIALOG]) {
    // Add stays pressable; a missing or taken name is marked under its box instead.
    assert.match(dialog, /disabled=\{saving \|\| \(isEdit && !dirty\)\}/);
    assert.match(dialog, /onClick=\{\(\) => fields\.check\(\{ name: named \? \(nameTaken \?/);
    // Announced and scrolled to, since Add sits in the footer of a form that may be scrolled.
    assert.match(dialog, /\{error && <p ref=\{revealOnMount\} role="alert"/);
  }
});

test("Remove writes when it is confirmed, and the confirmation shows it running", () => {
  assert.match(REMOVE, /run\(async \(\) => \{/);
  assert.match(REMOVE, /await writer\.remove\(row\.id\);/);
  assert.equal((PANEL.match(/busyLabel="Removing\.\.\."\s*loading=\{saving\}/g) || []).length, 2);
});

test("a service is mapped to the deliverables the server holds, which are the only ones with ids", () => {
  assert.match(PANEL, /deliverableDefinitions=\{deliverables\}/);
});

test("a name another row already has is refused in the dialog, not by the server", () => {
  assert.match(PANEL, /takenNames=\{takenDefinitionNameKeys\(services, serviceDraft\.id \|\| null\)\}/);
  assert.match(PANEL, /takenNames=\{takenDefinitionNameKeys\(deliverables, deliverableDraft\.id \|\| null\)\}/);
  for (const [dialog, noun] of [[SERVICE_DIALOG, "service"], [DELIVERABLE_DIALOG, "deliverable"]]) {
    assert.match(dialog, /const nameTaken = definitionNameTaken\(named, takenNames\);/);
    assert.match(dialog, new RegExp(`error=\\{fields\\.errors\\.name \\|\\| \\(nameTaken \\? "A ${noun} with this name already exists\\." : ""\\)\\}`));
  }
});

test("a row the dialog adds is never called what a row it opened on is called", () => {
  assert.match(DELIVERABLE_DIALOG, /const id = `new-\$\{nextRowId\}`;/);
});
