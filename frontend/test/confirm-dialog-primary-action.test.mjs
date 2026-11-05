import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A pop-up's two buttons must always be one primary-or-danger and one secondary - never two
 * buttons of equal weight, and never the button that throws work away drawing more attention than
 * the one that keeps it. `ConfirmDialog`'s `primaryAction` prop is what lets a caller say which
 * side of that question its own Confirm/Cancel actually answers: "confirm" (the default, unchanged
 * for every caller that came before this) is right where Confirm is the thing somebody came to do -
 * deleting an asset, signing out. "cancel" is for the opposite case - discarding unsaved work -
 * where staying is the safe default and should be the one that draws the eye.
 */

const CONFIRM_DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "ui", "ConfirmDialog.js"), "utf8");
const USE_UNSAVED_GUARD = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "shared", "useUnsavedGuard.js"), "utf8");
const UPLOAD_DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "ai-feature", "media-upload", "components", "AiMediaUploadWorkspace.js"), "utf8");
const INTERVIEW_ADD_APPLICATION = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "InterviewAddApplicationDialog.js"), "utf8");
const SETTINGS_OVERLAY = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "settings", "SettingsOverlay.js"), "utf8");

test("primaryAction defaults to \"confirm\" - every existing caller renders exactly as before", () => {
  assert.match(CONFIRM_DIALOG, /primaryAction = "confirm"/);
  assert.match(CONFIRM_DIALOG, /const cancelVariant = primaryAction === "cancel" \? "primary" : "secondary";/);
  assert.match(CONFIRM_DIALOG, /const confirmVariant = primaryAction === "cancel" \? "secondary" : tone;/);
});

test("both buttons carry an explicit variant - never an unstyled default", () => {
  assert.match(CONFIRM_DIALOG, /variant=\{cancelVariant\}/);
  assert.match(CONFIRM_DIALOG, /variant=\{confirmVariant\}/);
});

test("useUnsavedGuard's discard confirmation makes Cancel (Keep editing/Go Back) the primary button, Discard secondary", () => {
  assert.match(USE_UNSAVED_GUARD, /confirmProps: \{[\s\S]*primaryAction: "cancel",/);
});

/*
 * Every direct `ConfirmDialog` usage for an accidentally-thrown-away-work dialog (not routed
 * through `useUnsavedGuard`) sets `primaryAction="cancel"` explicitly - closing mid-upload,
 * discarding an in-progress interview application, the settings rail, and a project settings panel.
 */
test("closing mid-upload keeps Keep uploading as the primary button", () => {
  // The AI Feature's upload panel replaced the old Upload dialog; its stop-mid-upload confirm is this one.
  const start = UPLOAD_DIALOG.indexOf('title="Cancel the remaining photos?"');
  assert.ok(start > 0);
  const dialog = UPLOAD_DIALOG.slice(UPLOAD_DIALOG.lastIndexOf("<ConfirmDialog", start), UPLOAD_DIALOG.indexOf("/>", start));
  assert.match(dialog, /"Keep uploading"/);
  assert.match(dialog, /primaryAction="cancel"/);
  assert.doesNotMatch(dialog, /tone="primary"/);
});

test("discarding an in-progress interview application keeps Go Back primary", () => {
  const dialog = INTERVIEW_ADD_APPLICATION.slice(INTERVIEW_ADD_APPLICATION.indexOf('title="Discard this application?"'), INTERVIEW_ADD_APPLICATION.indexOf('title="Discard this application?"') + 300);
  assert.match(dialog, /primaryAction="cancel"/);
});

test("the settings rail's unsaved-changes dialog keeps Go Back primary", () => {
  const dialog = SETTINGS_OVERLAY.slice(SETTINGS_OVERLAY.indexOf('title="Unsaved changes will be discarded"'), SETTINGS_OVERLAY.indexOf('title="Unsaved changes will be discarded"') + 300);
  assert.match(dialog, /primaryAction="cancel"/);
});

